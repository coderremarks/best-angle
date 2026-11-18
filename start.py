"""Serve Best Angle on this computer and open it in your browser.

Usage:
    python start.py              # http://127.0.0.1:8765
    python start.py --port 9000
    python start.py --no-browser

Standard library only. The server listens on 127.0.0.1 (this computer only,
not your Wi-Fi network) and serves nothing but this folder. Your photos are
never sent to it: they are opened and analysed inside the browser tab.
"""

from __future__ import annotations

import argparse
import http.server
import socket
import sys
import webbrowser
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"


class Handler(http.server.SimpleHTTPRequestHandler):
    # Explicit types: on Windows, Python reads MIME types from the registry, which
    # sometimes maps .js to text/plain, and browsers then refuse to run the modules.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".json": "application/json",
        ".md": "text/plain; charset=utf-8",
    }

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - signature from the base class
        pass  # keep the console quiet; errors still surface in the browser


def find_port(preferred: int) -> int:
    """Use the preferred port if it's free, otherwise let the OS pick one."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((HOST, preferred))
            return preferred
        except OSError:
            s.bind((HOST, 0))
            return s.getsockname()[1]


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Best Angle locally.")
    parser.add_argument("--port", type=int, default=8765, help="port to listen on (default 8765)")
    parser.add_argument("--no-browser", action="store_true", help="don't open a browser tab")
    args = parser.parse_args()

    port = find_port(args.port)
    server = http.server.ThreadingHTTPServer((HOST, port), partial(Handler, directory=str(ROOT)))
    url = f"http://{HOST}:{port}/"
    print(f"Best Angle is running at {url}")
    print("Press Ctrl+C to stop.")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
