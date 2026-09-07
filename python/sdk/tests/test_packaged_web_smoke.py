from __future__ import annotations

import json
import os
import runpy
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest


SMOKE = runpy.run_path(Path(__file__).resolve().parents[3] / "scripts/smoke-packaged-web.py")


def test_readiness_ignores_other_output() -> None:
    assert SMOKE["parse_ready"]("ordinary runtime output\n") is None
    value = "http://127.0.0.1:43210/?token=fixture-token"
    assert SMOKE["parse_ready"]("dsh web: " + value + "\n") == value


@pytest.mark.parametrize("suffix", [
    "user@127.0.0.1:43210/?token=fixture-token",
    "example.com:43210/?token=fixture-token",
    "127.0.0.1:0/?token=fixture-token",
    "127.0.0.1:65536/?token=fixture-token",
    "127.0.0.1:43210/api?token=fixture-token",
    "127.0.0.1:43210/?token=fixture-token#fragment",
    "127.0.0.1:43210/?token=fixture-token&token=second",
    "127.0.0.1:43210/?other=fixture-token",
    "127.0.0.1:43210/?token=fixture-token (LAN: http://example.com)",
])
def test_readiness_refuses_nonlocal_or_ambiguous_urls_without_echo(suffix: str) -> None:
    with pytest.raises(SMOKE["WebSmokeFailure"]) as error:
        SMOKE["parse_ready"]("dsh web: http://" + suffix)
    assert "fixture-token" not in str(error.value)


@pytest.mark.parametrize("fault", [None, "index-auth", "login", "index", "asset", "external",
                                     "rpc-auth", "rpc-refusal", "rpc-id"])
def test_http_checks_use_served_bytes_and_authenticated_rpc(fault: str | None) -> None:
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args: object) -> None:
            pass

        def do_GET(self) -> None:
            status, headers, data = 200, {}, b""
            if self.path.startswith("/?token="):
                status = 200 if fault == "login" else 303
                headers = {"location": "/", "set-cookie": "fixture=authenticated; HttpOnly"}
            elif self.path == "/" and not self.headers.get("Cookie"):
                status = 200 if fault == "index-auth" else 401
            elif self.path == "/":
                script = "https://example.com/main.js" if fault == "external" else "./assets/main.js"
                data = (f'<script>window.__DSH_BOOT__={{}}</script><script src="{script}"></script>').encode()
                if fault == "index":
                    data = b"<html>missing boot manifest</html>"
                headers["content-type"] = "text/html"
            else:
                headers["content-type"] = "text/html" if fault == "asset" else "application/javascript"
                data = b"<html>fallback</html>" if fault == "asset" else b"export default 1"
            self.send_response(status)
            for name, value in headers.items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self) -> None:
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert self.path == "/api/session/list"
            assert body["method"] == "session/list"
            assert body["payload"] == {"args": {"_request": {}}}
            status = 200 if self.headers.get("Cookie") or fault == "rpc-auth" else 401
            response = {"type": "server-response", "rpcId": body["rpcId"],
                        "result": {"ok": True, "value": {"items": []}}}
            if fault == "rpc-refusal":
                response["result"] = {"ok": False, "error": "fixture-token"}
            if fault == "rpc-id":
                response["rpcId"] = "other"
            self.send_response(status)
            self.end_headers()
            self.wfile.write(json.dumps(response).encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever)
    thread.start()
    try:
        value = f"http://127.0.0.1:{server.server_port}/?token=fixture-token"
        if fault is None:
            assert SMOKE["verify_http"](value) == {
                "authentication": "PASS", "frontend": "PASS", "scriptCount": 1, "sessionRpc": "PASS",
            }
        else:
            with pytest.raises(SMOKE["WebSmokeFailure"]) as error:
                SMOKE["verify_http"](value)
            assert "fixture-token" not in str(error.value)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.skipif(os.name != "posix", reason="POSIX process-group and signal acceptance")
@pytest.mark.parametrize("mode", ["graceful", "stuck", "descendant"])
def test_shutdown_requires_graceful_exit_and_an_empty_process_group(mode: str) -> None:
    program = "import signal,time,subprocess,sys\n"
    if mode == "descendant":
        program += "subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(30)'])\n"
    program += ("signal.signal(signal.SIGTERM, signal.SIG_IGN)\n" if mode == "stuck"
                else "signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))\n")
    program += "print('ready', flush=True)\ntime.sleep(30)\n"
    child = subprocess.Popen([sys.executable, "-c", program], stdout=subprocess.PIPE,
                             text=True, start_new_session=True)
    try:
        assert child.stdout.readline().strip() == "ready"
        if mode == "graceful":
            SMOKE["stop_process"](child, timeout=1)
        else:
            with pytest.raises(SMOKE["WebSmokeFailure"], match="timed out|descendant"):
                SMOKE["stop_process"](child, timeout=0.2)
        assert child.poll() is not None
    finally:
        if child.poll() is None:
            child.kill()
            child.wait(timeout=5)
        child.stdout.close()
