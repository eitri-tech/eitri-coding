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

import easyocr

# Inicializa OCR (lazy loading seria possível também)
reader = easyocr.Reader(['pt', 'en'], gpu=False)

TMP_XML = "/tmp/ui.xml"
TMP_SCREEN = "/tmp/screen.png"

_last_screen_hash = None


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


def find_element_by_text(text):
    ui_tree()
    root = ET.parse(TMP_XML).getroot()

    for node in root.iter():
        t = node.attrib.get("text", "")
        d = node.attrib.get("content-desc", "")

        if text.lower() in t.lower() or text.lower() in d.lower():
            bounds = node.attrib.get("bounds")
            if bounds:
                return {
                    "x": parse_bounds(bounds)[0],
                    "y": parse_bounds(bounds)[1],
                    "confidence": 1.0
                }

    return None


# ------------------------
# OCR (EasyOCR)
# ------------------------

def preprocess_image(img):
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return gray


def find_text_ocr(text):
    screenshot()

    img = cv2.imread(TMP_SCREEN)
    img = preprocess_image(img)

    results = reader.readtext(img)

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


def smart_tap(text=None, template=None):
    result = retry(lambda: smart_find(text, template))

    if not result:
        return {"error": "element not found", "text": text}

    tap(result["x"], result["y"])
    result["action"] = "tap"
    return result


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