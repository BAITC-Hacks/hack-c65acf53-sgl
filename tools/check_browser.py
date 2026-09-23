"""Run behavioral browser smoke checks with Node 22+ (no npm packages).

Start the app and an isolated Chrome debug session first; see README.md.
Optional arguments: base URL (default http://127.0.0.1:8001), debug port (9222).
"""
import subprocess
import sys
from pathlib import Path

if __name__ == "__main__":
    raise SystemExit(subprocess.call(["node", str(Path(__file__).with_suffix(".mjs")), *sys.argv[1:]]))
