#!/usr/bin/env python3

import sys
import subprocess
import time
import xml.etree.ElementTree as ET
import re
import os
import json
import cv2
import numpy as np
import hashlib

TMP_XML = "/tmp/ui.xml"
TMP_SCREEN = "/tmp/screen.png"

_last_screen_hash = None
_reader = None
_ocr_cache = {}
_OCR_CACHE_MAX = 8


def get_reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(['pt', 'en'], gpu=False)
    return _reader


def _cached_readtext(img_path):
    with open(img_path, "rb") as f:
        h = hashlib.md5(f.read()).hexdigest()

    if h not in _ocr_cache:
        img = cv2.imread(img_path)
        img = preprocess_image(img)
        _ocr_cache[h] = get_reader().readtext(img)
        if len(_ocr_cache) > _OCR_CACHE_MAX:
            _ocr_cache.pop(next(iter(_ocr_cache)))

    return _ocr_cache[h]


# ------------------------
# CORE
# ------------------------

def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.stdout.strip()


def log(data):
    print(json.dumps(data))


# ------------------------
# SCREEN / DEVICE
# ------------------------

def screenshot():
    run(f"adb exec-out screencap -p > {TMP_SCREEN}")
    return TMP_SCREEN


def screen_hash():
    global _last_screen_hash

    with open(TMP_SCREEN, "rb") as f:
        h = hashlib.md5(f.read()).hexdigest()

    changed = h != _last_screen_hash
    _last_screen_hash = h

    return changed


def get_display_size():
    out = run("adb shell wm size")
    match = re.search(r'(\d+)x(\d+)', out)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None


def tap(x, y):
    x, y = int(x), int(y)
    run(f"adb shell input tap {x} {y}")
    return {"action": "tap", "x": x, "y": y}


def tap_percent(px, py):
    w, h = get_display_size()
    return tap(int(px * w), int(py * h))


def type_text(text):
    text = text.replace(" ", "%s")
    run(f'adb shell input text "{text}"')
    return {"action": "type", "text": text}


def swipe(direction):
    coords = {
        "up": "500 1500 500 500",
        "down": "500 500 500 1500",
        "left": "800 800 200 800",
        "right": "200 800 800 800"
    }

    if direction not in coords:
        return {"error": "invalid direction"}

    run(f"adb shell input swipe {coords[direction]}")
    return {"action": "swipe", "direction": direction}


# ------------------------
# XML
# ------------------------

def ui_tree():
    run("adb shell uiautomator dump /sdcard/ui.xml")
    run(f"adb pull /sdcard/ui.xml {TMP_XML}")
    return TMP_XML


def parse_bounds(bounds):
    nums = list(map(int, re.findall(r'\d+', bounds)))
    x = (nums[0] + nums[2]) // 2
    y = (nums[1] + nums[3]) // 2
    return x, y


def _clickable_ancestor(node, parents):
    cur = node
    while cur is not None:
        if cur.attrib.get("clickable") == "true" and cur.attrib.get("bounds"):
            return cur
        cur = parents.get(cur)
    return None


def find_element_by_text(text):
    ui_tree()
    tree = ET.parse(TMP_XML)
    root = tree.getroot()
    parents = {child: parent for parent in root.iter() for child in parent}

    target = text.lower()
    exact_match = None
    contains_match = None

    for node in root.iter():
        t = node.attrib.get("text", "") or ""
        d = node.attrib.get("content-desc", "") or ""
        tl, dl = t.lower(), d.lower()

        if tl == target or dl == target:
            exact_match = node
            break
        if contains_match is None and (target in tl or target in dl):
            contains_match = node

    node = exact_match or contains_match
    if node is None:
        return None

    clickable = _clickable_ancestor(node, parents) or node
    bounds = clickable.attrib.get("bounds") or node.attrib.get("bounds")
    if not bounds:
        return None

    x, y = parse_bounds(bounds)
    return {
        "x": x,
        "y": y,
        "confidence": 1.0,
        "exact": exact_match is not None,
        "clickable_ancestor": clickable is not node,
    }


# ------------------------
# OCR (EasyOCR)
# ------------------------

def preprocess_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return gray


def find_text_ocr(text):
    screenshot()

    results = _cached_readtext(TMP_SCREEN)

    best_match = None

    for (bbox, detected, conf) in results:
        if text.lower() in detected.lower():
            (tl, tr, br, bl) = bbox
            x = int((tl[0] + br[0]) / 2)
            y = int((tl[1] + br[1]) / 2)

            if not best_match or conf > best_match["confidence"]:
                best_match = {
                    "x": x,
                    "y": y,
                    "confidence": float(conf),
                    "text": detected
                }

    return best_match


# ------------------------
# TEMPLATE MATCHING
# ------------------------

def find_template(path):
    screenshot()

    screen = cv2.imread(TMP_SCREEN)
    template = cv2.imread(path)

    if screen is None or template is None:
        return None

    result = cv2.matchTemplate(screen, template, cv2.TM_CCOEFF_NORMED)
    _, max_val, _, max_loc = cv2.minMaxLoc(result)

    if max_val > 0.8:
        h, w, _ = template.shape
        return {
            "x": max_loc[0] + w // 2,
            "y": max_loc[1] + h // 2,
            "confidence": float(max_val)
        }

    return None


# ------------------------
# INTELLIGENCE
# ------------------------

def wait_for(fn, timeout=10, interval=0.5):
    start = time.time()

    while time.time() - start < timeout:
        result = fn()
        if result:
            return result
        time.sleep(interval)

    return None


def retry(fn, attempts=3):
    for _ in range(attempts):
        result = fn()
        if result:
            return result
        time.sleep(1)
    return None


def smart_find(text=None, template=None):
    # 1. XML (rápido)
    if text:
        pos = find_element_by_text(text)
        if pos:
            pos["method"] = "xml"
            return pos

    # 2. OCR (robusto)
    if text:
        pos = find_text_ocr(text)
        if pos:
            pos["method"] = "ocr"
            return pos

    # 3. Template (ícones)
    if template:
        pos = find_template(template)
        if pos:
            pos["method"] = "template"
            return pos

    return None


def wait_for_screen_change(timeout=3, interval=0.2):
    # prime baseline
    screenshot()
    screen_hash()

    start = time.time()
    while time.time() - start < timeout:
        time.sleep(interval)
        screenshot()
        if screen_hash():
            return True
    return False


def smart_tap(text=None, template=None, wait_change=True):
    result = retry(lambda: smart_find(text, template))

    if not result:
        return {"error": "element not found", "text": text}

    if wait_change:
        screenshot()
        screen_hash()

    tap(result["x"], result["y"])
    result["action"] = "tap"

    if wait_change:
        result["screen_changed"] = wait_for_screen_change(timeout=3)

    return result


def scroll_until_found(text=None, template=None, direction="up", max_swipes=10):
    # direction = content motion: "up" reveals what's below, "down" reveals what's above
    if direction not in ("up", "down", "left", "right"):
        return {"error": "invalid direction", "direction": direction}

    # already visible?
    pos = smart_find(text=text, template=template)
    if pos:
        pos["swipes"] = 0
        return pos

    for i in range(1, max_swipes + 1):
        screenshot()
        before = hashlib.md5(open(TMP_SCREEN, "rb").read()).hexdigest()

        swipe(direction)
        time.sleep(0.6)  # let inertia settle

        screenshot()
        after = hashlib.md5(open(TMP_SCREEN, "rb").read()).hexdigest()

        pos = smart_find(text=text, template=template)
        if pos:
            pos["swipes"] = i
            return pos

        if before == after:
            return {"error": "end of scroll reached", "text": text, "swipes": i}

    return {"error": "not found after max swipes", "text": text, "swipes": max_swipes}


def scroll_and_tap(text=None, template=None, direction="up", max_swipes=10):
    found = scroll_until_found(text=text, template=template, direction=direction, max_swipes=max_swipes)
    if found.get("error"):
        return found

    screenshot()
    screen_hash()
    tap(found["x"], found["y"])
    found["action"] = "tap"
    found["screen_changed"] = wait_for_screen_change(timeout=3)
    return found


def smart_wait(text=None, timeout=10):
    result = wait_for(lambda: smart_find(text), timeout=timeout)

    if not result:
        return {"error": "timeout", "text": text}

    return {
        "found": True,
        "method": result["method"],
        "confidence": result.get("confidence", 1.0)
    }


# ------------------------
# MAIN (LLM TOOL)
# ------------------------

def main():
    if len(sys.argv) < 2:
        log({"error": "no command"})
        return

    cmd = sys.argv[1]

    try:
        if cmd == "tap_text":
            log(smart_tap(text=sys.argv[2]))

        elif cmd == "tap_template":
            log(smart_tap(template=sys.argv[2]))

        elif cmd == "wait_text":
            timeout = int(sys.argv[3]) if len(sys.argv) > 3 else 10
            log(smart_wait(text=sys.argv[2], timeout=timeout))

        elif cmd == "scroll_to_text":
            direction = sys.argv[3] if len(sys.argv) > 3 else "up"
            max_swipes = int(sys.argv[4]) if len(sys.argv) > 4 else 10
            log(scroll_until_found(text=sys.argv[2], direction=direction, max_swipes=max_swipes))

        elif cmd == "scroll_and_tap":
            direction = sys.argv[3] if len(sys.argv) > 3 else "up"
            max_swipes = int(sys.argv[4]) if len(sys.argv) > 4 else 10
            log(scroll_and_tap(text=sys.argv[2], direction=direction, max_swipes=max_swipes))

        elif cmd == "type":
            log(type_text(sys.argv[2]))

        elif cmd == "swipe":
            log(swipe(sys.argv[2]))

        elif cmd == "tap_xy":
            log(tap(sys.argv[2], sys.argv[3]))

        elif cmd == "tap_percent":
            log(tap_percent(float(sys.argv[2]), float(sys.argv[3])))

        elif cmd == "screenshot":
            path = screenshot()
            log({"screenshot": path})

        else:
            log({"error": "unknown command"})

    except Exception as e:
        log({"error": str(e)})


if __name__ == "__main__":
    main()