"""Accept completed security scans and retain source identities without source payloads."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote

from .secret_scan import git, sha, source_path


LANGUAGES = {"javascript-typescript", "python", "java-kotlin", "swift"}


def sast(directory: Path, language: str, root: Path) -> dict:
    """Reject incomplete SARIF and every finding, including suppressed findings."""
    if language not in LANGUAGES:
        raise ValueError("unsupported SAST language")
    files = sorted(directory.glob("*.sarif"))
    if not files:
        raise ValueError("CodeQL report is missing")
    reports, projected = [], []
    for file in files:
        content = file.read_bytes()
        document = json.loads(content)
        if document.get("version") != "2.1.0" or not isinstance(document.get("runs"), list) or not document["runs"]:
            raise ValueError("invalid CodeQL SARIF")
        for run in document["runs"]:
            driver = run["tool"]["driver"]
            if driver["name"] != "CodeQL" or not isinstance(driver.get("semanticVersion"), str) or not re.fullmatch(r"\d+\.\d+\.\d+", driver["semanticVersion"]):
                raise ValueError("CodeQL tool identity is absent")
            rules = driver["rules"]
            if not isinstance(rules, list) or not rules or not isinstance(run.get("results"), list):
                raise ValueError("CodeQL rules or results are missing")
            rule_ids = {rule["id"] for rule in rules}
            if any(not isinstance(rule, str) or not re.fullmatch(r"[a-zA-Z0-9/_.-]+", rule) for rule in rule_ids):
                raise ValueError("invalid CodeQL rule identity")
            invocations = run.get("invocations")
            if not isinstance(invocations, list) or not invocations or any(inv.get("executionSuccessful") is False or inv.get("toolExecutionSuccessful") is not True for inv in invocations):
                raise ValueError("CodeQL execution was not successful")
            for invocation in invocations:
                for key in ("toolExecutionNotifications", "toolConfigurationNotifications"):
                    if any(note.get("level", "warning") in ("warning", "error") for note in invocation.get(key, [])):
                        raise ValueError("CodeQL reported incomplete analysis")
            for result in run["results"]:
                if result["ruleId"] not in rule_ids:
                    raise ValueError("finding rule is not in the executed query set")
                locations = []
                for location in result.get("locations", []):
                    physical = location["physicalLocation"]
                    uri = unquote(physical["artifactLocation"]["uri"])
                    if uri.startswith("file://"):
                        uri = Path(uri[7:]).resolve().relative_to(root.resolve()).as_posix()
                    path = str(source_path(uri))
                    line = physical.get("region", {}).get("startLine")
                    if line is not None and (type(line) is not int or line < 1):
                        raise ValueError("invalid finding line")
                    locations.append({"path": path, "line": line})
                projected.append({"rule": result["ruleId"], "locations": locations})
            reports.append({"sha256": hashlib.sha256(content).hexdigest(), "version": driver["semanticVersion"], "rules": len(rules)})
    return {"scanner": "CodeQL", "language": language, "reports": reports, "findings": projected, "findingCount": len(projected)}


def dependencies(changes: str, vulnerabilities: str) -> dict:
    """Require both action outputs; absent dependency data cannot become a clean result."""
    changed, vulnerable = json.loads(changes), json.loads(vulnerabilities)
    if not isinstance(changed, list) or not isinstance(vulnerable, list):
        raise ValueError("dependency review outputs must be arrays")
    return {"scanner": "actions/dependency-review-action", "changeCount": len(changed), "findingCount": len(vulnerable),
            "changesSha256": hashlib.sha256(changes.encode()).hexdigest(), "vulnerabilitiesSha256": hashlib.sha256(vulnerabilities.encode()).hexdigest()}


def main() -> int:
    """Write FAIL on missing scanner output, operational failure, or security findings."""
    parser = argparse.ArgumentParser()
    parser.add_argument("kind", choices=("sast", "dependencies"))
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--language", choices=sorted(LANGUAGES))
    parser.add_argument("--sarif", type=Path)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    evidence = {"schemaVersion": 1, "status": "FAIL", "kind": args.kind}
    args.output.write_text(json.dumps(evidence) + "\n", encoding="utf-8")
    try:
        root = Path(git(Path.cwd(), "rev-parse", "--show-toplevel").decode().strip())
        candidate = sha(os.environ["DSH_SECURITY_CANDIDATE"])
        if git(root, "rev-parse", "HEAD").decode().strip() != candidate:
            raise ValueError("scanner source does not match candidate")
        registry = git(root, "show", f"{candidate}:release/action-pins.json")
        pins = json.loads(registry)["pins"]
        action = "github/codeql-action/analyze" if args.kind == "sast" else "actions/dependency-review-action"
        pinned = [pin for pin in pins if pin["action"] == action]
        if len(pinned) != 1:
            raise ValueError("scanner action must have one recorded revision")
        evidence.update(candidateSha=candidate, treeSha=git(root, "rev-parse", "HEAD^{tree}").decode().strip(),
                        action=action, actionSha=sha(pinned[0]["sha"]), registrySha256=hashlib.sha256(registry).hexdigest())
        if args.kind == "sast":
            if os.environ.get("DSH_CODEQL_OUTCOME") != "success" or args.sarif is None or args.language is None:
                raise ValueError("CodeQL did not complete")
            evidence.update(sast(args.sarif, args.language, root))
        else:
            if os.environ.get("DSH_DEPENDENCY_OUTCOME") != "success":
                raise ValueError("dependency review did not complete")
            evidence["baseSha"] = sha(os.environ["DSH_SECURITY_BASE"])
            evidence.update(dependencies(os.environ["DSH_DEPENDENCY_CHANGES"], os.environ["DSH_DEPENDENCY_VULNERABILITIES"]))
        evidence["status"] = "PASS" if evidence["findingCount"] == 0 else "FAIL"
    except Exception:
        # Scanner and parser exceptions can contain report excerpts.
        evidence["reason"] = "Security scan did not complete; no acceptance was recorded"
    args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    return 0 if evidence["status"] == "PASS" else 1
