"""Tiny development HTTP server that disables browser caching.

Python's stdlib `http.server` doesn't set Cache-Control headers, so browsers
aggressively cache ES module files. During dev, we want fresh code on every
reload. This server adds `Cache-Control: no-store` to every response.

Usage:
    python3 scripts/dev_server.py [port]   # default port: 8765
"""

from __future__ import annotations

import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = HTTPServer(("", port), NoCacheHandler)
    print(f"Serving on http://localhost:{port} with cache disabled")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nshutting down")
        server.server_close()


if __name__ == "__main__":
    main()
