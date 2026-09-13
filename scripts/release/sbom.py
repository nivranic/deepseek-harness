"""Scan an actual packaged directory with checksum-pinned Syft and explicit configuration."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile


def syft_archive(registry: object, system: str, machine: str) -> tuple[str, dict]:
    """Resolve only a recorded official Syft archive for Linux or Windows x64."""
    if not isinstance(registry, dict) or type(registry.get("schemaVersion")) is not int or registry["schemaVersion"] != 1:
        raise ValueError("unsupported scanner registry")
    if system not in ("linux", "win32") or machine.lower() not in ("amd64", "x86_64"):
        raise ValueError("Syft requires a recorded Linux or Windows x64 platform")
    tool = registry["syft"]
    version = tool["version"]
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Syft version must be pinned")
    archive = tool["archives"][f"{system}-x64"]
    suffix, binary = {"linux": ("linux_amd64.tar.gz", "syft"), "win32": ("windows_amd64.zip", "syft.exe")}[system]
    expected = f"https://github.com/anchore/syft/releases/download/v{version}/syft_{version}_{suffix}"
    if archive["url"] != expected or archive["binary"] != binary or not re.fullmatch(r"[a-f0-9]{64}", archive["sha256"]):
        raise ValueError("unrecorded Syft archive owner or digest")
    return version, archive


def install_syft(registry: object, directory: Path) -> tuple[Path, dict]:
    """Hash the download before extracting its sole executable or executing any bytes."""
    version, archive = syft_archive(registry, sys.platform, platform.machine())
    downloaded = directory / "syft.archive"
    digest = hashlib.sha256()
    with urllib.request.urlopen(archive["url"], timeout=60) as response, downloaded.open("xb") as target:
        while chunk := response.read(1024 * 1024):
            digest.update(chunk)
            target.write(chunk)
    if digest.hexdigest() != archive["sha256"]:
        raise ValueError("Syft archive digest mismatch")
    executable = directory / archive["binary"]
    if archive["url"].endswith(".zip"):
        with zipfile.ZipFile(downloaded) as files:
            if files.namelist().count(archive["binary"]) != 1:
                raise ValueError("Syft archive must contain one executable")
            info = files.getinfo(archive["binary"])
            if info.is_dir() or (info.external_attr >> 16) & 0o170000 not in (0, 0o100000):
                raise ValueError("Syft executable must be a regular archive member")
            executable.write_bytes(files.read(info))
    else:
        with tarfile.open(downloaded) as files:
            if files.getnames().count(archive["binary"]) != 1:
                raise ValueError("Syft archive must contain one executable")
            member = files.getmember(archive["binary"])
            stream = files.extractfile(member) if member.isfile() else None
            if stream is None:
                raise ValueError("Syft executable must be a regular archive member")
            executable.write_bytes(stream.read())
    executable.chmod(0o700)
    environment = scanner_environment()
    observed = json.loads(subprocess.run([str(executable), "version", "-o", "json"], env=environment,
                                        check=True, capture_output=True, text=True, encoding="utf-8").stdout)
    if observed.get("version") != version:
        raise ValueError("Syft executable version mismatch")
    return executable, {"name": "syft", "version": version, "archiveSha256": archive["sha256"],
                        "binarySha256": hashlib.sha256(executable.read_bytes()).hexdigest()}


def scanner_environment() -> dict[str, str]:
    """Exclude ambient Syft configuration and disable its network update check."""
    environment = {key: value for key, value in os.environ.items()
                   if not key.upper().startswith("SYFT_") and not re.search(r"KEY|SECRET|TOKEN|PASSWORD", key, re.IGNORECASE)}
    environment["SYFT_CHECK_FOR_APP_UPDATE"] = "false"
    return environment


def real_directory(path: Path) -> bool:
    """Reject directory symlinks and Windows reparse points before resolving the input."""
    info = path.lstat()
    return stat.S_ISDIR(info.st_mode) and not (getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))


def scan_directory(executable: Path, directory: Path, output: Path, work: Path) -> None:
    """Scan a completed packaged closure; a missing output or failed scanner is fatal."""
    if not real_directory(directory):
        raise ValueError("SBOM input must be a real packaged directory")
    config = work / "syft.yaml"
    config.write_text("check-for-app-update: false\n", encoding="utf-8")
    subprocess.run([str(executable), "scan", f"dir:{directory.resolve()}", "--config", str(config),
                    "--override-default-catalogers", "image",
                    "-o", f"cyclonedx-json@1.6={output.resolve()}"], cwd=work, env=scanner_environment(),
                   check=True, capture_output=True, timeout=900)
    if not output.is_file() or output.stat().st_size == 0:
        raise ValueError("Syft produced no SBOM")


def audit_npm_inventory(directory: Path, sbom: Path) -> dict:
    """Require every named, versioned packaged npm manifest in the generated component inventory."""
    if not real_directory(directory):
        raise ValueError("npm inventory root must be a real directory")
    directory = directory.resolve(strict=True)
    if sys.platform == "win32" and not str(directory).startswith("\\\\?\\"):
        absolute = str(directory)
        directory = Path("\\\\?\\UNC\\" + absolute[2:] if absolute.startswith("\\\\") else "\\\\?\\" + absolute)
    expected = set()
    named = set()
    unversioned = 0
    manifests = 0
    def scan_error(error):
        raise error
    for root, directories, files in os.walk(directory, onerror=scan_error, followlinks=False):
        for name in directories + files:
            path = Path(root) / name
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0):
                raise ValueError("packaged npm inventory cannot contain links")
        if "package.json" not in files:
            continue
        manifest = json.loads((Path(root) / "package.json").read_text(encoding="utf-8-sig"))
        manifests += 1
        name, version = manifest.get("name"), manifest.get("version")
        if isinstance(name, str) and name:
            named.add(name)
            if isinstance(version, str) and version:
                expected.add((name, version))
            else:
                unversioned += 1
    if not expected:
        raise ValueError("packaged npm inventory must not be empty")
    document = json.loads(sbom.read_text(encoding="utf-8"))
    actual = set()
    for component in document.get("components", []):
        if not component.get("purl", "").startswith("pkg:npm/"):
            continue
        name = f"{component['group']}/{component['name']}" if component.get("group") else component["name"]
        actual.add((name, component.get("version")))
    missing = expected - actual
    missing_names = named - {name for name, version in actual}
    if missing or missing_names:
        raise ValueError(f"SBOM omits {len(missing)} packaged npm name/version pairs and {len(missing_names)} named packages")
    return {"manifestFiles": manifests, "versionedPackages": len(expected), "unversionedNamedManifests": unversioned,
            "npmComponents": len(actual), "missingVersionedPackages": 0, "missingNamedPackages": 0}


def main() -> int:
    """Generate candidate SBOM and tool receipts without publishing them."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tool-receipt", type=Path, required=True)
    parser.add_argument("--npm-root", type=Path)
    options = parser.parse_args()
    if options.output.exists() or options.tool_receipt.exists():
        raise ValueError("SBOM outputs must not replace existing evidence")
    options.output.parent.mkdir(parents=True, exist_ok=True)
    options.tool_receipt.parent.mkdir(parents=True, exist_ok=True)
    registry = json.loads((Path(__file__).resolve().parents[2] / ".github/security/scanners.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory(prefix="dsh-sbom-") as temporary:
        work = Path(temporary)
        executable, receipt = install_syft(registry, work)
        scan_directory(executable, options.directory, options.output, work)
        receipt["catalogerSet"] = "image"
        if options.npm_root is not None:
            if not options.npm_root.resolve().is_relative_to(options.directory.resolve()):
                raise ValueError("npm inventory must be inside the scanned directory")
            receipt["npmInventory"] = audit_npm_inventory(options.npm_root, options.output)
        options.tool_receipt.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
