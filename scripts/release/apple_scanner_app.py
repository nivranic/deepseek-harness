"""Inspect the scanner actually linked into a Companion app and its packaged provenance."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys

from .apple_scanner_artifact import apple_dependencies
from .apple_scanner_stage import verify_source_material


def packaged_resources(resources: Path, stage: dict, source_sha: str) -> dict:
    """Require every staged notice and provenance byte, excluding extra files and all links."""
    if type(stage.get("schemaVersion")) is not int or stage["schemaVersion"] != 1 or stage.get("status") != "STAGED" or stage.get("sourceSha") != source_sha:
        raise ValueError("Apple application scanner staging source differs")
    if resources.is_symlink() or not resources.is_dir():
        raise ValueError("Apple application scanner resources must be a regular directory")
    rows = stage.get("resources")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Apple application scanner resource inventory is absent")
    expected = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {"path", "bytes", "sha256"} or not isinstance(row["path"], str):
            raise ValueError("Apple application scanner resource record is invalid")
        if type(row["bytes"]) is not int or not 0 < row["bytes"] <= 16 * 1024 * 1024 or not isinstance(row["sha256"], str) or re.fullmatch(r"[a-f0-9]{64}", row["sha256"]) is None:
            raise ValueError("Apple application scanner resource size or digest is invalid")
        name = row["path"]; relative = PurePosixPath(name)
        if not name or name != relative.as_posix() or relative.is_absolute() or ".." in relative.parts or any(c in name for c in ("\\", ":", "\0")) or name in expected:
            raise ValueError("Apple application scanner resource path is unsafe or repeated")
        expected[name] = row
    actual = {}
    for path in resources.rglob("*"):
        if path.is_symlink():
            raise ValueError("Apple application scanner resources must not contain links")
        if path.is_dir():
            continue
        name = path.relative_to(resources).as_posix()
        if not path.is_file() or name not in expected or path.stat().st_size != expected[name]["bytes"]:
            raise ValueError("Apple application scanner resource inventory differs")
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected[name]["sha256"]:
            raise ValueError("Apple application scanner resource digest differs")
        actual[name] = data
    if set(actual) != set(expected):
        raise ValueError("Apple application scanner resources are incomplete")
    identity = json.loads(actual["identity.json"])
    receipt = json.loads(actual["scanner.json"])
    if identity != stage["identity"] or receipt["sourceSha"] != source_sha or receipt["treeSha"] != stage["treeSha"]:
        raise ValueError("Apple application scanner identity differs")
    if receipt["sha256"] != stage["scannerArchiveSha256"] or identity["archiveSha256"] != receipt["sha256"]:
        raise ValueError("Apple application scanner archive identity differs")
    return receipt


def linked_modules(info: dict, manifest: dict, platform: str, architecture: str) -> list[dict]:
    """Compare the final executable's Go reader output with the admitted library graph."""
    if info.get("GoVersion") != "go" + manifest["toolchain"]["goVersion"]:
        raise ValueError("Apple application scanner compiler differs")
    modules = apple_dependencies(info, manifest["source"]["moduleVersion"], platform, architecture)
    expected = [{key: value for key, value in row.items() if key != "licenses"} for row in manifest["modules"]]
    if modules != expected:
        raise ValueError("Apple application linked scanner module graph differs")
    return modules


def application_paths(application: Path, platform: str) -> tuple[Path, Path, Path]:
    """Select the fixed Companion paths without following an application root or external parent link."""
    app = application.resolve()
    if application.is_symlink() or not app.is_dir():
        raise ValueError("Apple application must be a regular directory")
    resources = app / "Contents/Resources" if platform == "macos" else app
    executable = app / "Contents/MacOS/DSH Companion" if platform == "macos" else app / "DSH Companion"
    if not resources.resolve().is_relative_to(app):
        raise ValueError("Apple application resources leave the application directory")
    if executable.is_symlink() or not executable.is_file() or not executable.resolve().is_relative_to(app):
        raise ValueError("Apple Companion executable must be a regular file")
    return app, resources, executable


def main() -> int:
    """Read every final app slice using maintained Go tools; never launch the application."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "stage", "output"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--platform", required=True, choices=("macos", "ios"))
    parser.add_argument("--go", default="go")
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise ValueError("Apple application scanner inspection requires macOS")
    repository = Path(__file__).resolve().parents[2]
    source = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository).decode().strip()
    for name in ("scripts/verify-apple-app-scanner.py", "scripts/release/apple_scanner_app.py", "scripts/release/apple_scanner_stage.py"):
        if subprocess.check_output(["git", "show", source + ":" + name], cwd=repository) != (repository / name).read_bytes():
            raise ValueError("Apple application scanner verifier must match its committed source")
    stage = json.loads((args.stage / "staging.json").read_bytes())
    app, resources, executable = application_paths(args.app, args.platform)
    receipt = packaged_resources(resources / "SupportScannerResources", stage, source)
    material = verify_source_material(repository, source, receipt["manifest"])
    if material.tree != receipt["treeSha"]:
        raise ValueError("Apple application scanner tree differs from Git")
    executable_digest = hashlib.sha256(executable.read_bytes()).hexdigest()
    output = args.output.resolve()
    if args.output.is_symlink() or output.exists():
        raise ValueError("Apple application scanner inspection output must be new")
    if output.is_relative_to(app) or output.is_relative_to(args.stage.resolve()):
        raise ValueError("Apple application scanner inspection output must be outside its inputs")
    output.mkdir(parents=True)
    env = {**os.environ, "GOENV": "off", "GOWORK": "off", "GOTOOLCHAIN": "local", "GOVCS": "*:off", "GOSUMDB": "sum.golang.org"}
    sequence = 0

    def run(arguments: list[str]) -> bytes:
        nonlocal sequence
        sequence += 1
        result = subprocess.run(arguments, cwd=repository, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300)
        (output / (str(sequence) + ".stdout")).write_bytes(result.stdout)
        (output / (str(sequence) + ".stderr")).write_bytes(result.stderr)
        if result.returncode:
            raise RuntimeError("Apple application scanner command failed; inspect its private work logs")
        return result.stdout

    policy = receipt["manifest"]
    if run([args.go, "env", "GOVERSION"]).decode().strip() != "go" + policy["toolchain"]["goVersion"]:
        raise ValueError("Apple application scanner reader differs from the pinned Go version")
    architectures = run(["/usr/bin/lipo", "-archs", str(executable)]).decode().split()
    if not architectures or len(set(architectures)) != len(architectures) or not set(architectures) <= {"arm64", "x86_64"}:
        raise ValueError("Apple application executable architectures are unsupported")
    slices = []
    for architecture in architectures:
        thin = output / (architecture + ".bin")
        with executable.open("rb") as stream:
            universal = stream.read(4) in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf", b"\xbe\xba\xfe\xca", b"\xbf\xba\xfe\xca")
        if universal:
            run(["/usr/bin/lipo", str(executable), "-thin", architecture, "-output", str(thin)])
        else:
            if len(architectures) != 1:
                raise ValueError("Apple application architecture list differs from its container")
            shutil.copyfile(executable, thin)
        info = json.loads(run([args.go, "version", "-m", "-json", str(thin)]))
        modules = linked_modules(info, policy, args.platform, architecture)
        run([args.go, "run", "golang.org/x/vuln/cmd/govulncheck@v1.8.0", "-mode=binary", str(thin)])
        slices.append({"architecture": architecture, "sha256": hashlib.sha256(thin.read_bytes()).hexdigest(),
                       "moduleCount": len(modules), "vulnerabilities": "PASS"})
    if hashlib.sha256(executable.read_bytes()).hexdigest() != executable_digest or packaged_resources(resources / "SupportScannerResources", stage, source) != receipt:
        raise ValueError("Apple application bytes changed during inspection")
    proof = {"schemaVersion": 1, "status": "PASS", "sourceSha": source, "treeSha": receipt["treeSha"],
             "platform": args.platform, "executableSha256": executable_digest,
             "scannerArchiveSha256": receipt["sha256"], "resources": stage["resources"], "slices": slices,
             "scope": "Final application resources and linked Go modules; no application execution claim"}
    (output / "verification.json").write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in proof.items() if key != "resources"}))
    return 0
