#!/usr/bin/env python3
"""Verify a POSIX packaged web profile without exposing its launch token or opening a browser."""

from __future__ import annotations

import argparse
import hashlib
import http.client
import json
import os
import queue
import signal
import subprocess
import tempfile
import threading
from html.parser import HTMLParser
from pathlib import Path
from typing import TextIO
from urllib.parse import parse_qs, urljoin, urlsplit


class WebSmokeFailure(RuntimeError):
    """A failure message containing no runtime output, URL, cookie, or response body."""


def require(condition: bool, message: str) -> None:
    if not condition:
        raise WebSmokeFailure(message)


def parse_ready(line: str) -> str | None:
    """Accept only the launcher's authenticated IPv4 loopback root announcement."""
    prefix = "dsh web: http://"
    if not line.startswith(prefix):
        return None
    value = line[len("dsh web: "):].strip()
    try:
        address = urlsplit(value)
        query = parse_qs(address.query, strict_parsing=True)
        valid = (
            address.scheme == "http" and address.hostname == "127.0.0.1"
            and address.port is not None and 0 < address.port < 65536
            and address.username is None and address.password is None
            and address.path == "/" and not address.fragment
            and set(query) == {"token"} and len(query["token"]) == 1
            and not any(character.isspace() for character in value)
        )
    except ValueError:
        valid = False
    require(valid, "invalid packaged web readiness announcement")
    return value


class Scripts(HTMLParser):
    """Read script references and the JSON boot declaration without executing JavaScript."""

    def __init__(self) -> None:
        super().__init__()
        self.sources: list[str] = []
        self.blocking_sources: list[str] = []
        self.inline: list[str] = []
        self.current: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "script":
            attributes = dict(attrs)
            source = attributes.get("src")
            self.current = [] if source is None else None
            if source:
                self.sources.append(source)
                if not any(key in attributes for key in ("async", "defer", "type")):
                    self.blocking_sources.append(source)

    def handle_data(self, data: str) -> None:
        if self.current is not None:
            self.current.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "script" and self.current is not None:
            self.inline.append("".join(self.current))
            self.current = None


def boot_assets(scripts: Scripts) -> tuple[int, list[str]]:
    """Require the packaged web composition's module bootstrap and application bundle declarations."""
    prefix = 'globalThis["__DSH_BOOT__"] = '
    declarations = [text[len(prefix):] for text in scripts.inline if text.startswith(prefix)]
    require(len(declarations) == 1, "packaged frontend must declare one JSON boot graph")
    try:
        graph = json.loads(declarations[0])
    except ValueError:
        raise WebSmokeFailure("packaged frontend boot graph is not JSON") from None
    require(isinstance(graph, dict), "packaged frontend boot graph is not an object")
    entries, batches = graph.get("entries"), graph.get("batches")
    require(isinstance(entries, list) and bool(entries)
            and all(isinstance(entry, dict) for entry in entries),
            "packaged frontend boot graph has no valid plugin entries")
    require(any(entry.get("id") == "@deepseek-ai/dsh-client-modules" for entry in entries),
            "packaged frontend boot graph has no client module loader")
    require(isinstance(batches, list) and bool(batches)
            and all(isinstance(batch, dict) and isinstance(batch.get("url"), str)
                    and bool(batch["url"]) for batch in batches),
            "packaged frontend boot graph has no valid bundle batches")
    bootstrap = [batch for batch in batches if batch.get("phase") == "bootstrap"]
    require(any(isinstance(batch.get("entries"), list)
                and "@deepseek-ai/dsh-client-modules" in batch["entries"] for batch in bootstrap)
            and all(batch["url"] in scripts.blocking_sources for batch in bootstrap),
            "packaged frontend module bootstrap is not parser loaded")
    require(any(batch.get("phase") == "application" for batch in batches),
            "packaged frontend boot graph has no application bundle")
    return len(entries), [batch["url"] for batch in batches]


def request(port: int, target: str, headers: dict[str, str] | None = None,
            body: str | None = None) -> tuple[int, dict[str, str], bytes]:
    """Use direct loopback HTTP with no proxy or automatic redirect handling."""
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request("POST" if body is not None else "GET", target,
                           headers=headers or {}, body=body)
        response = connection.getresponse()
        data = response.read(16 * 1024 * 1024 + 1)
        require(len(data) <= 16 * 1024 * 1024, "web response exceeded the smoke limit")
        return response.status, {key.lower(): value for key, value in response.getheaders()}, data
    finally:
        connection.close()


def verify_http(ready_url: str) -> dict[str, object]:
    """Check authentication, frontend bytes and the real SessionController on one carrier."""
    address = urlsplit(ready_url)
    port = address.port
    assert port is not None
    origin = f"http://127.0.0.1:{port}"
    status, _, _ = request(port, "/")
    require(status == 401, "unauthenticated index was not refused")
    status, headers, _ = request(port, "/?" + address.query)
    require(status == 303 and headers.get("location") == "/"
            and "set-cookie" in headers, "launch token exchange failed")
    cookie = headers["set-cookie"].split(";", 1)[0]
    status, headers, index = request(port, "/", {"Cookie": cookie})
    require(status == 200 and "text/html" in headers.get("content-type", "")
            and b"__DSH_BOOT__" in index, "packaged frontend index or boot manifest is missing")
    scripts = Scripts()
    scripts.feed(index.decode("utf-8"))
    require(bool(scripts.sources), "packaged frontend has no script references")
    entry_count, batches = boot_assets(scripts)
    for source in dict.fromkeys([*scripts.sources, *batches]):
        asset = urlsplit(urljoin(origin + "/", source))
        require(asset.scheme == "http" and asset.netloc == address.netloc,
                "frontend script leaves the local carrier")
        target = asset.path + ("?" + asset.query if asset.query else "")
        status, headers, data = request(port, target, {"Cookie": cookie})
        require(status == 200 and bool(data)
                and any(kind in headers.get("content-type", "")
                        for kind in ("javascript", "ecmascript")), "packaged script bytes are missing")
    payload = json.dumps({"type": "client-request", "rpcId": "packaged-web-smoke",
                          "method": "session/list", "payload": {"args": {"_request": {}}}})
    rpc_headers = {"Content-Type": "application/json", "Origin": origin}
    status, _, _ = request(port, "/api/session/list", rpc_headers, payload)
    require(status == 401, "unauthenticated Session RPC was not refused")
    status, _, data = request(port, "/api/session/list", {**rpc_headers, "Cookie": cookie}, payload)
    require(status == 200, "authenticated Session RPC failed")
    result = json.loads(data)
    require(result == {"type": "server-response", "rpcId": "packaged-web-smoke",
                       "result": {"ok": True, "value": {"items": []}}},
            "Session RPC did not return the fresh home's empty session list")
    return {"authentication": "PASS", "frontend": "PASS", "scriptCount": len(scripts.sources),
            "pluginCount": entry_count, "batchCount": len(batches), "sessionRpc": "PASS"}


def stop_process(child: subprocess.Popen[str], timeout: float = 10) -> None:
    """Require graceful exit and no live member of this smoke's dedicated process group."""
    if child.poll() is None:
        child.terminate()
    try:
        code = child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait(timeout=timeout)
        raise WebSmokeFailure("packaged web shutdown timed out") from None
    try:
        os.killpg(child.pid, 0)
    except ProcessLookupError:
        pass
    else:
        os.killpg(child.pid, signal.SIGKILL)
        raise WebSmokeFailure("packaged web left a process-group descendant")
    require(code == 0, "packaged web exited unsuccessfully")


def smoke(executable: Path) -> dict[str, object]:
    """Launch only dsh's shipped web profile in a fresh home, then stop and reap it."""
    require(os.name == "posix", "packaged web signal smoke requires POSIX")
    executable = executable.resolve(strict=True)
    with executable.open("rb") as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    ready: queue.Queue[str | WebSmokeFailure | None] = queue.Queue(maxsize=1)

    def offer(value: str | WebSmokeFailure | None) -> None:
        try:
            ready.put_nowait(value)
        except queue.Full:
            pass

    def drain(stream: TextIO, announcements: bool) -> None:
        # Both pipes drain throughout startup and shutdown; their contents never enter diagnostics.
        try:
            while line := stream.readline(65537):
                require(len(line) <= 65536, "runtime output line exceeded the smoke limit")
                if announcements:
                    value = parse_ready(line)
                    if value is not None:
                        offer(value)
        except (ValueError, OSError, WebSmokeFailure):
            offer(WebSmokeFailure("runtime output could not be consumed"))
        finally:
            if announcements:
                offer(None)

    with tempfile.TemporaryDirectory(prefix="dsh-packaged-web-") as temporary:
        root = Path(temporary)
        environment = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR", "LANG")
                       if key in os.environ}
        environment.update(DSH_HOME=str(root / "home"), DSH_TELEMETRY_DISABLED="1")
        child = subprocess.Popen(
            [str(executable), "--profile", "web", "--no-open", "--host", "127.0.0.1", "--port", "0"],
            cwd=root, env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", errors="replace", start_new_session=True,
        )
        assert child.stdout is not None and child.stderr is not None
        readers = [threading.Thread(target=drain, args=(child.stdout, True), daemon=True),
                   threading.Thread(target=drain, args=(child.stderr, False), daemon=True)]
        for reader in readers:
            reader.start()
        try:
            try:
                url = ready.get(timeout=60)
            except queue.Empty:
                raise WebSmokeFailure("packaged web readiness timed out") from None
            if isinstance(url, WebSmokeFailure):
                raise url
            require(url is not None, "runtime exited before announcing web readiness")
            assert url is not None
            result = verify_http(url)
        finally:
            try:
                stop_process(child)
            finally:
                for reader in readers:
                    reader.join(timeout=5)
                child.stdout.close()
                child.stderr.close()
        return {"executableSha256": digest.hexdigest(), **result, "shutdown": "PASS",
                "processGroupEmpty": True, "browserInteraction": "NOT_EXECUTED"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = smoke(args.exe)
    except Exception as error:
        # Third-party exceptions may retain URLs or response bytes; only our closed messages are safe.
        message = str(error) if isinstance(error, WebSmokeFailure) else type(error).__name__
        parser.exit(1, f"smoke-packaged-web: {message}\n")
    print("smoke-packaged-web: " + json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
