"""Check the fresh test simulator's local Files destination and scan its actual saved document."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys

from .companion_support_exports import scan_saved_document, validate_export
from .support_exports import unique_object


PROVIDER = "group.com.apple.FileProvider.LocalStorage"
FILENAME = "dsh-companion-diagnostics.json"


def read_regular(path: Path, maximum: int) -> bytes:
    """Bound reads and reject symlinks, special files or replacement while the document is read."""
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_size > maximum:
        raise ValueError("unexpected simulator evidence file")
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(descriptor, "rb") as stream:
        opened = os.fstat(stream.fileno())
        if (before.st_dev, before.st_ino, before.st_size) != (opened.st_dev, opened.st_ino, opened.st_size):
            raise ValueError("simulator evidence file changed before reading")
        data = stream.read(maximum + 1)
        after = os.fstat(stream.fileno())
    if len(data) > maximum or (opened.st_size, opened.st_mtime_ns) != (after.st_size, after.st_mtime_ns) \
            or len(data) != opened.st_size:
        raise ValueError("simulator evidence file changed while reading")
    return data


def local_files(data_root: Path) -> Path:
    """Resolve the local Files provider by its container metadata, never an arbitrary matching filename."""
    groups = data_root / "Containers/Shared/AppGroup"
    if groups.is_symlink() or not groups.is_dir() or not groups.resolve().is_relative_to(data_root.resolve()):
        raise ValueError("simulator application-group directory is unavailable")
    matches = []
    for index, group in enumerate(groups.iterdir()):
        if index >= 1024:
            raise ValueError("simulator application-group inventory exceeds limits")
        if group.is_symlink() or not group.is_dir():
            raise ValueError("unexpected simulator application-group entry")
        metadata = group / ".com.apple.mobile_container_manager.metadata.plist"
        if not metadata.exists() and not metadata.is_symlink():
            continue
        info = plistlib.loads(read_regular(metadata, 65536))
        if isinstance(info, dict) and info.get("MCMMetadataIdentifier") == PROVIDER:
            matches.append(group / "File Provider Storage")
    if len(matches) != 1:
        raise ValueError("expected one local Files provider container")
    storage = matches[0]
    if storage.is_symlink() or (storage.exists() and not storage.is_dir()):
        raise ValueError("local Files provider storage is invalid")
    return storage


def document_at_destination(data_root: Path) -> bytes | None:
    """Inspect only the requested local Files document; temporary export staging cannot satisfy this check."""
    storage = local_files(data_root)
    target = storage / FILENAME
    if not target.exists() and not target.is_symlink():
        return None
    return read_regular(target, 16384)


def collect(data_root: Path, output: Path, phase: str, source: str, product: dict,
            library: dict, scanner_directory: Path) -> dict:
    """Require an absent destination after cancellation, then admit the exact file created by the save case."""
    if phase not in ("cancelled", "saved") or library["sourceSha"] != source:
        raise ValueError("unexpected iOS verification phase or source")
    if output.is_symlink() or output.resolve().is_relative_to(data_root.resolve()):
        raise ValueError("iOS support evidence must be outside the simulator")
    data = document_at_destination(data_root)
    cancelled = {"schemaVersion": 1, "sourceSha": source, "platform": "ios", "phase": "cancelled",
                 "status": "PASS", "destinationFileExists": False}
    if phase == "cancelled":
        if output.exists() or data is not None:
            raise ValueError("cancelled iOS export created a file or evidence output already exists")
        output.mkdir(parents=True)
        (output / "cancelled.json").write_text(json.dumps(cancelled, indent=2) + "\n", encoding="utf-8")
        return cancelled
    if not output.is_dir() or {p.name for p in output.iterdir()} != {"cancelled.json"} or data is None:
        raise ValueError("iOS save requires its cancellation receipt and actual destination file")
    receipt = json.loads(read_regular(output / "cancelled.json", 4096), object_pairs_hook=unique_object)
    if receipt != cancelled or type(receipt["schemaVersion"]) is not int or receipt["destinationFileExists"] is not False:
        raise ValueError("iOS save requires its cancellation receipt and actual destination file")
    validate_export(data, product, library)
    scan_saved_document(data, scanner_directory, library)
    if document_at_destination(data_root) != data:
        raise ValueError("saved iOS document changed during independent scanning")
    record = {"schemaVersion": 1, "status": "PASS", "sourceSha": source, "platform": "ios", "phase": "saved",
              "origin": "local-files-provider", "scenario": "unpaired", "completeSupportBundle": False,
              "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "findings": 0}
    with (output / "approved.json").open("xb") as stream:
        stream.write(data)
    (output / "saved.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


def main() -> int:
    """Read the default disposable simulator set; never mutate its Files storage or expose raw errors."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--simulator", required=True)
    parser.add_argument("--phase", choices=("cancelled", "saved"), required=True)
    for name in ("output", "library-identity", "scanner-directory"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    try:
        if sys.platform != "darwin" or re.fullmatch(r"[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}", args.simulator) is None:
            raise ValueError("a macOS test simulator is required")
        source = subprocess.check_output(["git", "rev-parse", "HEAD"]).decode().strip()
        root = Path.home() / "Library/Developer/CoreSimulator/Devices" / args.simulator / "data"
        if root.is_symlink() or not root.is_dir():
            raise ValueError("test simulator data directory is unavailable")
        product = json.loads(Path("release/product.generated.json").read_bytes())
        library = json.loads(args.library_identity.read_bytes())
        record = collect(root, args.output, args.phase, source, product, library, args.scanner_directory)
        print(json.dumps(record))
        return 0
    except Exception:
        # Container, JSON and scanner errors may contain application bytes or paths.
        print("Saved iOS Companion diagnostics were not accepted", file=sys.stderr)
        return 1
