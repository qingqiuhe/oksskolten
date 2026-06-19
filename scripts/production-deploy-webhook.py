#!/usr/bin/env python3
"""Narrow local HTTP adapter for the production deploy agent."""

from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from socketserver import ThreadingMixIn
import subprocess
import sys


HOST = os.environ.get("OKSSKOLTEN_DEPLOY_WEBHOOK_HOST", "127.0.0.1")
PORT = int(os.environ.get("OKSSKOLTEN_DEPLOY_WEBHOOK_PORT", "8787"))
WEBHOOK_PATH = os.environ.get("OKSSKOLTEN_DEPLOY_WEBHOOK_PATH", "/deploy")
MAX_BODY_BYTES = int(os.environ.get("OKSSKOLTEN_DEPLOY_MAX_BODY_BYTES", "16384"))
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
AGENT_PATH = os.environ.get(
    "OKSSKOLTEN_DEPLOY_AGENT",
    os.path.join(SCRIPT_DIR, "production-deploy-agent.sh"),
)


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class DeployHandler(BaseHTTPRequestHandler):
    server_version = "oksskolten-deploy-webhook/1"

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True})
            return
        self.send_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self) -> None:
        if self.path != WEBHOOK_PATH:
            self.send_json(404, {"ok": False, "error": "not_found"})
            return

        content_length = self.headers.get("Content-Length")
        if content_length is None:
            self.send_json(411, {"ok": False, "error": "content_length_required"})
            return

        try:
            body_size = int(content_length)
        except ValueError:
            self.send_json(400, {"ok": False, "error": "invalid_content_length"})
            return

        if body_size < 1 or body_size > MAX_BODY_BYTES:
            self.send_json(413, {"ok": False, "error": "body_too_large"})
            return

        body = self.rfile.read(body_size)
        env = os.environ.copy()
        env.update(
            {
                "HTTP_X_OKSSKOLTEN_DEPLOY_TIMESTAMP": self.headers.get(
                    "X-Oksskolten-Deploy-Timestamp", ""
                ),
                "HTTP_X_OKSSKOLTEN_DEPLOY_NONCE": self.headers.get(
                    "X-Oksskolten-Deploy-Nonce", ""
                ),
                "HTTP_X_OKSSKOLTEN_DEPLOY_SIGNATURE": self.headers.get(
                    "X-Oksskolten-Deploy-Signature", ""
                ),
            }
        )

        result = subprocess.run(
            [AGENT_PATH],
            input=body,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=False,
        )
        if result.returncode != 0:
            sys.stderr.write(result.stderr.decode("utf-8", errors="replace"))
            self.send_json(500, {"ok": False, "error": "deploy_failed"})
            return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(result.stdout or b'{"ok":true}\n')


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), DeployHandler)
    print(f"oksskolten deploy webhook listening on {HOST}:{PORT}{WEBHOOK_PATH}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
