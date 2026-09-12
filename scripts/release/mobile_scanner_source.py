"""Build an unpublished Go module from exact committed scanner files."""

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import zipfile


MODULE = "github.com/nivranic/deepseek-harness/native/support-scanner"
SOURCE_DIRECTORY = "native/support-scanner/"


@dataclass(frozen=True)
class SourceFile:
    """One regular Git blob and its destination inside the Go module."""

    source_path: str
    module_path: str
    data: bytes


@dataclass(frozen=True)
class ScannerSource:
    """Immutable compiler inputs identified by a commit and Go pseudo-version."""

    commit: str
    tree: str
    version: str
    committed_at: str
    files: tuple[SourceFile, ...]

    def receipt(self) -> dict:
        """Describe source bytes without including checkout or cache paths."""
        return {
            "sourceSha": self.commit,
            "treeSha": self.tree,
            "module": MODULE,
            "moduleVersion": self.version,
            "files": [{"sourcePath": item.source_path, "modulePath": item.module_path,
                       "sha256": hashlib.sha256(item.data).hexdigest(), "bytes": len(item.data)}
                      for item in self.files],
        }


def _git(repository: Path, *arguments: str) -> bytes:
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-C", str(repository), *arguments],
                                   stderr=subprocess.PIPE)


def read_source(repository: Path, commit: str) -> ScannerSource:
    """Read only regular blobs from the named full commit, ignoring working files."""
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise ValueError("Scanner source requires a full lowercase commit SHA")
    if _git(repository, "rev-parse", commit + "^{commit}").decode().strip() != commit:
        raise ValueError("Scanner source must name a commit")
    tree = _git(repository, "rev-parse", commit + "^{tree}").decode().strip()
    timestamp = datetime.fromisoformat(_git(repository, "show", "-s", "--format=%cI", commit).decode().strip())
    timestamp = timestamp.astimezone(timezone.utc)
    version = "v0.0.0-" + timestamp.strftime("%Y%m%d%H%M%S") + "-" + commit[:12]
    entries = _git(repository, "ls-tree", "-r", "-z", commit, "--", SOURCE_DIRECTORY).split(b"\0")
    files = []
    for entry in filter(None, entries):
        header, raw_path = entry.split(b"\t", 1)
        mode, kind, object_id = header.decode().split()
        path = raw_path.decode("utf-8")
        if mode not in ("100644", "100755") or kind != "blob":
            raise ValueError("Scanner module source must contain only regular Git files")
        relative = path.removeprefix(SOURCE_DIRECTORY)
        if relative == path or "\\" in relative or PurePosixPath(relative).is_absolute() or ".." in PurePosixPath(relative).parts:
            raise ValueError("Scanner module contains an invalid relative path")
        files.append(SourceFile(path, relative, _git(repository, "cat-file", "blob", object_id)))
    names = {item.module_path for item in files}
    if not {"go.mod", "go.sum", "scanner.go"}.issubset(names):
        raise ValueError("Scanner source is missing required module files")
    if "LICENSE" in names:
        raise ValueError("Scanner source must inherit the repository license exactly once")
    license_entry = _git(repository, "ls-tree", "-z", commit, "--", "LICENSE").rstrip(b"\0")
    license_header, license_path = license_entry.split(b"\t", 1)
    mode, kind, object_id = license_header.decode().split()
    if mode not in ("100644", "100755") or kind != "blob" or license_path != b"LICENSE":
        raise ValueError("Scanner source requires a regular repository license")
    license_bytes = _git(repository, "cat-file", "blob", object_id)
    if not license_bytes.strip():
        raise ValueError("Scanner repository license must not be empty")
    files.append(SourceFile("LICENSE", "LICENSE", license_bytes))
    return ScannerSource(commit, tree, version, timestamp.isoformat().replace("+00:00", "Z"),
                         tuple(sorted(files, key=lambda item: item.module_path)))


def write_proxy(source: ScannerSource, directory: Path) -> dict:
    """Create a deterministic local Go proxy for one unpublished source version."""
    if directory.exists() or directory.is_symlink():
        raise ValueError("Scanner module proxy directory must be new")
    destination = directory / MODULE / "@v"
    destination.mkdir(parents=True)
    archive = destination / (source.version + ".zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_STORED) as output:
        for item in source.files:
            entry = zipfile.ZipInfo(MODULE + "@" + source.version + "/" + item.module_path, (1980, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            output.writestr(entry, item.data)
    module_file = next(item.data for item in source.files if item.module_path == "go.mod")
    (destination / (source.version + ".mod")).write_bytes(module_file)
    (destination / (source.version + ".info")).write_text(
        json.dumps({"Version": source.version, "Time": source.committed_at}, separators=(",", ":")) + "\n",
        encoding="utf-8", newline="\n")
    (destination / "list").write_text(source.version + "\n", encoding="utf-8", newline="\n")
    return {**source.receipt(), "sourceArchiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest()}


def verify_materialized_source(source: ScannerSource, directory: Path) -> None:
    """Require downloaded local-module files to match the committed bytes exactly."""
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError("Scanner module directory must be regular")
    paths = []
    for path in directory.rglob("*"):
        if path.is_symlink():
            raise ValueError("Scanner module cache must not contain links")
        if path.is_file():
            paths.append(path.relative_to(directory).as_posix())
        elif not path.is_dir():
            raise ValueError("Scanner module cache contains a non-regular entry")
    if set(paths) != {item.module_path for item in source.files}:
        raise ValueError("Scanner module cache file inventory differs from the committed source")
    for item in source.files:
        if (directory / item.module_path).read_bytes() != item.data:
            raise ValueError("Scanner module cache bytes differ from the committed source")
