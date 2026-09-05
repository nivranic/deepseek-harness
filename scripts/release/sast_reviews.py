"""Match reviewed non-issues to exact findings and immutable source context."""

import re
from pathlib import Path

from .secret_scan import git, sha, source_path


class ReviewError(ValueError):
    """A fixed review-policy diagnostic without source or scanner message text."""


def _path(value: object) -> str:
    if not isinstance(value, str) or any(ord(char) < 32 or char in "*?[" for char in value):
        raise ReviewError("SAST reviews require exact repository paths")
    try:
        normalized = str(source_path(value))
    except ValueError:
        raise ReviewError("SAST reviews require exact repository paths") from None
    if normalized != value:
        raise ReviewError("SAST reviews require exact repository paths")
    return value


def parse_reviews(value: object) -> list[dict]:
    """Reject broad selectors, duplicate findings, and context that does not cover the finding."""
    if not isinstance(value, dict) or set(value) != {"schemaVersion", "reviews"} or type(value["schemaVersion"]) is not int or value["schemaVersion"] != 1 or not isinstance(value["reviews"], list):
        raise ReviewError("invalid SAST review registry")
    seen = set()
    for review in value["reviews"]:
        if not isinstance(review, dict) or set(review) != {"language", "rule", "path", "line", "reason", "materials"}:
            raise ReviewError("invalid SAST review fields")
        if review["language"] not in ("javascript-typescript", "python", "java-kotlin", "swift") or not isinstance(review["rule"], str) or not re.fullmatch(r"[a-zA-Z0-9/_.-]+", review["rule"]):
            raise ReviewError("invalid SAST review language or rule")
        path = _path(review["path"])
        if type(review["line"]) is not int or review["line"] < 1 or not isinstance(review["reason"], str) or not review["reason"].strip():
            raise ReviewError("SAST review requires a line and rationale")
        materials = review["materials"]
        if not isinstance(materials, dict) or not materials:
            raise ReviewError("SAST review requires pinned source context")
        covered = False
        for name, material in materials.items():
            _path(name)
            if not isinstance(material, dict) or set(material) != {"kind", "oid"} or material["kind"] not in ("blob", "tree") or not isinstance(material["oid"], str) or not re.fullmatch(r"[a-f0-9]{40}", material["oid"]):
                raise ReviewError("SAST review materials require a Git blob or tree identity")
            covered |= (material["kind"] == "blob" and name == path) or (material["kind"] == "tree" and path.startswith(name + "/"))
        if not covered:
            raise ReviewError("SAST review context does not cover its finding source")
        key = (review["language"], review["rule"], path, review["line"])
        if key in seen:
            raise ReviewError("duplicate SAST review selector")
        seen.add(key)
    return value["reviews"]


def review_findings(result: dict, reviews: list[dict], root: Path, candidate: str) -> dict:
    """Keep every finding visible; only exact reviewed locations reduce the unresolved count."""
    accepted = set()
    checked = {}
    source_lines = {}
    commit = sha(candidate)
    for review in reviews:
        if review["language"] != result["language"]:
            continue
        for path, material in review["materials"].items():
            if path not in checked:
                subject = f"{commit}:{path}"
                checked[path] = {"kind": git(root, "cat-file", "-t", subject).decode().strip(), "oid": git(root, "rev-parse", subject).decode().strip()}
            if checked[path] != material:
                raise ReviewError("SAST review source context changed; review it again")
        source = review["path"]
        if source not in source_lines:
            subject = f"{commit}:{source}"
            if git(root, "cat-file", "-t", subject).strip() != b"blob":
                raise ReviewError("SAST review source must be a file")
            source_lines[source] = len(git(root, "show", subject).splitlines())
        if review["line"] > source_lines[source]:
            raise ReviewError("SAST review line is absent from candidate source")
        accepted.add((review["rule"], review["path"], review["line"]))
    findings = []
    for finding in result["findings"]:
        reviewed = bool(finding["locations"]) and all((finding["rule"], location["path"], location["line"]) in accepted for location in finding["locations"])
        findings.append({**finding, "classification": "reviewed-nonissue" if reviewed else "unreviewed"})
    unresolved = sum(finding["classification"] == "unreviewed" for finding in findings)
    return {**result, "findings": findings, "unreviewedFindings": unresolved, "reviewedFindings": len(findings) - unresolved}
