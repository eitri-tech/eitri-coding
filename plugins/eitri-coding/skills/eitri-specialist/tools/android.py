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


class _WS:
    """Minimal RFC6455 client — just enough for CDP (text frames, no extensions)."""

    def __init__(self, host, port, path, timeout=15):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        self.buf = b""
        key = base64.b64encode(os.urandom(16)).decode()
        req = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n\r\n"
        )
        self.sock.sendall(req.encode())

        while b"\r\n\r\n" not in self.buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("devtools closed during handshake")
            self.buf += chunk

        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n")[0].decode("latin-1")
        if "101" not in status:
            raise ConnectionError(f"websocket upgrade failed: {status}")

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("devtools socket closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _frame(self):
        b1, b2 = self._read(2)
        fin, opcode = b1 & 0x80, b1 & 0x0F
        masked, length = b2 & 0x80, b2 & 0x7F

        if length == 126:
            length = struct.unpack(">H", self._read(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", self._read(8))[0]

        mask = self._read(4) if masked else None
        payload = self._read(length) if length else b""
        if mask:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

        return fin, opcode, payload

    def send(self, text):
        payload = text.encode()
        header = bytearray([0x81])
        n = len(payload)

        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack(">H", n)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", n)

        mask = os.urandom(4)
        header += mask
        self.sock.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def recv(self, timeout=15):
        self.sock.settimeout(max(timeout, 0.1))
        chunks = []

        while True:
            fin, opcode, payload = self._frame()

            if opcode == 0x9:  # ping
                self.sock.sendall(b"\x8a\x80" + os.urandom(4))
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode == 0x8:
                raise ConnectionError("devtools closed the connection")

            chunks.append(payload)
            if fin:
                return b"".join(chunks).decode("utf-8", "replace")

    def close(self):
        try:
            self.sock.sendall(b"\x88\x80" + os.urandom(4))
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


class CDP:
    def __init__(self, ws_url, timeout=15):
        m = re.match(r'ws://([^:/]+):(\d+)(/.*)', ws_url)
        if not m:
            raise ValueError(f"bad websocket url: {ws_url}")
        self.ws = _WS(m.group(1), int(m.group(2)), m.group(3), timeout=timeout)
        self.events = []
        self._id = 0

    def call(self, method, params=None, timeout=20):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))

        deadline = time.time() + timeout
        while time.time() < deadline:
            data = json.loads(self.ws.recv(timeout=deadline - time.time()))
            if data.get("id") == mid:
                if "error" in data:
                    raise RuntimeError(f"{method}: {data['error'].get('message')}")
                return data.get("result", {})
            if "method" in data:
                self.events.append(data)

        raise TimeoutError(f"{method} timed out")

    def evaluate(self, expression, timeout=25):
        res = self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
            "includeCommandLineAPI": True,
        }, timeout=timeout)

        if res.get("exceptionDetails"):
            desc = res["exceptionDetails"].get("exception", {}).get("description")
            raise RuntimeError(desc or res["exceptionDetails"].get("text", "evaluation failed"))

        return res.get("result", {}).get("value")

    def drain(self, seconds, on_event=None):
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                data = json.loads(self.ws.recv(timeout=deadline - time.time()))
            except (socket.timeout, ConnectionError, TimeoutError):
                break
            if "method" in data:
                self.events.append(data)
                if on_event:
                    on_event(data)

    def close(self):
        self.ws.close()


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@contextlib.contextmanager
def _devtools_forward(socket_name):
    port = _free_port()
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


# Domains that serve Eitri-Apps: `api.eitri.tech` in development, and
# `release.eitri.calindra.com.br` once published. Local dev servers
# (`eitri start` / `eitri app start`) are also matched as a fallback.
# Override with EITRI_URL_HINTS="hint1,hint2" if your setup differs.
EITRI_DEV_DOMAIN = "api.eitri.tech"
EITRI_PROD_DOMAIN = "release.eitri.calindra.com.br"
EITRI_PROD_DOMAIN_2 = "release.eitri.tech"

EITRI_URL_HINTS = [h.strip().lower() for h in os.environ.get(
    "EITRI_URL_HINTS",
    f"{EITRI_DEV_DOMAIN},{EITRI_PROD_DOMAIN},{EITRI_PROD_DOMAIN_2},localhost,127.0.0.1,192.168.,10.0.2.2"
).split(",") if h.strip()]

_DEPRIORITIZED_URLS = ("about:blank", "chrome-extension://", "devtools://", "data:")


def eitri_environment(url):
    """Classifies a page URL as an Eitri development / production / local build."""
    url = (url or "").lower()

    if EITRI_DEV_DOMAIN in url:
        return "development"
    if EITRI_PROD_DOMAIN in url:
        return "production"
    if any(h in url for h in ("localhost", "127.0.0.1", "192.168.", "10.0.2.2")):
        return "local"

    return None


def _target_score(target):
    url = (target.get("url") or "").lower()

    if not url or url.startswith(_DEPRIORITIZED_URLS):
        return -1
    if EITRI_DEV_DOMAIN in url or EITRI_PROD_DOMAIN in url:
        return 3
    if any(hint in url for hint in EITRI_URL_HINTS):
        return 2
    if url.startswith(("http://", "https://", "file://")):
        return 1

    return 0


def _is_foreground(port, page_id, timeout=2.5):
    """Only the WebView actually on screen produces frames, so Page.captureScreenshot
    answers for the foreground page and times out for backgrounded ones."""
    cdp = None
    try:
        cdp = CDP(f"ws://127.0.0.1:{port}/devtools/page/{page_id}", timeout=timeout)
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
    ranked = sorted(targets, key=lambda t: -_target_score(t))

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
        targets.sort(key=lambda t: -_target_score(t))

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
        cdp = CDP(f"ws://127.0.0.1:{port}/devtools/page/{target['page_id']}")
        try:
            yield cdp, target
        finally:
            cdp.close()


_DOM_JS = r"""
(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','META','LINK','HEAD','BR']);
  const KEEP_ATTRS = ['id','role','type','name','href','src','alt','title','placeholder','value',
                      'aria-label','aria-hidden','data-testid','disabled','checked'];
  const dpr = window.devicePixelRatio || 1;
  const MAX_DEPTH = __MAX_DEPTH__;
  const ONLY_VISIBLE = __ONLY_VISIBLE__;
  const root = document.querySelector(__ROOT__) || document.body;
  let count = 0;

  // Eitri views run in a WebView with React (Luminus) handlers — there is no
  // `onclick` attribute and usually no `cursor-pointer` class, so the only
  // reliable tap signal is React's internal props object on the DOM node.
  const REACT_KEY = (() => {
    for (const el of document.querySelectorAll('body *')) {
      const k = Object.keys(el).find(k => k.startsWith('__reactProps$'));
      if (k) return k;
    }
    return null;
  })();

  const reactHandlers = (el) => {
    const p = REACT_KEY ? el[REACT_KEY] : null;
    if (!p) return null;
    const found = ['onClick', 'onPointerDown', 'onMouseDown', 'onTouchEnd', 'onTouchStart', 'onChange', 'onInput']
      .filter(h => typeof p[h] === 'function');
    return found.length ? found : null;
  };

  const path = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let seg = cur.tagName.toLowerCase();
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      const parent = cur.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (sameTag.length > 1) seg += ':nth-of-type(' + (sameTag.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };

  const walk = (el, depth) => {
    if (SKIP.has(el.tagName)) return null;

    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const visible = r.width > 0 && r.height > 0 &&
                    cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    if (ONLY_VISIBLE && !visible) return null;

    count++;
    const node = { tag: el.tagName.toLowerCase() };

    const cls = (el.getAttribute('class') || '').trim();
    if (cls) node.class = cls.length > 200 ? cls.slice(0, 200) + '…' : cls;

    const attrs = {};
    for (const a of KEEP_ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v !== null && v !== undefined && v !== '') attrs[a] = String(v).slice(0, 160);
    }
    if (Object.keys(attrs).length) node.attrs = attrs;

    const ownText = Array.from(el.childNodes)
      .filter(n => n.nodeType === 3)
      .map(n => n.textContent.replace(/\s+/g, ' ').trim())
      .filter(Boolean).join(' ');
    if (ownText) node.text = ownText.slice(0, 200);

    if (visible) node.box = [Math.round(r.left * dpr), Math.round(r.top * dpr),
                             Math.round(r.width * dpr), Math.round(r.height * dpr)];
    if (!visible) node.hidden = true;
    if (el.scrollHeight - el.clientHeight > 4) node.scrollable = true;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      node.selector = path(el);
      if (el.value) node.value = String(el.value).slice(0, 120);
    }
    // `cursor: pointer` is inherited, so only trust it on leaf/text nodes —
    // otherwise every wrapper div in the tree looks clickable.
    const handlers = reactHandlers(el);
    const interactive =
      !!handlers ||
      ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'].includes(el.tagName) ||
      el.getAttribute('role') === 'button' ||
      el.hasAttribute('onclick') ||
      (cs.cursor === 'pointer' && (ownText || el.children.length === 0));

    if (interactive) {
      node.clickable = true;
      if (handlers) node.handlers = handlers;
      node.selector = node.selector || path(el);
    }

    if (depth < MAX_DEPTH) {
      const children = [];
      for (const child of el.children) {
        const c = walk(child, depth + 1);
        if (c) children.push(c);
      }
      if (children.length) node.children = children;
    } else if (el.children.length) {
      node.truncated = el.children.length;
    }

    return node;
  };

  const tree = walk(root, 0);

  return {
    url: location.href,
    title: document.title,
    viewport: [Math.round(window.innerWidth * dpr), Math.round(window.innerHeight * dpr)],
    dpr: dpr,
    scroll: [Math.round(window.scrollX), Math.round(window.scrollY)],
    nodes: count,
    tree: tree
  };
})()
"""


def _dom_js(root_selector=None, max_depth=30, only_visible=True):
    return (_DOM_JS
            .replace("__MAX_DEPTH__", str(int(max_depth)))
            .replace("__ONLY_VISIBLE__", "true" if only_visible else "false")
            .replace("__ROOT__", json.dumps(root_selector or "body")))


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
        data = cdp.evaluate(_dom_js(selector, max_depth, only_visible))

    if not data:
        return {"error": "could not build dom tree", "selector": selector}

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


def _console_entry(event):
    method = event.get("method")
    params = event.get("params", {})

    if method == "Runtime.consoleAPICalled":
        args = [a.get("value", a.get("description", a.get("type")))
                for a in params.get("args", [])]
        frame = (params.get("stackTrace", {}).get("callFrames") or [{}])[0]
        return {"type": params.get("type"), "args": args, "ts": params.get("timestamp"),
                "url": frame.get("url"), "line": frame.get("lineNumber")}

    if method == "Log.entryAdded":
        e = params.get("entry", {})
        return {"type": e.get("level"), "source": e.get("source"), "text": e.get("text"),
                "url": e.get("url"), "line": e.get("lineNumber"), "ts": e.get("timestamp")}

    if method == "Runtime.exceptionThrown":
        d = params.get("exceptionDetails", {})
        return {"type": "exception",
                "text": d.get("exception", {}).get("description") or d.get("text"),
                "url": d.get("url"), "line": d.get("lineNumber"),
                "ts": params.get("timestamp")}

    return None


def webview_console(seconds=5, match=None, index=0, foreground=True, limit=200, only_errors=False):
    # Runtime.enable / Log.enable replay the page's console history before any live
    # event arrives, so the buffer already holds what happened before we attached.
    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        cdp.call("Runtime.enable")
        cdp.call("Log.enable")
        cdp.drain(seconds)
        events = list(cdp.events)

    entries = [e for e in (_console_entry(ev) for ev in events) if e]

    if only_errors:
        entries = [e for e in entries
                   if e.get("type") in ("error", "exception", "warning", "assert")]

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
    js = f"""
    (() => {{
      const el = document.querySelector({json.dumps(selector)});
      if (!el) return null;
      el.scrollIntoView({{ block: 'center', inline: 'center' }});
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      return {{ x: (r.left + r.width / 2) * dpr, y: (r.top + r.height / 2) * dpr,
                w: r.width, h: r.height,
                text: (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 80) }};
    }})()
    """

    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        time.sleep(0.2)
        box = cdp.evaluate(js)

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
    js = f"""
    (() => {{
      const needle = {json.dumps(text)}.toLowerCase();
      const dpr = window.devicePixelRatio || 1;
      const out = [];
      const path = (el) => {{
        if (el.id) return '#' + CSS.escape(el.id);
        const parts = [];
        let cur = el;
        while (cur && cur.nodeType === 1 && parts.length < 6) {{
          if (cur.id) {{ parts.unshift('#' + CSS.escape(cur.id)); break; }}
          let seg = cur.tagName.toLowerCase();
          const p = cur.parentElement;
          if (p) {{
            const same = Array.from(p.children).filter(c => c.tagName === cur.tagName);
            if (same.length > 1) seg += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
          }}
          parts.unshift(seg);
          cur = cur.parentElement;
        }}
        return parts.join(' > ');
      }};
      for (const el of document.querySelectorAll('body *')) {{
        const own = Array.from(el.childNodes).filter(n => n.nodeType === 3)
          .map(n => n.textContent).join(' ').replace(/\\s+/g, ' ').trim();
        const label = el.getAttribute('aria-label') || '';
        if (!own && !label) continue;
        if (!(own.toLowerCase().includes(needle) || label.toLowerCase().includes(needle))) continue;
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        out.push({{ tag: el.tagName.toLowerCase(), selector: path(el),
                    text: (own || label).slice(0, 120),
                    box: [Math.round(r.left*dpr), Math.round(r.top*dpr),
                          Math.round(r.width*dpr), Math.round(r.height*dpr)] }});
        if (out.length >= {int(limit)}) break;
      }}
      return out;
    }})()
    """

    with _page_session(match=match, index=index, foreground=foreground) as (cdp, target):
        matches = cdp.evaluate(js)

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