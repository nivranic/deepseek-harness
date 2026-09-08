"""Independently validate and rescan exact bytes saved by the Windows Settings exporter."""

import argparse
import hashlib
import json
from pathlib import Path
import tempfile

from .secret_scan import scan, self_test
from .support_exports import unique_object


UNCOLLECTED = ["runtime-health", "connection", "effective-role", "updates", "native-crashes"]
COUNTERS = {"turnsStarted", "turnsEnded", "toolCalls", "toolResults"}


def fields(value: object, expected: set[str]) -> dict:
    """Reject additional fields at every level, including nested producer observations."""
    if not isinstance(value, dict) or set(value) != expected:
        raise ValueError("unexpected Windows support fields")
    return value


def validate_export(data: bytes, product: dict, scanner: dict) -> None:
    """Accept the fresh no-session candidate projection without treating missing producers as complete."""
    if not data or len(data) > 1024 * 1024:
        raise ValueError("Windows support byte limit")
    value = fields(json.loads(data.decode("utf-8"), object_pairs_hook=unique_object), {
        "schemaVersion", "platform", "runtimeClass", "complete", "product", "diagnostics", "link", "scanner", "uncollected"})
    if type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or value["platform"] != "windows" \
            or value["runtimeClass"] != "full" or value["complete"] is not False or value["uncollected"] != UNCOLLECTED:
        raise ValueError("unsupported Windows support export")
    expected_product = {key: product[key] for key in ("version", "buildNumber", "channel")}
    identity = fields(value["product"], {"producer", "freshness", "value"})
    if identity != {"producer": "application-package", "freshness": "current", "value": expected_product} \
            or type(identity["value"].get("buildNumber")) is not int:
        raise ValueError("Windows support product identity differs")
    if value["scanner"] != scanner or type(value["scanner"].get("schemaVersion")) is not int:
        raise ValueError("Windows support scanner identity differs")
    diagnostics = fields(value["diagnostics"], {"producer", "freshness", "scope", "counts", "saturated"})
    counts = fields(diagnostics["counts"], COUNTERS)
    if diagnostics["producer"] != "desktop-support" or diagnostics["freshness"] != "current" \
            or diagnostics["scope"] != "since-plugin-start" or diagnostics["saturated"] is not False \
            or any(type(count) is not int or count != 0 for count in counts.values()):
        raise ValueError("Windows support counters differ from the fresh application")
    link = fields(value["link"], {"producer", "freshness", "value"})
    if link["producer"] != "link-access" or link["freshness"] != "current":
        raise ValueError("Windows candidate omitted its Link observation")
    protocol = fields(link["value"], {"listenerState", "linkProtocolVersion", "contractVersion", "sessionFormatVersion",
                                      "runtimeClass", "allowRemoteApproval", "capabilities"})
    if protocol["listenerState"] != "stopped" or protocol["runtimeClass"] != "full" or protocol["allowRemoteApproval"] is not False:
        raise ValueError("Windows support Link state differs from the fresh application")
    for key in ("linkProtocolVersion", "contractVersion", "sessionFormatVersion"):
        if type(protocol[key]) is not int or protocol[key] < 0:
            raise ValueError("invalid Windows support protocol version")
    capabilities = fields(protocol["capabilities"], {"session", "workspace", "interaction"})
    for key, names in (("session", {"list", "history", "follow", "prompt", "cancel"}),
                       ("workspace", {"follow"}), ("interaction", {"approval", "question"})):
        if any(type(flag) is not bool for flag in fields(capabilities[key], names).values()):
            raise ValueError("invalid Windows support capability")


def verify_export(source: Path, scanner_directory: Path, product: dict, scanner: dict, approved: Path) -> dict:
    """Publish a new approved copy only after strict validation, scanner self-test and zero findings."""
    if approved.exists() or approved.is_symlink() or source.is_symlink() or not source.is_file() \
            or not 0 < source.stat().st_size <= 1024 * 1024:
        raise ValueError("invalid Windows support input or output")
    data = source.read_bytes()
    validate_export(data, product, scanner)
    executable = scanner_directory / "gitleaks.exe"
    for name, digest_key in (("gitleaks.exe", "binarySha256"), ("LICENSE", "licenseSha256")):
        path = scanner_directory / name
        if path.is_symlink() or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != scanner[digest_key]:
            raise ValueError("Windows support scanner resource differs")
    with tempfile.TemporaryDirectory(prefix="dsh-windows-support-verify-") as directory:
        scratch = Path(directory)
        self_test(executable, scratch)
        sample = scratch / "saved"
        sample.mkdir()
        (sample / "export.json").write_bytes(data)
        if scan(executable, ["dir", str(sample)], scratch, "saved"):
            raise ValueError("saved Windows support bytes contain a secret finding")
    with approved.open("xb") as output:
        output.write(data)
    return {"schemaVersion": 1, "status": "PASS", "completeSupportBundle": False,
            "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "findings": 0}


def main() -> int:
    """Write payload-free acceptance facts; refused documents are never copied to candidate evidence."""
    parser = argparse.ArgumentParser()
    for name in ("input", "scanner-directory", "identity", "approved", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    try:
        identity = json.loads(args.identity.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
        receipt = verify_export(args.input, args.scanner_directory, identity["product"], identity["scanner"], args.approved)
        args.output.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
        return 0
    except Exception:
        # File, JSON and scanner failures may contain export text or native paths.
        args.output.write_text('{"schemaVersion":1,"status":"FAIL","reason":"Windows support export was not accepted"}\n', encoding="utf-8")
        return 1
