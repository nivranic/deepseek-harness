"""Check serialized ZIP members before macOS extraction can consume unlisted AppleDouble metadata."""

import hashlib
import json
from pathlib import Path, PurePosixPath
import posixpath
import stat
import sys
import zipfile


def portable_path(value):
    """Inventory paths are relative and canonical on both the producing and inspecting hosts."""
    if not isinstance(value, str) or not value or any(char in value for char in ("\\", ":", "\x00")):
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and value == path.as_posix() and value != "."


def verify_archive_zip(path: Path, inventory: dict) -> dict:
    """Require exact member names, regular bytes, permissions and internal link values without extracting."""
    archive = inventory["archive"]
    rows = inventory["files"]
    if not portable_path(archive) or "/" in archive or not archive.endswith(".xcarchive") or not isinstance(rows, list) or not rows:
        raise ValueError("invalid Apple ZIP inventory")
    prefix = archive + "/"
    expected = {}
    paths = set()
    for row in rows:
        if not isinstance(row, dict) or not portable_path(row.get("path")) or row.get("kind") not in ("file", "directory", "symlink"):
            raise ValueError("invalid Apple ZIP inventory entry")
        name = prefix + row["path"] + ("/" if row["kind"] == "directory" else "")
        if row["path"] in paths:
            raise ValueError("duplicate Apple ZIP inventory entry")
        paths.add(row["path"])
        expected[name] = row
    with zipfile.ZipFile(path) as zipped:
        entries = zipped.infolist()
        names = [entry.filename for entry in entries]
        if len(names) != len(set(names)) or set(names) - {prefix} != set(expected):
            raise ValueError("Apple ZIP members differ from inventory")
        for entry in entries:
            mode = entry.external_attr >> 16
            if entry.flag_bits & 1:
                raise ValueError("encrypted Apple ZIP member")
            if entry.filename == prefix:
                if not entry.is_dir() or not stat.S_ISDIR(mode) or entry.file_size != 0:
                    raise ValueError("Apple ZIP root is not an empty directory entry")
                continue
            row = expected[entry.filename]
            kind = row["kind"]
            if kind == "symlink":
                target = row["target"]
                if not isinstance(target, str) or not target or target.startswith("/") or any(char in target for char in ("\\", ":", "\x00")):
                    raise ValueError("invalid Apple ZIP symlink target")
                resolved = posixpath.normpath(posixpath.join(posixpath.dirname(row["path"]), target))
                if resolved == ".." or resolved.startswith("../") or not stat.S_ISLNK(mode) \
                        or entry.file_size != len(target.encode()) or zipped.read(entry) != target.encode():
                    raise ValueError("Apple ZIP symlink differs or leaves its archive")
                continue
            if type(row["mode"]) is not int or not 0 <= row["mode"] <= 0o777 or stat.S_IMODE(mode) != row["mode"]:
                raise ValueError("Apple ZIP permissions differ")
            if kind == "directory":
                if not entry.is_dir() or not stat.S_ISDIR(mode) or entry.file_size != 0:
                    raise ValueError("Apple ZIP directory differs")
                continue
            if not stat.S_ISREG(mode) or entry.is_dir() or type(row["bytes"]) is not int or row["bytes"] < 0 \
                    or entry.file_size != row["bytes"]:
                raise ValueError("Apple ZIP regular file differs")
            digest = hashlib.sha256()
            with zipped.open(entry) as stream:
                while block := stream.read(1024 * 1024):
                    digest.update(block)
            if digest.hexdigest() != row["sha256"]:
                raise ValueError("Apple ZIP file digest differs")
    return {"members": len(entries), "inventoryEntries": len(expected)}


if __name__ == "__main__":
    try:
        if len(sys.argv) != 3:
            raise ValueError("invalid arguments")
        print(json.dumps(verify_archive_zip(Path(sys.argv[1]), json.loads(Path(sys.argv[2]).read_bytes()))))
    except Exception:
        # Archive, filesystem and JSON failures can contain producer paths or unapproved metadata.
        raise SystemExit("Apple archive ZIP does not match its inventory") from None
