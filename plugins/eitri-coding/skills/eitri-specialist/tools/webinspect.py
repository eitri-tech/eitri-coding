#!/usr/bin/env python3
"""Remote web-inspector plumbing shared by android.py (Chrome DevTools Protocol,
over `adb forward`) and ios.py (WebKit Inspector, over ios_webkit_debug_proxy).

Everything protocol-agnostic lives here: the minimal WebSocket client, the
request/response session, and the JavaScript payloads that read the live DOM of
an Eitri-App running inside a WebView.
"""

import base64
import json
import os
import re
import socket
import struct
import time


# ------------------------
# MINIMAL WEBSOCKET CLIENT
# ------------------------

class WebSocketClient:
    """Minimal RFC6455 client — just enough for inspector traffic (text frames, no extensions)."""

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
                raise ConnectionError("inspector closed during handshake")
            self.buf += chunk

        head, self.buf = self.buf.split(b"\r\n\r\n", 1)
        status = head.split(b"\r\n")[0].decode("latin-1")
        if "101" not in status:
            raise ConnectionError(f"websocket upgrade failed: {status}")

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("inspector socket closed")
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
                raise ConnectionError("inspector closed the connection")

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


# ------------------------
# INSPECTOR SESSIONS
# ------------------------

class Inspector:
    """Request/response + event buffering over a single inspector WebSocket."""

    def __init__(self, ws_url, timeout=15):
        m = re.match(r'wss?://([^:/]+):(\d+)(/.*)', ws_url)
        if not m:
            raise ValueError(f"bad websocket url: {ws_url}")
        self.ws = WebSocketClient(m.group(1), int(m.group(2)), m.group(3), timeout=timeout)
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

    def try_call(self, method, params=None, timeout=10):
        try:
            return self.call(method, params, timeout=timeout)
        except Exception:
            return None

    def evaluate(self, expression, timeout=25):
        raise NotImplementedError

    def enable_console(self):
        raise NotImplementedError

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


class ChromeInspector(Inspector):
    """Chrome DevTools Protocol — Android WebView."""

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

    def enable_console(self):
        # Runtime.enable / Log.enable replay the console history captured before we attached
        self.try_call("Runtime.enable")
        self.try_call("Log.enable")


class WebKitInspector(Inspector):
    """WebKit Inspector Protocol — iOS WKWebView (via ios_webkit_debug_proxy).

    Differences from CDP that matter here: `awaitPromise` is a separate command
    instead of an evaluate flag, failures are flagged with `wasThrown`, and
    console events arrive as `Console.messageAdded`.
    """

    def evaluate(self, expression, timeout=25):
        res = self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "includeCommandLineAPI": True,
            "emulateUserGesture": True,
        }, timeout=timeout)

        result = res.get("result", {})

        if res.get("wasThrown") or res.get("exceptionDetails"):
            raise RuntimeError(result.get("description")
                               or (res.get("exceptionDetails") or {}).get("text")
                               or "evaluation failed")

        if result.get("subtype") == "promise" and result.get("objectId"):
            awaited = self.call("Runtime.awaitPromise", {
                "promiseObjectId": result["objectId"],
                "returnByValue": True,
            }, timeout=timeout)
            if awaited.get("wasThrown"):
                raise RuntimeError(awaited.get("result", {}).get("description", "promise rejected"))
            return awaited.get("result", {}).get("value")

        return result.get("value")

    def enable_console(self):
        self.try_call("Inspector.enable")
        self.try_call("Console.enable")
        self.try_call("Runtime.enable")


# ------------------------
# CONSOLE NORMALIZATION
# ------------------------

def console_entry(event):
    """Normalizes a CDP or WebKit console/error event into one flat dict."""
    method = event.get("method")
    params = event.get("params", {})

    if method == "Runtime.consoleAPICalled":  # CDP
        args = [a.get("value", a.get("description", a.get("type")))
                for a in params.get("args", [])]
        frame = (params.get("stackTrace", {}).get("callFrames") or [{}])[0]
        return {"type": params.get("type"), "args": args, "ts": params.get("timestamp"),
                "url": frame.get("url"), "line": frame.get("lineNumber")}

    if method == "Log.entryAdded":  # CDP
        e = params.get("entry", {})
        return {"type": e.get("level"), "source": e.get("source"), "text": e.get("text"),
                "url": e.get("url"), "line": e.get("lineNumber"), "ts": e.get("timestamp")}

    if method == "Runtime.exceptionThrown":  # CDP
        d = params.get("exceptionDetails", {})
        return {"type": "exception",
                "text": d.get("exception", {}).get("description") or d.get("text"),
                "url": d.get("url"), "line": d.get("lineNumber"), "ts": params.get("timestamp")}

    if method == "Console.messageAdded":  # WebKit
        m = params.get("message", {})
        args = [p.get("value", p.get("description", p.get("type")))
                for p in (m.get("parameters") or [])]
        entry = {"type": m.get("level"), "source": m.get("source"), "text": m.get("text"),
                 "url": m.get("url"), "line": m.get("line")}
        if args:
            entry["args"] = args
        return entry

    return None


ERROR_LEVELS = ("error", "exception", "warning", "assert", "critical")


# ------------------------
# INJECTED JAVASCRIPT
# ------------------------

_DOM_JS = r"""
(() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','META','LINK','HEAD','BR']);
  const KEEP_ATTRS = ['id','role','type','name','href','src','alt','title','placeholder','value',
                      'aria-label','aria-hidden','data-testid','disabled','checked'];
  const dpr = window.devicePixelRatio || 1;
  const SCALE = __SCALE__;
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

    if (visible) node.box = [Math.round(r.left * SCALE), Math.round(r.top * SCALE),
                             Math.round(r.width * SCALE), Math.round(r.height * SCALE)];
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
    viewport: [Math.round(window.innerWidth * SCALE), Math.round(window.innerHeight * SCALE)],
    dpr: dpr,
    scale: SCALE,
    scroll: [Math.round(window.scrollX), Math.round(window.scrollY)],
    nodes: count,
    tree: tree
  };
})()
"""

_FIND_JS = r"""
(() => {
  const needle = __TEXT__.toLowerCase();
  const dpr = window.devicePixelRatio || 1;
  const SCALE = __SCALE__;
  const out = [];
  const path = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      if (cur.id) { parts.unshift('#' + CSS.escape(cur.id)); break; }
      let seg = cur.tagName.toLowerCase();
      const p = cur.parentElement;
      if (p) {
        const same = Array.from(p.children).filter(c => c.tagName === cur.tagName);
        if (same.length > 1) seg += ':nth-of-type(' + (same.indexOf(cur) + 1) + ')';
      }
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  };
  for (const el of document.querySelectorAll('body *')) {
    const own = Array.from(el.childNodes).filter(n => n.nodeType === 3)
      .map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const label = el.getAttribute('aria-label') || '';
    if (!own && !label) continue;
    if (!(own.toLowerCase().includes(needle) || label.toLowerCase().includes(needle))) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    out.push({ tag: el.tagName.toLowerCase(), selector: path(el),
               text: (own || label).slice(0, 120),
               box: [Math.round(r.left * SCALE), Math.round(r.top * SCALE),
                     Math.round(r.width * SCALE), Math.round(r.height * SCALE)] });
    if (out.length >= __LIMIT__) break;
  }
  return out;
})()
"""

_TAP_JS = r"""
(() => {
  const el = document.querySelector(__SELECTOR__);
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const SCALE = __SCALE__;
  return { x: (r.left + r.width / 2) * SCALE, y: (r.top + r.height / 2) * SCALE,
           w: r.width, h: r.height, dpr: window.devicePixelRatio || 1,
           text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80) };
})()
"""


def dom_js(root_selector=None, max_depth=30, only_visible=True, scale="dpr"):
    """`scale` converts CSS pixels into the unit the device layer taps in:
    "dpr" for Android (physical pixels) or "1" for iOS (points)."""
    return (_DOM_JS
            .replace("__MAX_DEPTH__", str(int(max_depth)))
            .replace("__ONLY_VISIBLE__", "true" if only_visible else "false")
            .replace("__ROOT__", json.dumps(root_selector or "body"))
            .replace("__SCALE__", scale))


def find_js(text, limit=20, scale="dpr"):
    return (_FIND_JS
            .replace("__TEXT__", json.dumps(text))
            .replace("__LIMIT__", str(int(limit)))
            .replace("__SCALE__", scale))


def tap_js(selector, scale="dpr"):
    return (_TAP_JS
            .replace("__SELECTOR__", json.dumps(selector))
            .replace("__SCALE__", scale))


# ------------------------
# EITRI DOMAINS
# ------------------------

# `api.eitri.tech` serves Eitri-Apps in development; published apps come from the
# release domains. Local dev servers are matched as a fallback.
# Override with EITRI_URL_HINTS="hint1,hint2".
EITRI_DEV_DOMAINS = ("api.eitri.tech",)
EITRI_PROD_DOMAINS = ("release.eitri.calindra.com.br", "release.eitri.tech")
LOCAL_HINTS = ("localhost", "127.0.0.1", "192.168.", "10.0.2.2")

EITRI_URL_HINTS = [h.strip().lower() for h in os.environ.get(
    "EITRI_URL_HINTS",
    ",".join(EITRI_DEV_DOMAINS + EITRI_PROD_DOMAINS + LOCAL_HINTS)
).split(",") if h.strip()]

DEPRIORITIZED_URLS = ("about:blank", "chrome-extension://", "devtools://", "data:")


def eitri_environment(url):
    """Classifies a page URL as an Eitri development / production / local build."""
    url = (url or "").lower()

    if any(d in url for d in EITRI_DEV_DOMAINS):
        return "development"
    if any(d in url for d in EITRI_PROD_DOMAINS):
        return "production"
    if any(h in url for h in LOCAL_HINTS):
        return "local"

    return None


def target_score(target):
    url = (target.get("url") or "").lower()

    if not url or url.startswith(DEPRIORITIZED_URLS):
        return -1
    if eitri_environment(url) in ("development", "production"):
        return 3
    if any(hint in url for hint in EITRI_URL_HINTS):
        return 2
    if url.startswith(("http://", "https://", "file://")):
        return 1

    return 0


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port
