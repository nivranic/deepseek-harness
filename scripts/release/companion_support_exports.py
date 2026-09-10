"""Admit exact Mac Companion UI export bytes against staged identity and an independent scanner."""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile

from .secret_scan import scan, self_test
from .support_exports import unique_object


TEST = "CompanionMacSupportTests/testUnpairedDiagnosticsCancelThenSave()"
TITLE = "companion-support-unpaired-macos"
UNCOLLECTED = ["application-source", "runtime-health", "connection", "effective-role",
               "updates", "native-crashes", "session-diagnostics"]


def validate_export(data: bytes, product: dict, library: dict) -> None:
    """Refuse extra fields, unknown observations and claims absent from the unpaired native scenario."""
    if not data or len(data) > 16384:
        raise ValueError("Companion support byte limit")
    value = json.loads(data.decode("utf-8"), object_pairs_hook=unique_object)
    expected = {"schemaVersion": 1, "kind": "companion-support", "complete": False,
                "application": {key: product[key] for key in ("version", "buildNumber", "channel")},
                "scanner": library, "link": {"producer": "LinkClient", "activityScope": "client-lifetime",
                "roleFreshness": "last-known", "descriptionFreshness": "last-known", "state": "unavailable"},
                "uncollected": UNCOLLECTED}
    if value != expected or type(value["schemaVersion"]) is not int or value["complete"] is not False \
            or type(value["application"]["buildNumber"]) is not int or type(value["scanner"]["schemaVersion"]) is not int:
        raise ValueError("Companion support fields or producer identity differ")


def verify_exports(attachments: Path, scanner_directory: Path, product: dict, library: dict, approved: Path) -> dict:
    """Publish the saved document only after strict JSON validation, a scanner canary and a zero-finding scan."""
    if approved.exists() or approved.is_symlink():
        raise ValueError("approved Companion support output must be new")
    scanner = json.loads((scanner_directory / "scanner.json").read_bytes())
    executable = scanner_directory / "gitleaks"
    if executable.is_symlink() or not executable.is_file() \
            or hashlib.sha256(executable.read_bytes()).hexdigest() != scanner["binarySha256"] \
            or scanner["version"] != library["scannerVersion"]:
        raise ValueError("independent Companion scanner differs")
    manifest = json.loads((attachments / "manifest.json").read_bytes())
    selected = []
    for test in manifest:
        for item in test["attachments"]:
            if re.match(r"companion-support-unpaired-macos(?:_|\.json$)", item["suggestedHumanReadableName"]) is None:
                continue
            name = item["exportedFileName"]
            if test["testIdentifier"] != TEST or item["isAssociatedWithFailure"] is not False \
                    or not isinstance(name, str) or re.fullmatch(r"[A-Za-z0-9-]+\.json", name) is None:
                raise ValueError("foreign or failed Companion attachment")
            file = attachments / name
            if file.is_symlink() or not file.is_file() or file.stat().st_size > 16384:
                raise ValueError("invalid Companion attachment")
            data = file.read_bytes()
            validate_export(data, product, library)
            selected.append(data)
    if len(selected) != 1:
        raise ValueError("expected one saved unpaired Companion document")
    data = selected[0]
    with tempfile.TemporaryDirectory(prefix="dsh-companion-verify-") as directory:
        scratch = Path(directory)
        self_test(executable, scratch)
        sample = scratch / "saved"
        sample.mkdir()
        (sample / "export.json").write_bytes(data)
        if scan(executable, ["dir", str(sample)], scratch, "companion-macos"):
            raise ValueError("saved Companion document contains a secret finding")
    approved.mkdir()
    with (approved / (TITLE + ".json")).open("xb") as output:
        output.write(data)
    return {"platform": "macos", "scenario": "unpaired", "bytes": len(data),
            "sha256": hashlib.sha256(data).hexdigest(), "findings": 0}


def main() -> int:
    """Emit a payload-free result; failures never produce approved support bytes."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("attachments", "scanner-directory", "library-identity", "approved", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    args.output.write_text('{"schemaVersion":1,"status":"COLLECTING"}\n', encoding="utf-8")
    try:
        product = json.loads(Path("release/product.generated.json").read_bytes())
        library = json.loads(args.library_identity.read_bytes())
        source = subprocess.check_output(["git", "rev-parse", "HEAD"]).decode().strip()
        if library["sourceSha"] != source:
            raise ValueError("Companion scanner belongs to another candidate")
        record = verify_exports(args.attachments, args.scanner_directory, product, library, args.approved)
        args.output.write_text(json.dumps({"schemaVersion": 1, "status": "PASS", "sourceSha": source,
                                           "completeSupportBundle": False, "export": record}, indent=2) + "\n", encoding="utf-8")
        return 0
    except Exception:
        # JSON, file and scanner failures may contain exported bytes or temporary paths.
        args.output.write_text('{"schemaVersion":1,"status":"FAIL","reason":"Saved Companion support was not accepted"}\n', encoding="utf-8")
        return 1
