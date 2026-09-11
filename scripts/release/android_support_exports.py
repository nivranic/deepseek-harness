"""Verify actual DocumentsUI cancellation and saved bytes on a disposable Android runner."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from android_candidate_device import CandidateDevice, require_disposable_host
from android_sbom_inventory import archive_entries, read_member, require, sha_file
from android_support_ui import PACKAGE, SupportUi
from release.secret_scan import install_gitleaks, scan, self_test
from release.support_exports import unique_object

UNCOLLECTED = ["runtime-health", "updates", "native-crashes", "session-diagnostics"]


def read_json(data):
    """Bound complete UTF-8 input and reject duplicate fields before any scenario projection."""
    require(0 < len(data) <= 16384, "Android support JSON exceeds its byte limit")
    return json.loads(data.decode("utf-8"), object_pairs_hook=unique_object)


def validate_export(data, product, scanner):
    """Accept only the actual unpaired application's four idle model owners and unavailable Link."""
    value = read_json(data)
    expected = {
        "schemaVersion": 1, "platform": "android", "runtimeClass": "companion", "complete": False,
        "product": {key: product[key] for key in ("version", "buildNumber", "channel")},
        "localIdentity": {"producer": "CompanionRuntime", "observation": "current", "restored": False},
        "transport": {"producer": "LinkClient", "observation": "unavailable"},
        "connections": {name: {"producer": owner, "observation": "current", "activityScope": "model-lifetime",
                                "snapshot": {"state": "idle", "attempts": 0, "interruptions": 0, "countsSaturated": False}}
                        for name, owner in (("sessionFollow", "SessionModel"), ("interactions", "InteractionModel"),
                                            ("workspaces", "FilesModel"), ("pushes", "PushModel"))},
        "role": {"producer": "LinkCredentials", "observation": "unavailable"},
        "protocol": {"producer": "LinkClient.describe", "observation": "unavailable", "queryState": "unavailable"},
        "capabilities": {"producer": "LinkClient.describe", "observation": "unavailable"},
        "scanner": scanner, "uncollected": UNCOLLECTED,
    }
    # Canonical JSON comparison preserves distinctions such as false, 0 and 0.0 at every nested field.
    require(json.dumps(value, sort_keys=True, allow_nan=False) == json.dumps(expected, sort_keys=True, allow_nan=False),
            "Android support fields or producer observations differ")


def scanner_identity(apk, native_proof, source, abi, registry):
    """Bind the JNI-observed rules identity to the inspected APK and its committed scanner inputs."""
    require(isinstance(native_proof, dict) and set(native_proof) == {"schemaVersion", "apkSha256", "scanner"}
            and type(native_proof["schemaVersion"]) is int and native_proof["schemaVersion"] == 1
            and native_proof["apkSha256"] == sha_file(apk), "Android native scanner proof differs from the APK")
    identity = native_proof["scanner"]
    require(isinstance(identity, dict) and set(identity) == {"version", "rulesDigest", "sourceSha", "nativeSha256"}
            and identity["version"] == registry["gitleaks"]["version"] and identity["sourceSha"] == source
            and all(isinstance(identity[key], str) and re.fullmatch(r"[a-f0-9]{64}", identity[key])
                    for key in ("rulesDigest", "nativeSha256")), "Android native scanner identity is incomplete")
    require(abi in ("x86_64", "arm64-v8a"), "Unsupported Android support runtime architecture")
    with zipfile.ZipFile(apk) as archive:
        entries = archive_entries(archive)
        manifest = json.loads(read_member(archive, entries["assets/dsh-support-scanner/manifest.json"]))
        require(manifest["source"]["sourceSha"] == source, "Android scanner belongs to another source")
        selected = [item for item in manifest["libraries"] if item["abi"] == abi]
        require(len(selected) == 1, "Android scanner architecture is ambiguous")
        library = read_member(archive, entries["lib/" + abi + "/libgojni.so"])
        require(len(library) == selected[0]["bytes"]
                and hashlib.sha256(library).hexdigest() == selected[0]["sha256"] == identity["nativeSha256"],
                "Android installed scanner bytes differ")
    return identity


def owned_files(device, prefix):
    """Select only the fresh scenario's nonce-named files, including a system-generated duplicate suffix."""
    require(re.fullmatch(r"dsh-support-[a-f0-9]{32}", prefix) is not None, "Invalid Android support filename prefix")
    rows = device.shell(["find", "/sdcard/Download", "-maxdepth", "1", "-type", "f", "-name", prefix + "*.json", "-print"])
    files = rows.decode("utf-8").splitlines()
    require(len(files) <= 8 and all(re.fullmatch(r"/sdcard/Download/" + prefix + r"(?: \([0-9]+\))?\.json", path)
                                  for path in files), "Unexpected Android support destination")
    return files


def saved_bytes(device, path):
    """Read the actual local destination with a byte bound; no exporter or cache copy can substitute."""
    data = device.shell(["head", "-c", "16385", path])
    require(0 < len(data) <= 16384, "Saved Android support document exceeds its byte limit")
    return data


def collect_export(device, ui, filename, product, identity, scanner, scratch, progress=None):
    """Cancel before saving and admit final bytes only after a canary, independent scan and stable reread."""
    progress = {} if progress is None else progress
    progress["stage"] = "destination-check"
    prefix = filename.removesuffix(".json")
    path = "/sdcard/Download/" + filename
    require(not owned_files(device, prefix), "Android support destination already exists")
    try:
        progress["stage"] = "cancel-picker"
        ui.open_picker(filename)
        progress["stage"] = "cancel"
        ui.cancel()
        require(not owned_files(device, prefix), "Android cancellation created a document")
        ui.screenshot("cancelled")
        progress["stage"] = "save-picker"
        picker = ui.open_picker(filename)
        progress["stage"] = "save"
        ui.save(picker)
        progress["stage"] = "saved-document"
        require(owned_files(device, prefix) == [path], "Android save did not create the exact destination")
        data = saved_bytes(device, path)
        validate_export(data, product, identity)
        progress["stage"] = "independent-canary"
        self_test(scanner, scratch)
        sample = scratch / "saved"
        sample.mkdir()
        (sample / "export.json").write_bytes(data)
        progress["stage"] = "independent-scan"
        require(not scan(scanner, ["dir", str(sample)], scratch, "android-saved"), "Android saved document has a secret finding")
        progress["stage"] = "saved-reread"
        require(saved_bytes(device, path) == data and owned_files(device, prefix) == [path], "Android saved document changed during admission")
        ui.screenshot("saved")
        return data
    finally:
        try:
            for file in owned_files(device, prefix):
                device.shell(["rm", "--", file])
            require(not owned_files(device, prefix), "Android support destination cleanup failed")
        except Exception:
            progress["stage"] = "destination-cleanup"
            raise


def copy_installed_apk(device, apk, installed, progress):
    """Keep location, retrieval and byte-identity failures distinct without retaining device paths."""
    progress["stage"] = "installed-apk-location"
    paths = device.shell(["pm", "path", PACKAGE]).decode("utf-8").strip().splitlines()
    require(len(paths) == 1 and re.fullmatch(r"package:/data/app/[^\r\n]+/base\.apk", paths[0]), "Android support requires the installed test APK")
    progress["stage"] = "installed-apk-retrieval"
    device.command(["pull", paths[0].removeprefix("package:"), str(installed)], "Android support installed APK retrieval", 120)
    progress["stage"] = "installed-apk-identity"
    identity = {"candidateSha256": sha_file(apk), "installedSha256": sha_file(installed)}
    progress["apkIdentity"] = identity
    require(identity["candidateSha256"] == identity["installedSha256"], "Android support installed APK differs")


def verify(apk, source, output, progress=None):
    """Exercise the installed candidate only on the hosted Linux emulator and preserve admitted evidence."""
    progress = {} if progress is None else progress
    progress["stage"] = "disposable-host"
    require_disposable_host(sys.platform, os.environ)
    progress["stage"] = "source-checkout"
    require(re.fullmatch(r"[a-f0-9]{40}", source) is not None, "Android support requires an immutable source")
    def git(*arguments):
        return subprocess.check_output(["git", "-C", str(ROOT), *arguments], stderr=subprocess.DEVNULL).strip()
    require(git("rev-parse", "HEAD^{tree}") == git("rev-parse", source + "^{tree}")
            and not git("status", "--porcelain", "--untracked-files=no"), "Android support checkout differs from the source")
    product = json.loads((ROOT / "release/product.generated.json").read_bytes())
    registry = json.loads((ROOT / ".github/security/scanners.json").read_bytes())
    sdk = Path(os.environ.get("ANDROID_HOME", ""))
    require(sdk.is_absolute(), "Android support requires an absolute SDK directory")
    progress["stage"] = "device-runtime"
    device = CandidateDevice(sdk / "platform-tools/adb")
    runtime = device.runtime()
    nonce = uuid.uuid4().hex
    ui = SupportUi(device, output, nonce)
    with tempfile.TemporaryDirectory(prefix="dsh-android-support-") as temporary:
        scratch = Path(temporary)
        installed = scratch / "installed.apk"
        copy_installed_apk(device, apk, installed, progress)
        progress["stage"] = "native-scanner-identity"
        proof = read_json(device.shell(["run-as", PACKAGE, "cat", "cache/support-scanner-identity.json"]))
        identity = scanner_identity(apk, proof, source, device.shell(["getprop", "ro.product.cpu.abi"]).decode().strip(), registry)
        progress["stage"] = "independent-scanner"
        scanner, tool = install_gitleaks(registry, scratch)
        try:
            progress["stage"] = "application-launch"
            device.shell(["am", "force-stop", PACKAGE])
            launched = device.shell(["am", "start", "-W", "-n", PACKAGE + "/ai.deepseek.dsh.companion.MainActivity"])
            require(re.search(rb"(?m)^Status: ok\r?$", launched), "Android support Activity launch failed")
            data = collect_export(device, ui, "dsh-support-" + nonce + ".json", product, identity, scanner, scratch, progress)
        except Exception:
            ui.record_failure()
            raise
        finally:
            try:
                try:
                    ui.close()
                finally:
                    device.shell(["am", "force-stop", PACKAGE])
                    require(not device.shell(["pidof", PACKAGE], empty_exit=True).strip(), "Android support process remains after cleanup")
            except Exception:
                progress["stage"] = "application-cleanup"
                raise
    progress["stage"] = "evidence-publication"
    (output / "scanner-identity.json").write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    with (output / "approved.json").open("xb") as file:
        file.write(data)
    return {"schemaVersion": 1, "status": "PASS", "sourceSha": source, "apkSha256": sha_file(apk), "platform": "android",
            "scenario": "unpaired", "origin": "local-documentsui-downloads", "completeSupportBundle": False,
            "runtime": runtime, "cancelledDestinationAbsent": True, "savedDestinationRemoved": True,
            "processStopped": True, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
            "findings": 0, "independentCanary": "PASS", "independentScanner": tool}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    require(not args.output.exists() and not args.output.is_symlink(), "Android support output must be new")
    args.output.mkdir(parents=True)
    progress = {"stage": "initialization"}
    try:
        record = verify(args.apk.resolve(), args.source_sha, args.output, progress)
    except Exception:
        # Device, parser and scanner failures can contain unapproved bytes or private paths.
        record = {"schemaVersion": 1, "status": "FAIL", "stage": progress["stage"],
                  "reason": "Android system support export was not accepted"}
        if "apkIdentity" in progress:
            record["apkIdentity"] = progress["apkIdentity"]
    (args.output / "verification.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: record[key] for key in ("schemaVersion", "status")}))
    return 0 if record["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
