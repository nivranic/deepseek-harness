"""Stage already built and natively exercised scanner bytes for Xcode application targets."""

import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import zipfile

from .apple_scanner_artifact import framework_entries, native_observation, verify_archived_framework
from .apple_scanner_build import BUILD_FILES
from .mobile_scanner_source import read_source, write_proxy


def stage_apple(repository: Path, commit: str, *, directory: Path, framework: Path, verification: Path, output: Path) -> dict:
    """Copy admitted compiler inputs and notices to a new directory without running an application."""
    if output.exists() or output.is_symlink():
        raise ValueError("Apple scanner staging output must be new")
    if any(output.resolve().is_relative_to(path.resolve()) or path.resolve().is_relative_to(output.resolve())
           for path in (directory, framework, verification)):
        raise ValueError("Apple scanner staging output must be disjoint from its inputs")
    receipt_bytes = (directory / "scanner.json").read_bytes()
    receipt = json.loads(receipt_bytes)
    proof_bytes = verification.read_bytes()
    proof = json.loads(proof_bytes)
    source = read_source(repository, commit)
    if type(receipt.get("schemaVersion")) is not int or receipt["schemaVersion"] != 1 or receipt.get("status") != "BUILT" or receipt.get("staticVerification") != "PASS":
        raise ValueError("Apple scanner staging requires a verified build")
    if receipt.get("sourceSha") != commit or receipt.get("treeSha") != source.tree or receipt.get("artifact") != "support-scanner-apple.zip":
        raise ValueError("Apple scanner staging source differs")
    archive_path = directory / receipt["artifact"]
    if archive_path.is_symlink() or not archive_path.is_file():
        raise ValueError("Apple scanner archive must be a regular file")
    archive = archive_path.read_bytes()
    digest = hashlib.sha256(archive).hexdigest()
    if receipt.get("bytes") != len(archive) or receipt.get("sha256") != digest:
        raise ValueError("Apple scanner archive digest differs")
    manifest = receipt["manifest"]
    with tempfile.TemporaryDirectory(prefix="dsh-apple-stage-source-") as temporary:
        expected_source = write_proxy(source, Path(temporary) / "proxy")
    if manifest["source"] != expected_source:
        raise ValueError("Apple scanner source material differs from Git")
    builders = []
    for name in BUILD_FILES:
        blob = subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-C", str(repository), "show", commit + ":" + name], stderr=subprocess.PIPE)
        builders.append({"path": name, "sha256": hashlib.sha256(blob).hexdigest()})
    if manifest["builderFiles"] != builders:
        raise ValueError("Apple scanner builder material differs from Git")
    if type(proof.get("schemaVersion")) is not int or proof["schemaVersion"] != 1 or proof.get("status") != "PASS" or proof.get("sourceSha") != commit or proof.get("treeSha") != source.tree:
        raise ValueError("Apple scanner native verification source differs")
    if proof.get("scannerArchiveSha256") != digest or proof.get("simulatorDeleted") is not True:
        raise ValueError("Apple scanner native verification is incomplete or names different bytes")
    observations = proof.get("observations")
    if not isinstance(observations, list) or len(observations) != 2:
        raise ValueError("Apple scanner requires both native platform observations")
    for value, platform in zip(observations, ("macos", "ios-simulator"), strict=True):
        if not isinstance(value, dict) or value.get("architecture") not in ("arm64", "x86_64"):
            raise ValueError("Apple scanner native architecture is unsupported")
        native_observation(value, platform, value["architecture"])
    if any(observations[0][key] != observations[1][key] for key in ("scannerVersion", "rulesDigest", "architecture")):
        raise ValueError("Apple scanner native platforms disagree")
    binaries = proof.get("binaries")
    if not isinstance(binaries, list) or len(binaries) != 2:
        raise ValueError("Apple scanner native verification must identify both linked probes")
    for value, platform in zip(binaries, ("macos", "ios-simulator"), strict=True):
        if not isinstance(value, dict) or set(value) != {"platform", "path", "sha256"} or value["platform"] != platform or value["path"] != platform:
            raise ValueError("Apple scanner native probe identity differs")
        if not isinstance(value["sha256"], str) or re.fullmatch(r"[a-f0-9]{64}", value["sha256"]) is None:
            raise ValueError("Apple scanner native probe digest is invalid")
    files, links, libraries = framework_entries(framework)
    inventory = [{"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name, data in sorted(files.items())]
    expected_libraries = [{**row, "sha256": hashlib.sha256(files[row["binary"]]).hexdigest(), "bytes": len(files[row["binary"]])} for row in libraries]
    if inventory != manifest["files"] or links != manifest["links"] or expected_libraries != manifest["libraries"]:
        raise ValueError("Apple scanner staged compiler inputs differ")
    verify_archived_framework(archive, files, links, manifest)
    output.mkdir(parents=True)
    staged_framework = output / "SupportScanner.xcframework"
    shutil.copytree(framework, staged_framework, symlinks=True)
    if framework_entries(staged_framework) != (files, links, libraries):
        raise ValueError("Apple scanner compiler inputs changed while copying")
    resources = output / "SupportScannerResources"
    resources.mkdir()
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        for entry in zipped.infolist():
            if entry.filename.startswith("licenses/"):
                destination = resources / entry.filename
                destination.parent.mkdir(parents=True, exist_ok=True)
                with destination.open("xb") as stream:
                    stream.write(zipped.read(entry))
    identity = {"schemaVersion": 1, "sourceSha": commit, "treeSha": source.tree,
                "archiveSha256": digest, "scannerVersion": observations[0]["scannerVersion"],
                "rulesDigest": observations[0]["rulesDigest"]}
    (resources / "identity.json").write_text(json.dumps(identity, sort_keys=True) + "\n", encoding="utf-8")
    (resources / "scanner.json").write_bytes(receipt_bytes)
    (resources / "verification.json").write_bytes(proof_bytes)
    result = {"schemaVersion": 1, "status": "STAGED", "sourceSha": commit, "treeSha": source.tree,
              "scannerArchiveSha256": digest, "identity": identity,
              "resources": [{"path": path.relative_to(resources).as_posix(), "bytes": path.stat().st_size,
                             "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                            for path in sorted(resources.rglob("*")) if path.is_file()],
              "applicationExecution": "NOT_EXECUTED"}
    (output / "staging.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return result


def main() -> int:
    """Require explicit build inputs, native proof and immutable application source."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    for name in ("directory", "framework", "verification", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    result = stage_apple(Path(__file__).resolve().parents[2], args.source_sha, directory=args.directory,
                         framework=args.framework, verification=args.verification, output=args.output)
    print(json.dumps({key: value for key, value in result.items() if key != "resources"}))
    return 0
