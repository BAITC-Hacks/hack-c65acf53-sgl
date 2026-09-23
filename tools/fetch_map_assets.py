"""Vendor the pinned MapLibre CSP distribution; no frontend build step needed."""
from pathlib import Path
from urllib.request import Request, urlopen

VERSION = "5.6.2"
TARGET = Path(__file__).resolve().parent.parent / "static" / "vendor" / "maplibre"
FILES = {
    "maplibre-gl-csp.js": "dist/maplibre-gl-csp.js",
    "maplibre-gl-csp-worker.js": "dist/maplibre-gl-csp-worker.js",
    "maplibre-gl.css": "dist/maplibre-gl.css",
    "LICENSE.txt": "LICENSE.txt",
}


def main():
    TARGET.mkdir(parents=True, exist_ok=True)
    for name, source in FILES.items():
        url = f"https://unpkg.com/maplibre-gl@{VERSION}/{source}"
        with urlopen(Request(url, headers={"User-Agent": "Akim-MVP/1.0"}), timeout=40) as response:
            data = response.read()
        (TARGET / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
