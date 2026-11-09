#!/usr/bin/env python3
"""Local dev server for personal-dashboard (stdlib only).

  python scripts/serve.py [port]     serve the repo at http://127.0.0.1:8765 with caching off
  python scripts/serve.py --mock     also serve the sibling personal-* clones read-only under /__mock/,
                                     so /mock.html runs the dashboard on local data (no token, no writes)

Plain `python -m http.server` also works, except that on Windows the registry can map .js to
text/plain, which browsers refuse for ES modules. This sets the types explicitly.
"""
import functools, http.server, json, sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
MOCK = "--mock" in sys.argv


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if MOCK and path.startswith("/__mock/"):
            return self.mock(path[len("/__mock/"):])
        return super().do_GET()

    def mock(self, rel):
        repo, _, sub = rel.partition("/")
        # Nearest ancestor folder holding the clone (works from a git worktree too).
        base = next(((a / repo).resolve() for a in ROOT.parents if (a / repo).is_dir()), ROOT.parent / repo)
        target = (base / sub).resolve()
        if not repo.startswith("personal-") or base not in (target, *target.parents) or ".git" in target.parts or not target.exists():
            return self.send_error(404)
        if target.is_dir():
            body = json.dumps([{"name": p.name, "path": p.relative_to(base).as_posix(), "type": "dir" if p.is_dir() else "file", "sha": "disk"}
                               for p in sorted(target.iterdir())]).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("X-Mock-Dir", "1")
        else:
            body = target.read_bytes()
            self.send_response(200); self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json",
        ".css": "text/css", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8765
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT)))
    print(f"personal-dashboard on http://127.0.0.1:{port}/" + ("  mock: /mock.html" if MOCK else "") + "  (Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
