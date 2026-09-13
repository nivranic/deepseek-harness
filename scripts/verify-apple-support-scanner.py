"""Execute the exact built scanner through Swift on macOS and an owned iOS simulator."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import subprocess
import sys
import uuid

from release.apple_scanner_artifact import apple_dependencies, framework_entries, native_observation, verify_archived_framework
from release.mobile_scanner_source import read_source, write_proxy


def main() -> int:
    """Keep native logs private and retain source-bound, payload-free execution receipts."""
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("directory", "work-dir", "developer-dir", "go", "output"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != "darwin":
        raise ValueError("Apple scanner native verification requires macOS")
    repository = Path(__file__).resolve().parents[1]
    receipt = json.loads((args.directory / "scanner.json").read_bytes())
    source = receipt["sourceSha"]
    if not isinstance(source, str) or re.fullmatch(r"[a-f0-9]{40}", source) is None or receipt.get("artifact") != "support-scanner-apple.zip" or receipt.get("status") != "BUILT" or receipt.get("staticVerification") != "PASS":
        raise ValueError("Apple scanner native verification requires a built scanner receipt")
    if subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repository).decode().strip() != source:
        raise ValueError("Apple scanner native verification requires its exact source checkout")
    for name in ("scripts/verify-apple-support-scanner.py", "scripts/release/fixtures/apple-scanner/main.swift"):
        blob = subprocess.check_output(["git", "show", source + ":" + name], cwd=repository)
        if (repository / name).read_bytes() != blob:
            raise ValueError("Apple scanner native verifier must match its source commit")
    archive = args.directory / receipt["artifact"]
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size != receipt["bytes"] or hashlib.sha256(archive.read_bytes()).hexdigest() != receipt["sha256"]:
        raise ValueError("Apple scanner archive changed before native verification")
    framework = args.work_dir / "SupportScanner.xcframework"
    files, links, libraries = framework_entries(framework)
    inventory = [{"path": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)} for name, data in sorted(files.items())]
    if inventory != receipt["manifest"]["files"] or links != receipt["manifest"]["links"]:
        raise ValueError("Apple scanner native inputs changed")
    expected_libraries = [{**row, "sha256": hashlib.sha256(files[row["binary"]]).hexdigest(), "bytes": len(files[row["binary"]])} for row in libraries]
    if expected_libraries != receipt["manifest"]["libraries"]:
        raise ValueError("Apple scanner native library inventory changed")
    verify_archived_framework(archive.read_bytes(), files, links, receipt["manifest"])
    target = args.output.resolve()
    if target.exists() or args.output.is_symlink():
        raise ValueError("Apple scanner native output must be new")
    target.mkdir(parents=True)
    source_receipt = write_proxy(read_source(repository, source), target / "source-proxy")
    if source_receipt != receipt["manifest"]["source"]:
        raise ValueError("Apple scanner source material differs from Git")
    env = {key: os.environ[key] for key in ("HOME", "TMPDIR", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY") if key in os.environ}
    env.update(DEVELOPER_DIR=str(args.developer_dir.resolve()), PATH=str(args.go.resolve().parent) + ":/usr/bin:/bin:/usr/sbin:/sbin",
               GOENV="off", GOWORK="off", GOTOOLCHAIN="local")
    sequence = 0

    def run(arguments: list[str], timeout: int = 180) -> bytes:
        nonlocal sequence
        sequence += 1
        result = subprocess.run(arguments, cwd=repository, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
        (target / (str(sequence) + ".stdout")).write_bytes(result.stdout)
        (target / (str(sequence) + ".stderr")).write_bytes(result.stderr)
        if result.returncode:
            raise RuntimeError("Apple scanner native command failed; inspect the private native log")
        return result.stdout

    policy = receipt["manifest"]["toolchain"]
    actual_xcode = run(["/usr/bin/xcodebuild", "-version"]).decode().strip().splitlines()
    if actual_xcode != ["Xcode " + policy["xcodeVersion"], "Build version " + policy["xcodeBuild"]]:
        raise ValueError("Apple scanner native Xcode differs from the library build")
    architecture = platform.machine()
    if architecture not in ("arm64", "x86_64"):
        raise ValueError("Apple scanner native architecture is unsupported")
    observations = []
    binaries = []
    for sdk, library, system, version, expected_platform in [
        ("macosx", "macos-arm64_x86_64", "macosx", policy["minimumMacOSVersion"], "macos"),
        ("iphonesimulator", "ios-arm64_x86_64-simulator", "ios", policy["minimumIOSVersion"], "ios-simulator"),
    ]:
        sdk_path = run(["/usr/bin/xcrun", "--sdk", sdk, "--show-sdk-path"]).decode().strip()
        triple = architecture + "-apple-" + system + version + ("-simulator" if sdk == "iphonesimulator" else "")
        executable = target / expected_platform
        run(["/usr/bin/xcrun", "--sdk", sdk, "swiftc", "-swift-version", "5", "-sdk", sdk_path, "-target", triple,
             "-F", str(framework / library), "-framework", "SupportScanner", "-framework", "Foundation", "-framework", "Security",
             str(repository / "scripts/release/fixtures/apple-scanner/main.swift"), "-o", str(executable)])
        info = json.loads(run([str(args.go), "version", "-m", "-json", str(executable)]))
        modules = apple_dependencies(info, receipt["manifest"]["source"]["moduleVersion"], "ios" if sdk == "iphonesimulator" else "macos", architecture)
        if modules != [{key: value for key, value in row.items() if key != "licenses"} for row in receipt["manifest"]["modules"]]:
            raise ValueError("Apple scanner linked module graph differs from its archive")
        binaries.append({"platform": expected_platform, "path": executable.name, "sha256": hashlib.sha256(executable.read_bytes()).hexdigest()})
        if sdk == "macosx":
            value = json.loads(run([str(executable)]))
        else:
            sdk_version = run(["/usr/bin/xcrun", "--sdk", sdk, "--show-sdk-version"]).decode().strip()
            runtimes = json.loads(run(["/usr/bin/xcrun", "simctl", "list", "runtimes", "--json"]))["runtimes"]
            matching = [row for row in runtimes if row.get("isAvailable") and row["identifier"].startswith("com.apple.CoreSimulator.SimRuntime.iOS-") and row["version"] == sdk_version]
            if len(matching) != 1:
                raise ValueError("Apple scanner verification requires the selected SDK's available iOS runtime")
            device = run(["/usr/bin/xcrun", "simctl", "create", "dsh-scanner-" + uuid.uuid4().hex,
                          "com.apple.CoreSimulator.SimDeviceType.iPhone-16", matching[0]["identifier"]]).decode().strip()
            uuid.UUID(device)
            try:
                run(["/usr/bin/xcrun", "simctl", "boot", device])
                run(["/usr/bin/xcrun", "simctl", "bootstatus", device, "-b"], timeout=240)
                run(["/usr/bin/codesign", "--sign", "-", "--force", str(executable)])
                binaries[-1]["sha256"] = hashlib.sha256(executable.read_bytes()).hexdigest()
                value = json.loads(run(["/usr/bin/xcrun", "simctl", "spawn", device, str(executable)]))
            finally:
                try:
                    run(["/usr/bin/xcrun", "simctl", "shutdown", device])
                finally:
                    run(["/usr/bin/xcrun", "simctl", "delete", device])
        observations.append(native_observation(value, expected_platform, architecture))
    if observations[0]["rulesDigest"] != observations[1]["rulesDigest"]:
        raise ValueError("Apple scanner platforms use different compiled rules")
    proof = {"schemaVersion": 1, "sourceSha": source, "treeSha": receipt["treeSha"], "status": "PASS",
             "scope": "Swift calls to native scanner bindings; no application export or physical-device claim",
             "scannerArchiveSha256": receipt["sha256"], "observations": observations, "binaries": binaries,
             "simulatorDeleted": True}
    (target / "verification.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(proof))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        # Native errors and compiler output remain in private work files, never in the acceptance receipt.
        print("Apple scanner native verification failed; inspect private logs", file=sys.stderr)
        raise SystemExit(1)
