#!/usr/bin/env python3
"""iOS Simulator counterpart of android.py — same command surface, macOS-only.

Layers:
  * `xcrun simctl`             — screenshot, boot state, launch/terminate, openurl
  * `idb`                      — taps, swipes, typing, native accessibility tree
  * `ios_webkit_debug_proxy`   — bridge to the WKWebView's Web Inspector
  * WebKit Inspector protocol  — live DOM of the Eitri-App (see webinspect.py)

Requirements:
    brew install idb-companion ios-webkit-debug-proxy
    pip install fb-idb

The WKWebView must be inspectable: since iOS 16.4 the host app has to set
`webView.isInspectable = true` (the analogue of Android's
setWebContentsDebuggingEnabled). Without it `webview_targets` comes back empty
while the native commands keep working.

Coordinate note: `idb` taps in POINTS while screenshots are in PIXELS, so the
injected JS reports boxes in CSS pixels (scale=1, which equals points for a
WKWebView) and `screenshot_scale()` reports the pixel/point factor for anyone
reading coordinates off an image.
"""

import contextlib
import json
import os
import re
import subprocess
import sys
import time
import urllib.request

import webinspect
from webinspect import eitri_environment, target_score

TMP_SCREEN = "/tmp/ios_screen.png"
TMP_WEBVIEW_HTML = "/tmp/ios_webview.html"
TMP_WEBVIEW_DOM = "/tmp/ios_webview_dom.json"
TMP_AX_TREE = "/tmp/ios_ax.json"

IWDP_DEVICE_PORT = int(os.environ.get("IWDP_DEVICE_PORT", 9221))
IWDP_PAGE_PORTS = range(IWDP_DEVICE_PORT + 1, IWDP_DEVICE_PORT + 12)

# iOS taps in points; CSS pixels of a WKWebView are points too
WEBVIEW_SCALE = "1"

_last_screen_hash = None


# ------------------------
# CORE
# ------------------------

def run(cmd, timeout=120):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    return result.stdout.strip()


def run_full(cmd, timeout=120):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, timeout=timeout)
    return result.returncode, result.stdout.strip(), result.stderr.strip()


def log(data):
    print(json.dumps(data))


def _have(binary):
    return subprocess.run(f"command -v {binary}", shell=True,
                          capture_output=True, text=True).returncode == 0


def doctor():
    """Reports whether every moving part of the iOS toolchain is present."""
    booted = booted_device()
    report = {
        "platform_ok": sys.platform == "darwin",
        "xcrun": _have("xcrun"),
        "idb": _have("idb"),
        "ios_webkit_debug_proxy": _have("ios_webkit_debug_proxy"),
        "booted_simulator": booted,
        "webinspectord_socket": webinspector_socket(),
        "proxy_running": _proxy_alive(),
    }

    hints = []
    if not report["platform_ok"]:
        hints.append("ios.py only runs on macOS — use android.py elsewhere")
    if not report["idb"]:
        hints.append("brew install idb-companion && pip install fb-idb")
    if not report["ios_webkit_debug_proxy"]:
        hints.append("brew install ios-webkit-debug-proxy")
    if not booted:
        hints.append("boot a simulator: xcrun simctl boot <udid> (or open -a Simulator)")
    if booted and not report["webinspectord_socket"]:
        hints.append("no webinspectord_sim socket — open the app once, and make sure the "
                     "simulator is running (Apple exposes it only via unix socket)")

    if hints:
        report["hints"] = hints

    targets = webview_targets() if booted and report["ios_webkit_debug_proxy"] else []
    report["webview_pages"] = len(targets)
    if booted and not targets:
        report.setdefault("hints", []).append(
            "no inspectable pages — the host app must set WKWebView.isInspectable = true (iOS 16.4+)")

    return report


# ------------------------
# SIMULATOR / DEVICE
# ------------------------

def booted_device():
    out = run("xcrun simctl list devices booted -j")
    try:
        data = json.loads(out)
    except Exception:
        return None

    for runtime, devices in (data.get("devices") or {}).items():
        for d in devices:
            if d.get("state") == "Booted":
                return {"udid": d.get("udid"), "name": d.get("name"), "runtime": runtime}

    return None


def screenshot():
    run(f"xcrun simctl io booted screenshot --type=png {TMP_SCREEN}")
    return TMP_SCREEN


def screen_hash():
    global _last_screen_hash
    import hashlib

    with open(TMP_SCREEN, "rb") as f:
        h = hashlib.md5(f.read()).hexdigest()

    changed = h != _last_screen_hash
    _last_screen_hash = h
    return changed


def wait_for_screen_change(timeout=3, interval=0.25):
    screenshot()
    screen_hash()

    start = time.time()
    while time.time() - start < timeout:
        time.sleep(interval)
        screenshot()
        if screen_hash():
            return True
    return False


def _png_size(path):
    if not path or not os.path.exists(path):
        return None, None
    with open(path, "rb") as f:
        head = f.read(33)
    if head[12:16] != b"IHDR":
        return None, None
    import struct
    w, h = struct.unpack(">II", head[16:24])
    return w, h


def get_display_size():
    """Screen size in POINTS (what idb taps in), derived from the accessibility root."""
    if not booted_device():
        raise RuntimeError("no booted simulator — run `doctor` for the full checklist")

    root = _ax_root_frame()
    if root:
        return int(root["width"]), int(root["height"])

    # fall back to pixels — callers get a scale of 1 and coarser taps
    return _png_size(screenshot())


def screenshot_scale():
    """Pixels per point, so coordinates read off a screenshot can be converted."""
    px_w, _ = _png_size(screenshot())
    pt_w, _ = get_display_size()
    if not px_w or not pt_w:
        return 1.0
    return round(px_w / pt_w, 3)


def launch_app(bundle_id, relaunch=False):
    if relaunch:
        run(f"xcrun simctl terminate booted {bundle_id}")
    code, out, err = run_full(f"xcrun simctl launch booted {bundle_id}")
    return {"action": "launch", "bundle_id": bundle_id,
            "ok": code == 0, "output": out or err}


def open_url(url):
    code, out, err = run_full(f'xcrun simctl openurl booted "{url}"')
    return {"action": "openurl", "url": url, "ok": code == 0, "output": out or err}


# ------------------------
# INPUT (idb)
# ------------------------

def _idb(args, timeout=60):
    if not _have("idb"):
        raise RuntimeError("idb not found — brew install idb-companion && pip install fb-idb")
    code, out, err = run_full(f"idb {args}", timeout=timeout)
    if code != 0:
        raise RuntimeError(f"idb {args.split()[0:2]} failed: {err or out}")
    return out


def tap(x, y):
    x, y = int(x), int(y)
    _idb(f"ui tap {x} {y}")
    return {"action": "tap", "x": x, "y": y}


def tap_percent(px, py):
    w, h = get_display_size()
    return tap(int(px * w), int(py * h))


def type_text(text):
    _idb(f"ui text {json.dumps(text)}")
    return {"action": "type", "text": text}


def key_button(name):
    """idb button names: APPLE_PAY, HOME, LOCK, SIDE_BUTTON, SIRI."""
    _idb(f"ui button {name.upper()}")
    return {"action": "button", "button": name.upper()}


def swipe(direction, duration=0.25):
    w, h = get_display_size()
    cx, cy = w // 2, h // 2
    span_y, span_x = int(h * 0.35), int(w * 0.35)

    routes = {
        "up": (cx, cy + span_y, cx, cy - span_y),
        "down": (cx, cy - span_y, cx, cy + span_y),
        "left": (cx + span_x, cy, cx - span_x, cy),
        "right": (cx - span_x, cy, cx + span_x, cy),
    }

    if direction not in routes:
        return {"error": "invalid direction", "direction": direction}

    x1, y1, x2, y2 = routes[direction]
    _idb(f"ui swipe {x1} {y1} {x2} {y2} --duration {duration}")
    return {"action": "swipe", "direction": direction}


def back():
    """iOS has no back button — the system gesture is an edge swipe from the left."""
    w, h = get_display_size()
    _idb(f"ui swipe 2 {h // 2} {int(w * 0.6)} {h // 2} --duration 0.15")
    return {"action": "back", "method": "edge-swipe"}


# ------------------------
# NATIVE ACCESSIBILITY TREE (idb)
# ------------------------

def ax_tree(out_path=TMP_AX_TREE):
    """`idb ui describe-all` — the iOS analogue of an uiautomator dump."""
    raw = _idb("ui describe-all --json", timeout=90)

    try:
        data = json.loads(raw)
    except Exception:
        data = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data.append(json.loads(line))
            except Exception:
                continue

    if isinstance(data, dict):
        data = data.get("elements") or data.get("children") or [data]

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    return data


def _ax_frame(node):
    frame = node.get("frame") or node.get("AXFrame") or {}
    if isinstance(frame, str):
        nums = [float(n) for n in re.findall(r'-?\d+\.?\d*', frame)]
        if len(nums) == 4:
            frame = {"x": nums[0], "y": nums[1], "width": nums[2], "height": nums[3]}
    if not isinstance(frame, dict):
        return None
    if "width" not in frame or "height" not in frame:
        return None
    return {"x": float(frame.get("x", 0)), "y": float(frame.get("y", 0)),
            "width": float(frame["width"]), "height": float(frame["height"])}


def _ax_label(node):
    for key in ("AXLabel", "label", "AXValue", "title", "name"):
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _ax_flat(nodes=None):
    nodes = ax_tree() if nodes is None else nodes
    flat = []

    def walk(node):
        if not isinstance(node, dict):
            return
        flat.append(node)
        for child in (node.get("children") or []):
            walk(child)

    for node in (nodes if isinstance(nodes, list) else [nodes]):
        walk(node)

    return flat


def _ax_root_frame():
    try:
        frames = [f for f in (_ax_frame(n) for n in _ax_flat()) if f]
    except Exception:
        return None
    if not frames:
        return None
    return max(frames, key=lambda f: f["width"] * f["height"])


def find_element_by_text(text):
    """Locates a native element by accessibility label (Eitri-Play's chrome, tab bar, alerts)."""
    target = text.lower()
    exact, partial = None, None

    for node in _ax_flat():
        label = _ax_label(node).lower()
        if not label or not _ax_frame(node):
            continue
        if label == target:
            exact = node
            break
        if partial is None and target in label:
            partial = node

    node = exact if exact is not None else partial
    if node is None:
        return None

    frame = _ax_frame(node)
    return {"x": int(frame["x"] + frame["width"] / 2),
            "y": int(frame["y"] + frame["height"] / 2),
            "label": _ax_label(node), "exact": exact is not None,
            "confidence": 1.0, "method": "ax"}


def smart_tap(text, wait_change=True):
    found = find_element_by_text(text)
    if not found:
        return {"error": "element not found", "text": text,
                "hint": "native accessibility only sees the app chrome — use webview_find / "
                        "webview_tap for content inside the Eitri-App"}

    if wait_change:
        screenshot()
        screen_hash()

    tap(found["x"], found["y"])
    found["action"] = "tap"
    if wait_change:
        found["screen_changed"] = wait_for_screen_change(timeout=3)

    return found


def smart_wait(text, timeout=10, interval=0.6):
    start = time.time()
    while time.time() - start < timeout:
        found = find_element_by_text(text)
        if found:
            return {"found": True, "method": "ax", "label": found["label"]}
        time.sleep(interval)
    return {"error": "timeout", "text": text}


def native_tabs():
    """Bottom-tab entries (Eitri-Play renders the tab bar natively on iOS too)."""
    _, screen_h = get_display_size()
    threshold = (screen_h or 0) * 0.85
    tabs = []

    for node in _ax_flat():
        label = _ax_label(node)
        frame = _ax_frame(node)
        if not label or not frame or frame["y"] < threshold:
            continue
        node_type = str(node.get("type") or node.get("AXUniqueId") or "")
        tabs.append({"label": label,
                     "x": int(frame["x"] + frame["width"] / 2),
                     "y": int(frame["y"] + frame["height"] / 2),
                     "frame": frame, "type": node_type})

    return tabs


def switch_tab(name, timeout=10):
    """Taps a native bottom tab, then reports the Eitri-App WebView that came to front."""
    tabs = native_tabs()
    needle = name.lower()
    hit = next((t for t in tabs if t["label"].lower() == needle), None) \
        or next((t for t in tabs if needle in t["label"].lower()), None)

    if not hit:
        fallback = smart_tap(name)
        if fallback.get("error"):
            return {"error": "tab not found", "tab": name,
                    "available": [t["label"] for t in tabs]}
        method = "ax"
    else:
        screenshot()
        screen_hash()
        tap(hit["x"], hit["y"])
        method = "native"

    changed = wait_for_screen_change(timeout=3)

    page, deadline = None, time.time() + timeout
    while page is None and time.time() < deadline:
        page = foreground_target()
        if page is None:
            time.sleep(1)

    return {"action": "switch_tab", "tab": hit["label"] if hit else name, "method": method,
            "screen_changed": changed,
            "page": {k: page.get(k) for k in ("title", "url", "eitri_env", "page_id")} if page else None}


# ------------------------
# WEBVIEW BRIDGE (ios_webkit_debug_proxy)
# ------------------------

def webinspector_socket():
    """Apple exposes the simulator's Web Inspector only through a launchd unix socket."""
    override = os.environ.get("IOS_WEBINSPECTOR_SOCKET")
    if override:
        return override

    out = run("lsof -aUc launchd 2>/dev/null | grep -o '/private/tmp/com.apple.launchd.[^ ]*webinspectord_sim.socket' | head -1")
    if out:
        return out.strip()

    out = run("ls /private/tmp/com.apple.launchd.*/com.apple.webinspectord_sim.socket 2>/dev/null | head -1")
    return out.strip() or None


def _http_json(port, path, timeout=4):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}",
                                headers={"Host": f"127.0.0.1:{port}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def _proxy_alive():
    for port in [IWDP_DEVICE_PORT, *IWDP_PAGE_PORTS]:
        try:
            _http_json(port, "/json", timeout=1)
            return True
        except Exception:
            continue
    return False


def start_proxy(wait=8):
    """Starts ios_webkit_debug_proxy against the simulator socket, if not already up.

    Left running on purpose: every command would otherwise pay the startup cost.
    Stop it with `proxy_stop`.
    """
    if _proxy_alive():
        return {"proxy": "already running", "device_port": IWDP_DEVICE_PORT}

    if not _have("ios_webkit_debug_proxy"):
        raise RuntimeError("ios_webkit_debug_proxy not found — brew install ios-webkit-debug-proxy")

    socket_path = webinspector_socket()
    if not socket_path:
        raise RuntimeError("no com.apple.webinspectord_sim.socket found — is a simulator booted "
                           "with the app open? Override with IOS_WEBINSPECTOR_SOCKET=<path>")

    ports = f"null:{IWDP_DEVICE_PORT},:{IWDP_PAGE_PORTS[0]}-{IWDP_PAGE_PORTS[-1]}"
    subprocess.Popen(
        ["ios_webkit_debug_proxy", "-c", ports, "-s", f"unix:{socket_path}"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    deadline = time.time() + wait
    while time.time() < deadline:
        if _proxy_alive():
            return {"proxy": "started", "device_port": IWDP_DEVICE_PORT, "socket": socket_path}
        time.sleep(0.4)

    raise RuntimeError(f"ios_webkit_debug_proxy did not answer on port {IWDP_DEVICE_PORT}")


def stop_proxy():
    run("pkill -f ios_webkit_debug_proxy")
    return {"proxy": "stopped"}


def _page_ports():
    """Ports serving page lists — from the device list when available, else probed."""
    ports = []

    try:
        for device in _http_json(IWDP_DEVICE_PORT, "/json"):
            url = device.get("url") or device.get("webSocketDebuggerUrl") or ""
            m = re.search(r':(\d+)', url)
            if m:
                ports.append(int(m.group(1)))
    except Exception:
        pass

    if not ports:
        for port in IWDP_PAGE_PORTS:
            try:
                _http_json(port, "/json", timeout=1)
                ports.append(port)
            except Exception:
                continue

    return ports


def webview_targets():
    try:
        start_proxy()
    except Exception as e:
        return [{"error": str(e)}]

    targets = []

    for port in _page_ports():
        try:
            pages = _http_json(port, "/json")
        except Exception as e:
            targets.append({"port": port, "error": str(e)})
            continue

        for page in pages:
            ws = page.get("webSocketDebuggerUrl") or ""
            if not ws:
                # a page already claimed by another client (Safari Web Inspector) has no ws url
                targets.append({"port": port, "title": page.get("title"), "url": page.get("url"),
                                "error": "no debugger url — page busy in another inspector"})
                continue
            targets.append({
                "port": port,
                "page_id": page.get("id") or ws.rsplit("/", 1)[-1],
                "ws": ws,
                "title": page.get("title"),
                "url": page.get("url"),
                "eitri_env": eitri_environment(page.get("url")),
            })

    return targets


def _is_foreground(target, timeout=3):
    """WebKit has no Page.captureScreenshot; Page.snapshotRect is the closest probe
    and only the on-screen WKWebView renders one."""
    session = None
    try:
        session = webinspect.WebKitInspector(target["ws"], timeout=timeout)
        session.try_call("Page.enable", timeout=timeout)
        res = session.call("Page.snapshotRect",
                           {"x": 0, "y": 0, "width": 40, "height": 40,
                            "coordinateSystem": "Viewport"}, timeout=timeout)
        return bool(res.get("dataURL"))
    except Exception:
        return False
    finally:
        if session:
            session.close()


def _visual_match(target, timeout=6):
    """Fallback foreground probe: how much of this page matches the simulator screen."""
    try:
        import base64
        import cv2
        import numpy as np
    except Exception:
        return 0.0

    session = None
    try:
        session = webinspect.WebKitInspector(target["ws"], timeout=timeout)
        session.try_call("Page.enable", timeout=timeout)
        w, h = get_display_size()
        res = session.call("Page.snapshotRect",
                           {"x": 0, "y": 0, "width": int(w), "height": int(h),
                            "coordinateSystem": "Viewport"}, timeout=timeout)
        data_url = res.get("dataURL") or ""
        payload = data_url.split(",", 1)[-1]
        page_img = cv2.imdecode(np.frombuffer(base64.b64decode(payload), np.uint8), cv2.IMREAD_COLOR)
        screen = cv2.imread(screenshot())
        if page_img is None or screen is None:
            return 0.0

        scale = screen.shape[1] / page_img.shape[1]
        resized = cv2.resize(page_img, (screen.shape[1], int(page_img.shape[0] * scale)))
        resized = resized[:min(resized.shape[0], screen.shape[0])]
        return float(cv2.matchTemplate(screen, resized, cv2.TM_CCOEFF_NORMED).max())
    except Exception:
        return 0.0
    finally:
        if session:
            session.close()


def foreground_target(targets=None):
    """The WKWebView currently on screen.

    Eitri-Play keeps one WebView per Eitri-App, so several pages stay alive and
    only one of them is visible.
    """
    targets = targets if targets is not None else [
        t for t in webview_targets() if not t.get("error") and t.get("ws")
    ]
    ranked = sorted(targets, key=lambda t: -target_score(t))

    if len(ranked) <= 1:
        return {**ranked[0], "foreground": True, "probe": "only-page"} if ranked else None

    responders = [t for t in ranked if _is_foreground(t)]
    if len(responders) == 1:
        return {**responders[0], "foreground": True, "probe": "snapshot"}

    # several pages answered (or none) — fall back to comparing them with the screen
    candidates = responders or ranked
    scored = sorted(((_visual_match(t), t) for t in candidates), key=lambda p: -p[0])
    best_score, best = scored[0]

    if best_score <= 0:
        return {**candidates[0], "foreground": True, "probe": "unresolved"}

    return {**best, "foreground": True, "probe": "visual", "match": round(best_score, 3)}


@contextlib.contextmanager
def _page_session(match=None, index=0, foreground=True):
    targets = [t for t in webview_targets() if not t.get("error") and t.get("ws")]

    if match:
        needle = match.lower()
        targets = [t for t in targets
                   if needle in f"{t.get('url') or ''} {t.get('title') or ''}".lower()]
    else:
        targets.sort(key=lambda t: -target_score(t))
        if foreground and len(targets) > 1:
            visible = foreground_target(targets)
            if visible:
                targets = [visible] + [t for t in targets if t.get("page_id") != visible.get("page_id")]

    if not targets:
        raise RuntimeError(
            "no inspectable webview found — check `doctor`: a simulator must be booted with the "
            "Eitri-App in the foreground, ios_webkit_debug_proxy installed, and the host app must "
            "set WKWebView.isInspectable = true (iOS 16.4+)"
        )

    target = targets[min(index, len(targets) - 1)]
    session = webinspect.WebKitInspector(target["ws"])
    try:
        yield session, target
    finally:
        session.close()


# ------------------------
# WEBVIEW INSPECTION
# ------------------------

def webview_html(selector=None, match=None, index=0, foreground=True,
                 out_path=TMP_WEBVIEW_HTML, inline_limit=4000):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        expr = (f"document.querySelector({json.dumps(selector)}).outerHTML"
                if selector else "document.documentElement.outerHTML")
        html = session.evaluate(expr)
        url = session.evaluate("location.href")
        title = session.evaluate("document.title")

    if html is None:
        return {"error": "selector matched nothing", "selector": selector}

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    result = {"path": out_path, "length": len(html), "url": url, "title": title,
              "selector": selector}
    if len(html) <= inline_limit:
        result["html"] = html
    else:
        result["hint"] = f"HTML written to {out_path} — Read/Grep it instead of dumping inline"

    return result


def webview_dom(selector=None, match=None, index=0, foreground=True, max_depth=30,
                only_visible=True, out_path=TMP_WEBVIEW_DOM, inline_limit=20000):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        data = session.evaluate(webinspect.dom_js(selector, max_depth, only_visible,
                                                  scale=WEBVIEW_SCALE))

    if not isinstance(data, dict) or not data.get("tree"):
        return {"error": "could not build dom tree", "selector": selector, "got": str(data)[:200]}

    data["units"] = "points"
    payload = json.dumps(data, ensure_ascii=False, indent=2)

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(payload)

    if len(payload) <= inline_limit:
        return data

    return {"path": out_path, "size": len(payload), "url": data.get("url"),
            "title": data.get("title"), "nodes": data.get("nodes"), "units": "points",
            "hint": f"DOM tree written to {out_path} — Read it, or re-run with a selector / smaller depth"}


def webview_find(text, match=None, index=0, foreground=True, limit=20):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        matches = session.evaluate(webinspect.find_js(text, limit=limit, scale=WEBVIEW_SCALE))

    return {"text": text, "count": len(matches or []), "matches": matches or [],
            "units": "points", "url": target.get("url")}


def _webview_view_offset():
    """Screen offset (points) of the WKWebView, from the native accessibility tree."""
    try:
        candidates = []
        for node in _ax_flat():
            frame = _ax_frame(node)
            if not frame:
                continue
            node_type = str(node.get("type") or "")
            if "WebView" in node_type or "Web" in node_type:
                candidates.append(frame)
        if candidates:
            best = max(candidates, key=lambda f: f["width"] * f["height"])
            return int(best["x"]), int(best["y"])
    except Exception:
        pass

    return 0, 0


def webview_tap(selector, match=None, index=0, foreground=True, wait_change=True):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        time.sleep(0.2)
        box = session.evaluate(webinspect.tap_js(selector, scale=WEBVIEW_SCALE))

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
              "text": box.get("text"), "method": "webview", "units": "points"}
    if wait_change:
        result["screen_changed"] = wait_for_screen_change(timeout=3)

    return result


def webview_eval(expression, match=None, index=0, foreground=True):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        return {"value": session.evaluate(expression), "url": target.get("url")}


def webview_url(match=None, index=0, foreground=True):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        return {
            "url": session.evaluate("location.href"),
            "hash": session.evaluate("location.hash"),
            "title": session.evaluate("document.title"),
            "readyState": session.evaluate("document.readyState"),
            "eitri_env": eitri_environment(target.get("url")),
        }


def webview_reload(match=None, index=0, foreground=True):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        session.try_call("Page.enable")
        session.call("Page.reload", {"ignoreCache": True})
        return {"action": "reload", "url": target.get("url")}


def webview_console(seconds=5, match=None, index=0, foreground=True, limit=200, only_errors=False):
    with _page_session(match=match, index=index, foreground=foreground) as (session, target):
        session.enable_console()
        session.drain(seconds)
        events = list(session.events)

    entries = [e for e in (webinspect.console_entry(ev) for ev in events) if e]

    if only_errors:
        entries = [e for e in entries if e.get("type") in webinspect.ERROR_LEVELS]

    return {"seconds": seconds, "count": len(entries), "entries": entries[-limit:],
            "url": target.get("url")}


# ------------------------
# MAIN (LLM TOOL)
# ------------------------

def _parse_flags(argv):
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
        # --- device ---
        if cmd == "doctor":
            log(doctor())

        elif cmd == "device":
            log(booted_device() or {"error": "no booted simulator"})

        elif cmd == "screenshot":
            log({"screenshot": screenshot(), "scale": screenshot_scale()})

        elif cmd == "tap_text":
            log(smart_tap(args[0]))

        elif cmd == "wait_text":
            log(smart_wait(args[0], timeout=int(args[1]) if len(args) > 1 else 10))

        elif cmd == "tap_xy":
            log(tap(args[0], args[1]))

        elif cmd == "tap_percent":
            log(tap_percent(float(args[0]), float(args[1])))

        elif cmd == "type":
            log(type_text(args[0]))

        elif cmd == "swipe":
            log(swipe(args[0]))

        elif cmd == "back":
            result = back()
            result["screen_changed"] = wait_for_screen_change(timeout=3)
            log(result)

        elif cmd == "button":
            log(key_button(args[0]))

        elif cmd == "launch":
            log(launch_app(args[0], relaunch=bool(flags.get("relaunch"))))

        elif cmd == "openurl":
            log(open_url(args[0]))

        elif cmd == "ax_tree":
            data = ax_tree()
            log({"path": TMP_AX_TREE, "nodes": len(_ax_flat(data))})

        elif cmd == "tabs":
            log({"tabs": native_tabs()})

        elif cmd == "switch_tab":
            log(switch_tab(args[0]))

        # --- webview ---
        elif cmd == "proxy_start":
            log(start_proxy())

        elif cmd == "proxy_stop":
            log(stop_proxy())

        elif cmd == "webview_targets":
            targets = webview_targets()
            if flags.get("foreground"):
                visible = foreground_target([t for t in targets if t.get("ws")])
                log({"foreground": visible, "targets": targets})
            else:
                log({"targets": targets})

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
