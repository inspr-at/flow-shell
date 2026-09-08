#!/usr/bin/env python3
"""Minimal static server for flow-shell examples. No dependencies."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print(f'flow-shell dev server at http://127.0.0.1:{port}/examples/host-a/index.html')
    print(f'alt host B at http://127.0.0.1:{port}/examples/host-b/index.html')
    print(f'sidebar host at http://127.0.0.1:{port}/examples/host-sidebar/index.html')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped')
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
