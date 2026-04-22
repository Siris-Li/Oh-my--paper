#!/usr/bin/env python3
"""Tiny HTTP PUT receiver — browser POSTs PDF bytes, we write to disk at a path
keyed by the paper_slug in URL. Used to bypass CDP eval return-size limit when
pulling PDFs through a browser session (ACM DL, etc.)."""
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


QUEUE = json.load(open(sys.argv[1], encoding="utf-8"))
TARGETS = {e["paper_slug"]: e["target_path"] for e in QUEUE}


class H(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "PUT, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200); self._cors(); self.end_headers()

    def do_PUT(self):
        slug = self.path.lstrip("/")
        tp = TARGETS.get(slug)
        if not tp:
            self.send_response(404); self._cors(); self.end_headers()
            self.wfile.write(b"unknown slug")
            return
        n = int(self.headers.get("Content-Length", 0))
        data = self.rfile.read(n)
        if not data.startswith(b"%PDF-"):
            self.send_response(422); self._cors(); self.end_headers()
            self.wfile.write(b"not a PDF (magic mismatch)")
            return
        os.makedirs(os.path.dirname(tp), exist_ok=True)
        with open(tp, "wb") as f:
            f.write(data)
        self.send_response(200); self._cors(); self.end_headers()
        self.wfile.write(f"ok {len(data)}".encode())

    def log_message(self, fmt, *args):
        print(f"[recv] {fmt % args}", file=sys.stderr)


if __name__ == "__main__":
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 9876
    print(f"[recv] listening on :{port}, {len(TARGETS)} slugs mapped", file=sys.stderr)
    ThreadingHTTPServer(("localhost", port), H).serve_forever()
