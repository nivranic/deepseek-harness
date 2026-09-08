"""Independently admit actual Mac UI export bytes with a strict field list and the pinned scanner."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile

from .secret_scan import scan, self_test


EVENTS = {"stopped", "starting", "ready", "stopping", "unavailable", "invalidConfiguration", "startFailed",
          "startupTimeout", "invalidAnnouncement", "healthFailed", "unexpectedExit", "shutdownFailed"}
UNCOLLECTED = ["connection", "protocol", "role", "capabilities", "updates", "native-crashes", "session-diagnostics"]


def unique_object(pairs):
    """Refuse duplicate JSON keys instead of silently accepting the last value."""
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate support field")
        value[key] = item
    return value


def validate_export(data: bytes, state: str, product: dict, scanner: dict) -> None:
    """Validate the entire saved document; missing producers remain explicitly uncollected."""
    if not data or len(data) > 16384:
        raise ValueError("support export byte limit")
    value = json.loads(data.decode("utf-8"), object_pairs_hook=unique_object)
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "platform", "runtimeClass", "complete", "product", "runtime", "scanner", "uncollected"}:
        raise ValueError("unexpected support fields")
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or value["platform"] != "macos" \
            or value["runtimeClass"] != "full" or value["complete"] is not False:
        raise ValueError("unsupported support export")
    if value["product"] != {key: product[key] for key in ("version", "buildNumber", "channel")} \
            or type(value["product"].get("buildNumber")) is not int or value["scanner"] != scanner \
            or type(value["scanner"].get("schemaVersion")) is not int or value["uncollected"] != UNCOLLECTED:
        raise ValueError("support producer identity or completeness differs")
    runtime = value["runtime"]
    keys = {"state", "lifecycleCounts", "failure"} if state == "failed" else {"state", "lifecycleCounts"}
    if not isinstance(runtime, dict) or set(runtime) != keys or runtime["state"] != state \
            or (state == "failed" and runtime["failure"] != "invalidConfiguration"):
        raise ValueError("support runtime state differs from the exercised application")
    counts = runtime["lifecycleCounts"]
    if not isinstance(counts, list) or not counts or len(counts) > len(EVENTS):
        raise ValueError("invalid lifecycle counts")
    seen = set()
    for row in counts:
        if not isinstance(row, dict) or set(row) != {"event", "count", "saturated"} or not isinstance(row["event"], str) \
                or row["event"] not in EVENTS or row["event"] in seen or type(row["count"]) is not int \
                or not 1 <= row["count"] <= 4294967295 or type(row["saturated"]) is not bool \
                or row["saturated"] != (row["count"] == 4294967295):
            raise ValueError("invalid lifecycle count")
        seen.add(row["event"])
    if "stopped" not in seen or (runtime.get("failure") or state) not in seen:
        raise ValueError("support counts omit an observed lifecycle state")


def verify_exports(attachments: Path, scanner_directory: Path, product: dict, approved: Path) -> list[dict]:
    """Publish only validated and zero-finding saved bytes after all three native scenarios pass."""
    if approved.exists() or approved.is_symlink():
        raise ValueError("approved support output must be new")
    scanner = json.loads((scanner_directory / "scanner.json").read_text(encoding="utf-8"))
    executable = scanner_directory / "gitleaks"
    if executable.is_symlink() or not executable.is_file() or hashlib.sha256(executable.read_bytes()).hexdigest() != scanner["binarySha256"]:
        raise ValueError("support scanner executable differs")
    manifest = json.loads((attachments / "manifest.json").read_text(encoding="utf-8"))
    selected = {}
    for test in manifest:
        for attachment in test["attachments"]:
            title = attachment["suggestedHumanReadableName"]
            match = re.match(r"host-runtime-support-(ready|stopped|failed)(?:_|\.json$)", title)
            if match is None:
                continue
            state = match[1]
            expected_test = "testInvalidHomeConfigurationDoesNotLaunchTheRuntime" if state == "failed" else "testBundledWebCarrierSurvivesStopStartAndRestart"
            if test["testIdentifier"] != f"DirectHostStartupTests/{expected_test}()":
                raise ValueError("support export came from another native scenario")
            filename = attachment["exportedFileName"]
            if state in selected or not isinstance(filename, str) or not re.fullmatch(r"[A-Za-z0-9-]+\.json", filename) or attachment["isAssociatedWithFailure"]:
                raise ValueError("ambiguous support export attachment")
            path = attachments / filename
            if path.is_symlink() or not path.is_file() or path.stat().st_size > 16384:
                raise ValueError("invalid support export file")
            data = path.read_bytes()
            validate_export(data, state, product, scanner)
            selected[state] = data
    if set(selected) != {"ready", "stopped", "failed"}:
        raise ValueError("native support export scenarios are incomplete")
    records = []
    with tempfile.TemporaryDirectory(prefix="dsh-support-verify-") as directory:
        scratch = Path(directory)
        self_test(executable, scratch)
        for state, data in sorted(selected.items()):
            sample = scratch / state
            sample.mkdir()
            (sample / "export.json").write_bytes(data)
            if scan(executable, ["dir", str(sample)], scratch, state):
                raise ValueError("saved support bytes contain a secret finding")
            records.append({"state": state, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "findings": 0})
    approved.mkdir()
    for state, data in selected.items():
        with (approved / (state + ".json")).open("xb") as output:
            output.write(data)
    return records


def main() -> int:
    """Write source-free acceptance facts; failed validation never publishes approved export files."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--attachments", type=Path, required=True)
    parser.add_argument("--scanner-directory", type=Path, required=True)
    parser.add_argument("--approved", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text('{"schemaVersion":1,"status":"COLLECTING"}\n', encoding="utf-8")
    try:
        product = json.loads(Path("release/product.generated.json").read_text(encoding="utf-8"))
        records = verify_exports(args.attachments, args.scanner_directory, product, args.approved)
        args.output.write_text(json.dumps({"schemaVersion": 1, "status": "PASS", "completeSupportBundle": False,
                                           "exports": records}, indent=2) + "\n", encoding="utf-8")
        return 0
    except Exception:
        # File, JSON and scanner exceptions may contain exported text or temporary paths.
        args.output.write_text('{"schemaVersion":1,"status":"FAIL","reason":"Saved runtime support exports were not accepted"}\n', encoding="utf-8")
        return 1
