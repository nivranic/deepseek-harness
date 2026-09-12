"""Stage a verified native desktop scanner and its license for local support exports."""

import argparse
import hashlib
import json
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import zipfile

from .secret_scan import install_gitleaks, self_test


def stage_support_scanner(registry: dict, output: Path) -> dict:
    """Write a new scanner resource directory only after archive, version and canary verification."""
    if sys.platform not in ("darwin", "win32"):
        raise ValueError("Support scanner staging requires native macOS or Windows")
    if output.exists() or output.is_symlink():
        raise ValueError("Support scanner output must be new")
    with tempfile.TemporaryDirectory(prefix="dsh-support-scanner-") as directory:
        scratch = Path(directory)
        executable, tool = install_gitleaks(registry, scratch)
        self_test(executable, scratch)
        archive = scratch / "scanner.archive"
        if hashlib.sha256(archive.read_bytes()).hexdigest() != tool["archiveSha256"]:
            raise ValueError("Support scanner archive changed after verification")
        if sys.platform == "win32":
            with zipfile.ZipFile(archive) as files:
                if files.namelist().count("LICENSE") != 1:
                    raise ValueError("Support scanner requires one regular license file")
                entry = files.getinfo("LICENSE")
                mode = entry.external_attr >> 16
                if entry.is_dir() or stat.S_IFMT(mode) not in (0, stat.S_IFREG):
                    raise ValueError("Support scanner requires one regular license file")
                license_bytes = files.read(entry)
        else:
            with tarfile.open(archive) as files:
                if files.getnames().count("LICENSE") != 1 or not files.getmember("LICENSE").isfile():
                    raise ValueError("Support scanner requires one regular license file")
                license_bytes = files.extractfile("LICENSE").read()
        if not license_bytes:
            raise ValueError("Support scanner license must not be empty")
        binary = executable.read_bytes()
        if hashlib.sha256(binary).hexdigest() != tool["binarySha256"]:
            raise ValueError("Support scanner executable changed after verification")
        identity = {"schemaVersion": 1, "version": tool["version"], "archiveSha256": tool["archiveSha256"],
                    "originalBinarySha256": tool["binarySha256"], "binarySha256": tool["binarySha256"],
                    "licenseSha256": hashlib.sha256(license_bytes).hexdigest()}
        output.mkdir(mode=0o755)
        binary_name = "gitleaks.exe" if sys.platform == "win32" else "gitleaks"
        for name, data, mode in [(binary_name, binary, 0o755), ("LICENSE", license_bytes, 0o644),
                                  ("scanner.json", (json.dumps(identity, indent=2) + "\n").encode("utf-8"), 0o644)]:
            path = output / name
            with path.open("xb") as stream:
                stream.write(data)
            path.chmod(mode)
        return identity


def main() -> int:
    """Stage the local candidate's scanner; failures expose no process output or temporary paths."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        registry = json.loads(Path(".github/security/scanners.json").read_text(encoding="utf-8"))
        identity = stage_support_scanner(registry, args.output)
        print(json.dumps(identity))
        return 0
    except Exception:
        # Download, archive and scanner errors can carry URLs or redacted report context.
        print("Support scanner staging failed; no verified resources were recorded", file=sys.stderr)
        return 1
