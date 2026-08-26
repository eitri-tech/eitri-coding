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
import base64
import socket
import struct
import contextlib
import urllib.request

import webinspect
from webinspect import (
    Inspector,
    WebSocketClient,
    console_entry,
    dom_js,
    eitri_environment,
    free_port,
    target_score,
)

TMP_XML = "/tmp/ui.xml"
TMP_SCREEN = "/tmp/screen.png"
TMP_WEBVIEW_HTML = "/tmp/webview.html"
TMP_WEBVIEW_DOM = "/tmp/webview_dom.json"

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


def back():
    run("adb shell input keyevent KEYCODE_BACK")
    return {"action": "back"}


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

    # childless Elements are falsy in ElementTree — must compare against None
    node = exact_match if exact_match is not None else contains_match
    if node is None:
        return None

    clickable = _clickable_ancestor(node, parents)
    if clickable is None:
        clickable = node
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
# WEBVIEW (Chrome DevTools Protocol over ADB)
# ------------------------
#
# Eitri-Apps run inside an Android WebView. When the host app enables
# WebView.setWebContentsDebuggingEnabled(true) (default in Eitri-Play debug
# builds), the WebView exposes a CDP endpoint on the abstract unix socket
# @webview_devtools_remote_<pid>. We forward it with `adb forward` and speak
# CDP over a minimal WebSocket client — no external dependencies.

_DEVTOOLS_SOCKET_RE = re.compile(r'@(\S*devtools_remote\S*)')


@contextlib.contextmanager
def _devtools_forward(socket_name):
    port = free_port()
    run(f"adb forward tcp:{port} localabstract:{socket_name}")
    try:
        yield port
    finally:
        run(f"adb forward --remove tcp:{port}")


def _devtools_get(port, path, timeout=10):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                                 headers={"Host": f"127.0.0.1:{port}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _pid_package_map():
    out = run("adb shell ps -A 2>/dev/null || adb shell ps")
    mapping = {}

    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 2:
            continue
        pid = parts[1] if parts[1].isdigit() else (parts[0] if parts[0].isdigit() else None)
        if pid:
            mapping[pid] = parts[-1]

    return mapping


def webview_sockets(include_stetho=False):
    out = run("adb shell cat /proc/net/unix")
    names = []

    for line in out.splitlines():
        m = _DEVTOOLS_SOCKET_RE.search(line)
        if not m:
            continue
        name = m.group(1)
        # Stetho sockets belong to other apps and don't serve CDP — they only stall us
        if not include_stetho and name.startswith("stetho_"):
            continue
        if name not in names:
            names.append(name)

    return names


def webview_targets():
    packages = _pid_package_map()
    targets = []

    for name in webview_sockets():
        pid_match = re.search(r'_(\d+)$', name)
        pid = pid_match.group(1) if pid_match else None
        base = {"socket": name, "pid": pid, "package": packages.get(pid)}

        try:
            with _devtools_forward(name) as port:
                pages = _devtools_get(port, "/json/list")
        except Exception as e:
            targets.append({**base, "error": str(e)})
            continue

        for page in pages:
            if page.get("type") != "page":
                continue
            ws = page.get("webSocketDebuggerUrl", "")
            page_id = ws.rsplit("/", 1)[-1] if ws else page.get("id")
            targets.append({
                **base,
                "page_id": page_id,
                "title": page.get("title"),
                "url": page.get("url"),
                "eitri_env": eitri_environment(page.get("url")),
            })

    return targets


def _is_foreground(port, page_id, timeout=2.5):
    """Only the WebView actually on screen produces frames, so Page.captureScreenshot
    answers for the foreground page and times out for backgrounded ones."""
    cdp = None
    try:
        cdp = webinspect.ChromeInspector(f"ws://127.0.0.1:{port}/devtools/page/{page_id}", timeout=timeout)
        cdp.call("Page.captureScreenshot", {"format": "jpeg", "quality": 1}, timeout=timeout)
        return True
    except Exception:
        return False
    finally:
        if cdp:
            cdp.close()


def foreground_target(targets=None):
    """Returns the target whose WebView is currently rendering on screen, if any."""
    targets = targets if targets is not None else [
        t for t in webview_targets() if not t.get("error") and t.get("page_id")
    ]
    ranked = sorted(targets, key=lambda t: -target_score(t))

    for socket_name in dict.fromkeys(t["socket"] for t in ranked):
        same = [t for t in ranked if t["socket"] == socket_name]
        with _devtools_forward(socket_name) as port:
            for t in same:
                if _is_foreground(port, t["page_id"]):
                    return {**t, "foreground": True}

    return None


@contextlib.contextmanager
def _page_session(match=None, index=0, foreground=True):
    targets = [t for t in webview_targets() if not t.get("error") and t.get("page_id")]

    if match:
        needle = match.lower()
        targets = [t for t in targets
                   if needle in f"{t.get('url') or ''} {t.get('title') or ''} {t.get('package') or ''}".lower()]
    else:
        # most-likely Eitri-App page first; stable order otherwise
        targets.sort(key=lambda t: -target_score(t))

        # Eitri-Play keeps every visited Eitri-App alive in its own WebView, so
        # prefer the one actually on screen instead of the first in the list.
        if foreground and len(targets) > 1:
            visible = foreground_target(targets)
            if visible:
                targets = [visible] + [t for t in targets if t["page_id"] != visible["page_id"]]

    if not targets:
        raise RuntimeError(
            "no debuggable webview found — check that the device is connected (`adb devices`), "
            "the Eitri-App is in the foreground, and the host app enables WebView debugging "
            "(WebContentsDebuggingEnabled). Try `webview_targets` to inspect."
        )

    target = targets[min(index, len(targets) - 1)]

    with _devtools_forward(target["socket"]) as port:
        cdp = webinspect.ChromeInspector(f"ws://127.0.0.1:{port}/devtools/page/{target['page_id']}")
        try:
            yield cdp, target
        finally:
            cdp.close()


def webview_html(selector=None, match=None, index=0, foreground=True, out_path=TMP_WEBVIEW_HTML, inline_limit=4000):
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        expr = (f"document.querySelector({json.dumps(selector)}).outerHTML"
                if selector else "document.documentElement.outerHTML")
        html = cdp.evaluate(expr)
        url = cdp.evaluate("location.href")
        title = cdp.evaluate("document.title")

    if html is None:
        return {"error": "selector matched nothing", "selector": selector}

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    result = {
        "path": out_path,
        "length": len(html),
        "url": url,
        "title": title,
        "package": target.get("package"),
        "selector": selector,
    }
    if len(html) <= inline_limit:
        result["html"] = html
    else:
        result["hint"] = f"HTML written to {out_path} — Read/Grep it instead of dumping inline"

    return result


def webview_dom(selector=None, match=None, index=0, foreground=True, max_depth=30, only_visible=True,
                out_path=TMP_WEBVIEW_DOM, inline_limit=20000):
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        data = cdp.evaluate(dom_js(selector, max_depth, only_visible))

    if not isinstance(data, dict) or not data.get("tree"):
        return {"error": "could not build dom tree", "selector": selector, "got": str(data)[:200]}

    data["package"] = target.get("package")
    payload = json.dumps(data, ensure_ascii=False, indent=2)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(payload)

    if len(payload) <= inline_limit:
        return data

    return {
        "path": out_path,
        "size": len(payload),
        "url": data.get("url"),
        "title": data.get("title"),
        "nodes": data.get("nodes"),
        "package": data.get("package"),
        "hint": f"DOM tree written to {out_path} — Read it, or re-run with a selector / smaller depth",
    }


def webview_eval(expression, match=None, index=0, foreground=True):
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        value = cdp.evaluate(expression)

    return {"value": value, "package": target.get("package")}


def webview_url(match=None, index=0, foreground=True):
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        return {
            "url": cdp.evaluate("location.href"),
            "hash": cdp.evaluate("location.hash"),
            "title": cdp.evaluate("document.title"),
            "readyState": cdp.evaluate("document.readyState"),
            "package": target.get("package"),
        }


def webview_reload(match=None, index=0, foreground=True):
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        cdp.call("Page.enable")
        cdp.call("Page.reload", {"ignoreCache": True})
        return {"action": "reload", "package": target.get("package")}


def webview_console(seconds=5, match=None, index=0, foreground=True, limit=200, only_errors=False):
    # Runtime.enable / Log.enable replay the page's console history before any live
    # event arrives, so the buffer already holds what happened before we attached.
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        cdp.enable_console()
        cdp.drain(seconds)
        events = list(cdp.events)

    entries = [e for e in (console_entry(ev) for ev in events) if e]

    if only_errors:
        entries = [e for e in entries
                   if e.get("type") in webinspect.ERROR_LEVELS]

    return {"package": target.get("package"), "seconds": seconds,
            "count": len(entries), "entries": entries[-limit:]}


def native_tabs():
    """Bottom-tab entries from the native hierarchy (Eitri-Play renders the tab bar natively)."""
    try:
        ui_tree()
        root = ET.parse(TMP_XML).getroot()
    except Exception:
        return []

    _, screen_h = get_display_size()
    threshold = int((screen_h or 0) * 0.85)
    tabs = []

    for node in root.iter():
        label = (node.attrib.get("text") or node.attrib.get("content-desc") or "").strip()
        if not label:
            continue
        nums = list(map(int, re.findall(r'-?\d+', node.attrib.get("bounds", ""))))
        if len(nums) != 4 or nums[1] < threshold:
            continue
        tabs.append({"label": label, "x": (nums[0] + nums[2]) // 2,
                     "y": (nums[1] + nums[3]) // 2, "bounds": nums,
                     "selected": node.attrib.get("selected") == "true"})

    return tabs


def switch_tab(name, timeout=8):
    """Taps a native bottom tab, then reports the Eitri-App WebView that came to front.

    Eitri-Play keeps one WebView per Eitri-App, so switching tabs swaps the page
    the webview_* commands must talk to — this returns the new one.
    """
    tabs = native_tabs()
    needle = name.lower()
    hit = next((t for t in tabs if t["label"].lower() == needle), None) \
        or next((t for t in tabs if needle in t["label"].lower()), None)

    if hit:
        screenshot()
        screen_hash()
        tap(hit["x"], hit["y"])
        method = "native"
    else:
        fallback = smart_tap(text=name)
        if fallback.get("error"):
            return {"error": "tab not found", "tab": name,
                    "available": [t["label"] for t in tabs]}
        method = fallback.get("method", "ocr")

    changed = wait_for_screen_change(timeout=3)

    page = wait_for(lambda: foreground_target(), timeout=timeout, interval=1)

    return {"action": "switch_tab", "tab": hit["label"] if hit else name,
            "method": method, "screen_changed": changed,
            "page": {k: page.get(k) for k in ("title", "url", "eitri_env", "page_id")} if page else None}


def _webview_view_offset():
    """Screen offset (device px) of the WebView container, from the native ui dump."""
    try:
        ui_tree()
        root = ET.parse(TMP_XML).getroot()
    except Exception:
        return 0, 0

    best, best_area = None, 0
    for node in root.iter():
        cls = node.attrib.get("class", "")
        if "WebView" not in cls:
            continue
        nums = list(map(int, re.findall(r'-?\d+', node.attrib.get("bounds", ""))))
        if len(nums) != 4:
            continue
        area = (nums[2] - nums[0]) * (nums[3] - nums[1])
        if area > best_area:
            best, best_area = nums, area

    return (best[0], best[1]) if best else (0, 0)


def webview_tap(selector, match=None, index=0, foreground=True, wait_change=True):
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        time.sleep(0.2)
        box = cdp.evaluate(webinspect.tap_js(selector, scale="dpr"))

    if not box:
        return {"error": "selector matched nothing", "selector": selector}
    if box["w"] <= 0 or box["h"] <= 0:
        return {"error": "element has no visible box", "selector": selector}

    off_x, off_y = _webview_view_offset()
    x, y = int(off_x + box["x"]), int(off_y + box["y"])

    if wait_change:
        screenshot()
        screen_hash()

    tap(x, y)

    result = {"action": "tap", "selector": selector, "x": x, "y": y,
              "text": box.get("text"), "method": "webview"}
    if wait_change:
        result["screen_changed"] = wait_for_screen_change(timeout=3)

    return result


def webview_find(text, match=None, index=0, foreground=True, limit=20):
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        matches = cdp.evaluate(webinspect.find_js(text, limit=limit, scale="dpr"))

    return {"text": text, "count": len(matches or []), "matches": matches or [],
            "package": target.get("package")}


# ------------------------
# MAIN (LLM TOOL)
# ------------------------

def _parse_flags(argv):
    """Splits `--key=value` / `--flag` out of argv, returning (positionals, flags)."""
    positionals, flags = [], {}

    for arg in argv:
        if arg.startswith("--"):
            key, _, value = arg[2:].partition("=")
            flags[key.replace("-", "_")] = value if _ else True
        else:
            positionals.append(arg)

    return positionals, flags


def main():
    if len(sys.argv) < 2:
        log({"error": "no command"})
        return

    cmd = sys.argv[1]
    args, flags = _parse_flags(sys.argv[2:])
    wv_match = flags.get("match")
    wv_index = int(flags.get("index", 0))
    wv_fg = not flags.get("no_foreground", False)

    try:
        if cmd == "tap_text":
            log(smart_tap(text=args[0]))

        elif cmd == "tap_template":
            log(smart_tap(template=args[0]))

        elif cmd == "wait_text":
            timeout = int(args[1]) if len(args) > 1 else 10
            log(smart_wait(text=args[0], timeout=timeout))

        elif cmd == "scroll_to_text":
            direction = args[1] if len(args) > 1 else "up"
            max_swipes = int(args[2]) if len(args) > 2 else 10
            log(scroll_until_found(text=args[0], direction=direction, max_swipes=max_swipes))

        elif cmd == "scroll_and_tap":
            direction = args[1] if len(args) > 1 else "up"
            max_swipes = int(args[2]) if len(args) > 2 else 10
            log(scroll_and_tap(text=args[0], direction=direction, max_swipes=max_swipes))

        elif cmd == "type":
            log(type_text(args[0]))

        elif cmd == "swipe":
            log(swipe(args[0]))

        elif cmd == "back":
            result = back()
            result["screen_changed"] = wait_for_screen_change(timeout=3)
            log(result)

        elif cmd == "tap_xy":
            log(tap(args[0], args[1]))

        elif cmd == "tap_percent":
            log(tap_percent(float(args[0]), float(args[1])))

        elif cmd == "screenshot":
            path = screenshot()
            log({"screenshot": path})

        # --- webview (CDP) ---

        elif cmd == "webview_targets":
            targets = webview_targets()
            if flags.get("foreground"):
                visible = foreground_target([t for t in targets if t.get("page_id")])
                log({"foreground": visible, "targets": targets})
            else:
                log({"targets": targets})

        elif cmd == "tabs":
            log({"tabs": native_tabs()})

        elif cmd == "switch_tab":
            log(switch_tab(args[0]))

        elif cmd == "webview_foreground":
            log(foreground_target() or {"error": "no rendering webview found"})

        elif cmd == "webview_html":
            log(webview_html(selector=args[0] if args else None,
                             match=wv_match, index=wv_index, foreground=wv_fg,
                             out_path=flags.get("out", TMP_WEBVIEW_HTML)))

        elif cmd == "webview_dom":
            log(webview_dom(selector=args[0] if args else None,
                            match=wv_match, index=wv_index, foreground=wv_fg,
                            max_depth=int(flags.get("depth", 30)),
                            only_visible=not flags.get("all", False),
                            out_path=flags.get("out", TMP_WEBVIEW_DOM)))

        elif cmd == "webview_find":
            log(webview_find(args[0], match=wv_match, index=wv_index, foreground=wv_fg,
                             limit=int(flags.get("limit", 20))))

        elif cmd == "webview_tap":
            log(webview_tap(args[0], match=wv_match, index=wv_index, foreground=wv_fg))

        elif cmd == "webview_eval":
            log(webview_eval(args[0], match=wv_match, index=wv_index, foreground=wv_fg))

        elif cmd == "webview_url":
            log(webview_url(match=wv_match, index=wv_index, foreground=wv_fg))

        elif cmd == "webview_reload":
            log(webview_reload(match=wv_match, index=wv_index, foreground=wv_fg))

        elif cmd == "webview_console":
            log(webview_console(seconds=float(args[0]) if args else 5,
                                match=wv_match, index=wv_index, foreground=wv_fg,
                                limit=int(flags.get("limit", 200)),
                                only_errors=bool(flags.get("errors", False))))

        else:
            log({"error": "unknown command", "command": cmd})

    except Exception as e:
        log({"error": str(e)})


if __name__ == "__main__":
    main()