"""Scan immutable Git source with Gitleaks and retain only payload-free findings."""

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile


def git(root: Path, *args: str) -> bytes:
    """Read Git data without shell expansion or forwarding subprocess diagnostics."""
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True).stdout


def sha(value: str) -> str:
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("source must be a full Git commit SHA")
    return value


def source_path(value: str) -> PurePosixPath:
    path = PurePosixPath(value.replace("\\", "/"))
    if path.is_absolute() or ".." in path.parts or not path.parts or ":" in value:
        raise ValueError("scanner source path must remain in its repository")
    return path


def parse_exceptions(value: object) -> list[dict]:
    """Validate exact reviewed lines; no path patterns or broad fixture exclusions are accepted."""
    if not isinstance(value, dict) or type(value.get("schemaVersion")) is not int or value["schemaVersion"] != 1 or set(value) != {"schemaVersion", "lines"} or not isinstance(value.get("lines"), list):
        raise ValueError("unsupported secret exception registry")
    keys = set()
    for entry in value["lines"]:
        if not isinstance(entry, dict) or set(entry) != {"path", "lineSha256", "rule", "reason"}:
            raise ValueError("invalid reviewed line entry")
        if any(not isinstance(entry[key], str) or not entry[key] for key in entry):
            raise ValueError("reviewed line fields must be non-empty strings")
        path = str(source_path(entry["path"]))
        if path != entry["path"] or any(char in path for char in "*?[") or not re.fullmatch(r"[a-f0-9]{64}", entry["lineSha256"]):
            raise ValueError("reviewed line requires an exact path and SHA-256")
        key = (path, entry["lineSha256"], entry["rule"])
        if key in keys:
            raise ValueError("duplicate reviewed line")
        keys.add(key)
    return value["lines"]


def materialize(root: Path, commit: str, directory: Path) -> int:
    """Export every Git blob; symlinks contribute their own bytes and are never followed."""
    entries = git(root, "ls-tree", "-r", "-z", sha(commit)).split(b"\0")
    if any(entry.startswith(b"160000 ") for entry in entries):
        raise ValueError("submodule source requires a separate pinned scanner input")
    expected = {}
    for entry in filter(None, entries):
        metadata, name = entry.split(b"\t", 1)
        mode, kind, digest = metadata.split()
        if kind != b"blob" or mode not in (b"100644", b"100755", b"120000"):
            raise ValueError("unsupported Git source entry")
        expected[name.decode("utf-8")] = digest.decode("ascii")
    archive = directory.parent / "source.tar"
    subprocess.run(["git", "-C", str(root), "archive", "--format=tar", f"--output={archive}", commit], check=True, capture_output=True)
    count = 0
    with tarfile.open(archive) as contents:
        for entry in contents:
            target = directory.joinpath(*source_path(entry.name).parts)
            if entry.isdir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if entry.issym():
                target.write_bytes(entry.linkname.encode("utf-8"))
            else:
                if not entry.isfile():
                    raise ValueError("unsupported Git archive member")
                stream = contents.extractfile(entry)
                if stream is None:
                    raise ValueError("Git archive blob is absent")
                target.write_bytes(stream.read())
            count += 1
    if not count or count != len(expected):
        raise ValueError("Git archive omitted candidate blobs")
    for name, digest in expected.items():
        content = directory.joinpath(*source_path(name).parts).read_bytes()
        if hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest() != digest:
            raise ValueError("Git archive changed candidate blob bytes")
    return count


def install_gitleaks(registry: dict, directory: Path) -> tuple[Path, dict]:
    """Verify the pinned archive before extracting or executing the scanner."""
    if not isinstance(registry, dict) or type(registry.get("schemaVersion")) is not int or registry["schemaVersion"] != 1:
        raise ValueError("unsupported scanner registry")
    tool = registry["gitleaks"]
    if not isinstance(tool["version"], str) or not re.fullmatch(r"\d+\.\d+\.\d+", tool["version"]):
        raise ValueError("scanner version must be pinned")
    if platform.machine().lower() not in ("amd64", "x86_64"):
        raise ValueError("Gitleaks installer requires a recorded platform")
    artifact = tool["archives"][f"{sys.platform}-x64"]
    url = artifact["url"]
    suffix, binary_name = {"linux": ("linux_x64.tar.gz", "gitleaks"), "win32": ("windows_x64.zip", "gitleaks.exe")}[sys.platform]
    expected_url = f"https://github.com/gitleaks/gitleaks/releases/download/v{tool['version']}/gitleaks_{tool['version']}_{suffix}"
    if url != expected_url or artifact["binary"] != binary_name or not re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]):
        raise ValueError("unrecorded Gitleaks download owner")
    with urllib.request.urlopen(url, timeout=60) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != artifact["sha256"]:
        raise ValueError("Gitleaks archive digest mismatch")
    downloaded = directory / "scanner.archive"
    downloaded.write_bytes(archive)
    if url.endswith(".zip"):
        with zipfile.ZipFile(downloaded) as files:
            if files.namelist().count(artifact["binary"]) != 1 or files.getinfo(artifact["binary"]).is_dir():
                raise ValueError("Gitleaks archive must contain one executable")
            binary = files.read(artifact["binary"])
    else:
        with tarfile.open(downloaded) as files:
            if files.getnames().count(artifact["binary"]) != 1:
                raise ValueError("Gitleaks archive must contain one executable")
            member = files.getmember(artifact["binary"])
            stream = files.extractfile(member) if member.isfile() else None
            if stream is None:
                raise ValueError("Gitleaks executable is absent")
            binary = stream.read()
    executable = directory / artifact["binary"]
    executable.write_bytes(binary)
    executable.chmod(0o700)
    version = subprocess.run([str(executable), "version"], check=True, capture_output=True, text=True).stdout.strip()
    if version != tool["version"]:
        raise ValueError("Gitleaks executable version mismatch")
    return executable, {"name": "gitleaks", "version": version, "archiveSha256": artifact["sha256"],
                        "binarySha256": hashlib.sha256(binary).hexdigest()}


def scan(executable: Path, arguments: list[str], directory: Path, label: str) -> list[dict]:
    """Run default rules, reject operational failure, and discard all process output."""
    report = directory / f"{label}.json"
    report.unlink(missing_ok=True)
    config = directory / "default-rules.toml"
    config.write_text("[extend]\nuseDefault = true\n", encoding="utf-8")
    result = subprocess.run([str(executable), *arguments, f"--config={config}", "--redact=100", "--no-banner",
                             "--ignore-gitleaks-allow", f"--gitleaks-ignore-path={directory / 'no-ignore'}",
                             "--report-format=json", f"--report-path={report}", "--timeout=300"],
                            capture_output=True, timeout=330)
    if result.returncode not in (0, 1) or not report.is_file():
        raise ValueError("Gitleaks did not complete its scan")
    rows = json.loads(report.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or (result.returncode == 0) != (len(rows) == 0):
        raise ValueError("Gitleaks status and findings disagree")
    return rows


def classify(root: Path, commit: str, path: str, line: str, rule: str, exceptions: list[dict]) -> str:
    """Admit only proven Git-blob fields or exact reviewed fixture/declaration lines."""
    if path.endswith(".i18n.yaml") and rule in ("generic-api-key", "cloudflare-api-key"):
        match = re.fullmatch(r"([^/:\\]+\.md): ([a-f0-9]{40})", line)
        if match:
            owner = str(PurePosixPath(path).parent / match[1])
            content = git(root, "show", f"{sha(commit)}:{owner}")
            digest = hashlib.sha1(f"blob {len(content)}\0".encode() + content).hexdigest()
            if digest == match[2]:
                return "verified-git-blob"
    digest = hashlib.sha256(line.encode("utf-8")).hexdigest()
    for entry in exceptions:
        if entry["path"] == path and entry["lineSha256"] == digest and entry["rule"] == rule:
            return "reviewed-non-secret-line"
    return "unreviewed"


def findings(root: Path, candidate: str, rows: list[dict], exceptions: list[dict], tree: Path | None = None) -> list[dict]:
    """Project findings without match text, credentials, author identity, or machine paths."""
    projected = []
    for row in rows:
        path = row["File"].replace("\\", "/")
        if tree is not None:
            path = Path(path).resolve().relative_to(tree.resolve()).as_posix()
        path = str(source_path(path))
        commit = candidate if tree is not None else sha(row["Commit"])
        if tree is None:
            git(root, "merge-base", "--is-ancestor", commit, candidate)
        line_number = row["StartLine"]
        if type(line_number) is not int or line_number < 1 or type(row["EndLine"]) is not int or row["EndLine"] < line_number or not isinstance(row["RuleID"], str) or not re.fullmatch(r"[a-z0-9-]+", row["RuleID"]):
            raise ValueError("invalid scanner finding identity")
        content = git(root, "show", f"{commit}:{path}").decode("utf-8").splitlines()
        if line_number > len(content):
            raise ValueError("finding line is outside its source")
        classification = "unreviewed"
        if row["EndLine"] == line_number:
            classification = classify(root, commit, path, content[line_number - 1], row["RuleID"], exceptions)
        projected.append({"rule": row["RuleID"], "path": path, "line": line_number, "commit": commit, "classification": classification})
    return projected


def self_test(executable: Path, directory: Path) -> None:
    """Prove the actual scanner rejects a synthetic credential even beside an allow comment."""
    fixture = directory / "negative-fixture"
    fixture.mkdir()
    token = "ghp_" + hashlib.sha256(os.urandom(32)).hexdigest()[:36]
    (fixture / "fixture.env").write_text(f"GITHUB_TOKEN={token} # gitleaks:allow\n", encoding="utf-8")
    rows = scan(executable, ["dir", str(fixture)], directory, "negative-fixture")
    if not any(row.get("RuleID") == "github-pat" for row in rows):
        raise ValueError("scanner did not reject the synthetic credential")
    if token in json.dumps(rows):
        raise ValueError("scanner report did not redact the synthetic credential")


def main() -> int:
    """Write a fresh candidate verdict; unsuccessful scans never preserve a stale PASS."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text('{"schemaVersion":1,"status":"COLLECTING"}\n', encoding="utf-8")
    stage = "source"
    try:
        candidate, base = sha(args.candidate), sha(args.base)
        root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").decode().strip())
        git(root, "merge-base", "--is-ancestor", base, candidate)
        git(root, "diff", "--quiet")
        git(root, "diff", "--cached", "--quiet")
        candidate_tree = git(root, "rev-parse", f"{candidate}^{{tree}}").decode().strip()
        if git(root, "rev-parse", "HEAD^{tree}").decode().strip() != candidate_tree:
            raise ValueError("scanner checkout differs from its candidate")
        registry_bytes = git(root, "show", f"{candidate}:.github/security/scanners.json")
        exception_bytes = git(root, "show", f"{candidate}:.github/security/secret-exceptions.json")
        registry = json.loads(registry_bytes)
        exceptions = parse_exceptions(json.loads(exception_bytes))
        with tempfile.TemporaryDirectory(prefix="dsh-scan-") as temporary:
            directory = Path(temporary)
            stage = "install"
            executable, tool = install_gitleaks(registry, directory)
            stage = "negative-fixture"
            self_test(executable, directory)
            tree = directory / "tree"
            tree.mkdir()
            stage = "export"
            count = materialize(root, candidate, tree)
            stage = "tree"
            tree_rows = findings(root, candidate, scan(executable, ["dir", str(tree)], directory, "tree"), exceptions, tree)
            stage = "changes"
            change_rows = findings(root, candidate, scan(executable, ["git", str(root), f"--log-opts=--no-merges {base}..{candidate}"], directory, "changes"), exceptions)
            scans = [{"kind": "tree", "files": count, "findings": tree_rows}, {"kind": "changes", "findings": change_rows}]
            remaining = sum(row["classification"] == "unreviewed" for scan_result in scans for row in scan_result["findings"])
            evidence = {"schemaVersion": 1, "status": "PASS" if remaining == 0 else "FAIL", "candidateSha": candidate,
                        "treeSha": candidate_tree, "baseSha": base,
                        "registrySha256": hashlib.sha256(registry_bytes).hexdigest(),
                        "exceptionsSha256": hashlib.sha256(exception_bytes).hexdigest(),
                        "scanner": tool, "scannerNegativeFixture": "PASS", "unreviewedFindings": remaining, "scans": scans}
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        return 0 if remaining == 0 else 1
    except Exception:
        # Git, HTTP, JSON, and scanner errors may carry source text or credentials.
        args.output.write_text(json.dumps({"schemaVersion": 1, "status": "FAIL", "stage": stage, "reason": "Secret scan did not complete; no acceptance was recorded"}) + "\n", encoding="utf-8")
        return 1
