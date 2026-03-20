#!/usr/bin/env python3

import sys
import subprocess
import time
import xml.etree.ElementTree as ET
import re
import os
import struct

TMP_XML = "/tmp/ui.xml"
TMP_SCREEN = "/tmp/screen.png"


def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return result.stdout.strip()


# ------------------------
# BASIC COMMANDS
# ------------------------

def screenshot():
    run(f"adb exec-out screencap -p > {TMP_SCREEN}")
    print(TMP_SCREEN)


def screenshot_grid(step=100):
    """Capture screenshot and overlay a coordinate grid for precise tapping."""
    from PIL import Image, ImageDraw, ImageFont

    run(f"adb exec-out screencap -p > {TMP_SCREEN}")

    img = Image.open(TMP_SCREEN)
    draw = ImageDraw.Draw(img)
    w, h = img.size

    step = int(step)

    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except Exception:
        font = ImageFont.load_default()

    for x in range(0, w, step):
        draw.line([(x, 0), (x, h)], fill=(255, 0, 0, 160), width=1)
        draw.text((x + 2, 2), str(x), fill=(255, 0, 0), font=font)

    for y in range(0, h, step):
        draw.line([(0, y), (w, y)], fill=(255, 0, 0, 160), width=1)
        draw.text((2, y + 2), str(y), fill=(255, 0, 0), font=font)

    out = "/tmp/screen_grid.png"
    img.save(out)
    print(out)


def ui_tree():
    run("adb shell uiautomator dump /sdcard/ui.xml")
    run(f"adb pull /sdcard/ui.xml {TMP_XML}")
    print(TMP_XML)


def get_display_size():
    out = run("adb shell wm size")
    match = re.search(r'(\d+)x(\d+)', out)
    if match:
        return int(match.group(1)), int(match.group(2))
    return None, None


def get_screenshot_size():
    if not os.path.exists(TMP_SCREEN):
        return None, None
    with open(TMP_SCREEN, 'rb') as f:
        f.read(16)  # skip PNG signature + IHDR chunk header
        w = struct.unpack('>I', f.read(4))[0]
        h = struct.unpack('>I', f.read(4))[0]
    return w, h


def tap(x, y):
    x, y = int(x), int(y)
    disp_w, disp_h = get_display_size()
    scr_w, scr_h = get_screenshot_size()

    if disp_w and scr_w and (disp_w != scr_w or disp_h != scr_h):
        scaled_x = int(x * disp_w / scr_w)
        scaled_y = int(y * disp_h / scr_h)
        print(f"Scaling tap from screenshot ({x},{y}) to display ({scaled_x},{scaled_y})")
        x, y = scaled_x, scaled_y

    run(f"adb shell input tap {x} {y}")
    print(f"Tapped at {x},{y}")


def type_text(text):
    text = text.replace(" ", "%s")
    run(f'adb shell input text "{text}"')
    print(f"Typed: {text}")


def swipe(direction):
    coords = {
        "up": "500 1500 500 500",
        "down": "500 500 500 1500",
        "left": "800 800 200 800",
        "right": "200 800 800 800"
    }

    if direction not in coords:
        print("Invalid direction")
        return

    run(f"adb shell input swipe {coords[direction]}")
    print(f"Swiped {direction}")


def key(keycode):
    run(f"adb shell input keyevent {keycode}")
    print(f"Pressed {keycode}")


# ------------------------
# XML PARSING
# ------------------------

def parse_bounds(bounds):
    # formato: [x1,y1][x2,y2]
    nums = list(map(int, re.findall(r'\d+', bounds)))
    x = (nums[0] + nums[2]) // 2
    y = (nums[1] + nums[3]) // 2
    return x, y


def load_xml():
    if not os.path.exists(TMP_XML):
        ui_tree()

    return ET.parse(TMP_XML).getroot()


def find_element_by_text(text, partial=True):
    root = load_xml()

    for node in root.iter():
        node_text = node.attrib.get("text", "")
        content_desc = node.attrib.get("content-desc", "")

        if partial:
            if text.lower() in node_text.lower() or text.lower() in content_desc.lower():
                return node
        else:
            if text == node_text:
                return node

    return None


# ------------------------
# SMART ACTIONS
# ------------------------

def tap_text(text):
    node = find_element_by_text(text)

    if not node:
        print(f"Element not found: {text}")
        return

    bounds = node.attrib.get("bounds")
    x, y = parse_bounds(bounds)

    tap(x, y)


def wait_for_text(text, timeout=10):
    start = time.time()

    while time.time() - start < timeout:
        ui_tree()
        node = find_element_by_text(text)

        if node:
            print(f"Found: {text}")
            return True

        time.sleep(1)

    print(f"Timeout waiting for: {text}")
    return False


# ------------------------
# MAIN
# ------------------------

def main():
    if len(sys.argv) < 2:
        print("Usage: android.py <command>")
        return

    cmd = sys.argv[1]

    if cmd == "screenshot":
        screenshot()

    elif cmd == "screenshot_grid":
        step = sys.argv[2] if len(sys.argv) > 2 else 100
        screenshot_grid(step)

    elif cmd == "ui_tree":
        ui_tree()

    elif cmd == "tap":
        tap(sys.argv[2], sys.argv[3])

    elif cmd == "tap_text":
        tap_text(sys.argv[2])

    elif cmd == "type_text":
        type_text(sys.argv[2])

    elif cmd == "swipe":
        swipe(sys.argv[2])

    elif cmd == "key":
        key(sys.argv[2])

    elif cmd == "wait_for_text":
        wait_for_text(sys.argv[2])

    else:
        print("Unknown command")


if __name__ == "__main__":
    main()
