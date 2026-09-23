"""Optional UI smoke check against an already running Chrome debug port (websocket-client)."""
import base64
import json
import time
from pathlib import Path
from urllib.request import urlopen

import websocket

pages = json.load(urlopen("http://127.0.0.1:9222/json"))
page = next(p for p in pages if p["type"] == "page" and "127.0.0.1:8000" in p["url"])
ws = websocket.create_connection(page["webSocketDebuggerUrl"], origin="http://127.0.0.1:9222", timeout=10)
sequence = 0
errors = []


def call(method, params=None):
    global sequence
    sequence += 1
    request_id = sequence
    ws.send(json.dumps({"id": request_id, "method": method, "params": params or {}}))
    while True:
        message = json.loads(ws.recv())
        if message.get("method") == "Runtime.exceptionThrown":
            errors.append(message["params"])
        if message.get("id") == request_id:
            if "error" in message:
                raise RuntimeError(message["error"])
            return message.get("result", {})


def evaluate(expression):
    value = call("Runtime.evaluate", {"expression": expression, "returnByValue": True, "awaitPromise": True})
    if "exceptionDetails" in value:
        raise RuntimeError(value["exceptionDetails"])
    return value.get("result", {}).get("value")


def wait(expression, seconds=12):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if evaluate(expression):
            return
        time.sleep(.15)
    raise AssertionError(f"Timed out: {expression}; browser errors: {errors}")


def click(selector):
    rect = evaluate(f"(()=>{{const e=document.querySelector({json.dumps(selector)});e.scrollIntoView({{block:'nearest'}});const r=e.getBoundingClientRect();return {{x:r.x+r.width/2,y:r.y+r.height/2}};}})()")
    for kind in ("mousePressed", "mouseReleased"):
        call("Input.dispatchMouseEvent", {"type": kind, **rect, "button": "left", "clickCount": 1})


def screenshot(name):
    png = call("Page.captureScreenshot", {"format": "png"})["data"]
    directory = Path(__file__).resolve().parent.parent / ".browser-check"
    directory.mkdir(exist_ok=True)
    (directory / name).write_bytes(base64.b64decode(png))


call("Runtime.enable")
call("Page.enable")
call("Emulation.setDeviceMetricsOverride", {"width": 1600, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
call("Page.navigate", {"url": "http://127.0.0.1:8000"})
wait("document.body.dataset.ready === 'true'")
evaluate("localStorage.removeItem('akim-map-plan-v1')")
click("#reset")
assert evaluate("document.querySelectorAll('.district-region').length") == 5
assert evaluate("document.querySelectorAll('.issue-pin').length") == 10
assert evaluate("document.querySelector('#simulate').disabled")
screenshot("map-initial.png")
print("PASS initial map: five regions, ten issues, five empty slots", flush=True)

click('[data-issue="Нура-S2"]')
wait("document.querySelector('.appeal-detail') !== null")
click("[data-resolve]")
assert evaluate("document.querySelectorAll('.initiative').length") == 3
click("#drawer-close")
previous = evaluate("document.querySelector('#city-map').getAttribute('viewBox')")
click("#zoom-in")
assert previous != evaluate("document.querySelector('#city-map').getAttribute('viewBox')")
click("#zoom-reset")
print("PASS issue -> appeal -> filtered initiatives; zoom", flush=True)

click("#example")
wait("!document.querySelector('#simulate').disabled")
assert evaluate("document.querySelectorAll('.project-pin').length") == 9
click("#simulate")
wait("document.querySelector('#phase-label').textContent === 'РЕЗУЛЬТАТ'")
assert evaluate("document.querySelector('#score').textContent") == '56,54'
assert evaluate("document.querySelectorAll('.project-pin.active').length") == 9
assert evaluate("document.querySelectorAll('.issue-pin.improved').length") >= 3
screenshot("map-result.png")
print("PASS simulation: Score 56.54, projects activated, appeals improved", flush=True)

click("#alternative")
wait("document.querySelector('[data-branch=alternative]') !== null")
alt = evaluate("document.querySelector('#score').textContent")
click('[data-branch="mine"]')
assert evaluate("document.querySelector('#score').textContent") == '56,54'
click('[data-branch="alternative"]')
assert evaluate("document.querySelector('#score').textContent") == alt
print("PASS alternative timeline switches map and scores", flush=True)

click("#drawer-close")
call("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
wait("window.innerWidth === 390")
assert evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), 'Horizontal overflow on mobile'
screenshot("map-mobile.png")
print("PASS mobile viewport: no horizontal overflow", flush=True)
assert not errors, errors
call("Emulation.setDeviceMetricsOverride", {"width": 1600, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
click("#reset")
click("#example")
wait("!document.querySelector('#simulate').disabled")
click('[data-remove="M5"]')
click('[data-view="initiatives"]')
click('[data-filter="Экология"]')
click('[data-add="M4"]')
assert evaluate("document.querySelector('#simulate').disabled"), 'Local conflict must disable simulation'
assert 'несовместимы' in evaluate("document.querySelector('#plan-status').textContent")
evaluate("(()=>{const s=document.querySelector('[data-measure-district=M4]');s.value='Есиль';s.dispatchEvent(new Event('change',{bubbles:true}));})()")
wait("!document.querySelector('#simulate').disabled")
print("PASS manual project selection: district conflict blocked, reassignment allowed", flush=True)
click("#drawer-close")
evaluate("document.querySelector('[data-district=Алматы]').focus()")
call("Input.dispatchKeyEvent", {"type":"keyDown", "key":"Enter", "code":"Enter", "windowsVirtualKeyCode":13})
call("Input.dispatchKeyEvent", {"type":"keyUp", "key":"Enter", "code":"Enter", "windowsVirtualKeyCode":13})
assert evaluate("document.querySelector('.district-heading h2').textContent") == 'Алматы'
print("PASS keyboard district selection", flush=True)
click("#reset")
screenshot("map-final.png")
assert not errors, errors
ws.close()
print("PASS no JavaScript exceptions", flush=True)
