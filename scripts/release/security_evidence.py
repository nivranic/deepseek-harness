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


class EvidenceError(ValueError):
    """A fixed diagnostic that contains no scanner-provided text."""

    def __init__(self, message: str, structure: dict | None = None):
        super().__init__(message)
        self.structure = structure


def sast(directory: Path, language: str, root: Path) -> dict:
    """Reject incomplete SARIF and every finding, including suppressed findings."""
    if language not in LANGUAGES:
        raise EvidenceError("unsupported SAST language")
    files = sorted(directory.glob("*.sarif"))
    if not files:
        raise EvidenceError("CodeQL report is missing")
    reports, projected, diagnostics = [], [], []
    for file in files:
        content = file.read_bytes()
        document = json.loads(content)
        if document.get("version") != "2.1.0" or not isinstance(document.get("runs"), list) or not document["runs"]:
            raise EvidenceError("invalid CodeQL SARIF")
        for run in document["runs"]:
            driver = run["tool"]["driver"]
            if driver["name"] != "CodeQL" or not isinstance(driver.get("semanticVersion"), str) or not re.fullmatch(r"\d+\.\d+\.\d+", driver["semanticVersion"]):
                raise EvidenceError("CodeQL tool identity is absent")
            extensions = run["tool"].get("extensions", [])
            if not isinstance(extensions, list):
                raise EvidenceError("invalid CodeQL tool components")
            components = [driver, *extensions]
            rule_sets = [component.get("rules", []) for component in components]
            structure = {"driverRuleCount": len(rule_sets[0]) if isinstance(rule_sets[0], list) else None,
                         "extensionRuleCounts": [len(rules) if isinstance(rules, list) else None for rules in rule_sets[1:]],
                         "resultsPresent": "results" in run,
                         "resultCount": len(run["results"]) if isinstance(run.get("results"), list) else None}
            if any(not isinstance(rules, list) for rules in rule_sets) or not any(rule_sets) or not isinstance(run.get("results"), list):
                raise EvidenceError("CodeQL rules or results are missing", structure)
            rules = [rule for rules in rule_sets for rule in rules]
            rule_ids = {rule["id"] for rule in rules}
            if any(not isinstance(rule, str) or not re.fullmatch(r"[a-zA-Z0-9/_.-]+", rule) for rule in rule_ids):
                raise EvidenceError("invalid CodeQL rule identity")
            invocations = run.get("invocations")
            if not isinstance(invocations, list) or not invocations or any(inv.get("executionSuccessful") is not True for inv in invocations):
                raise EvidenceError("CodeQL execution was not successful")
            for invocation in invocations:
                for key in ("toolExecutionNotifications", "toolConfigurationNotifications"):
                    for note in invocation.get(key, []):
                        level = note.get("level", "warning")
                        if level in ("warning", "error"):
                            descriptor = note.get("descriptor", {}).get("id")
                            identifier = descriptor if isinstance(descriptor, str) and re.fullmatch(r"[a-zA-Z0-9/_.-]+", descriptor) else "unclassified"
                            diagnostics.append({"rule": identifier, "level": level})
            for result in run["results"]:
                if result["ruleId"] not in rule_ids:
                    raise EvidenceError("finding rule is not in the executed query set")
                reference = result.get("rule", {})
                component = reference.get("toolComponent")
                if component is not None:
                    index = component.get("index")
                    if type(index) is not int or index < 0 or index >= len(extensions) or result["ruleId"] not in {rule["id"] for rule in rule_sets[index + 1]}:
                        raise EvidenceError("finding rule component is inconsistent")
                locations = []
                for location in result.get("locations", []):
                    physical = location["physicalLocation"]
                    uri = unquote(physical["artifactLocation"]["uri"])
                    if uri.startswith("file://"):
                        uri = Path(uri[7:]).resolve().relative_to(root.resolve()).as_posix()
                    path = str(source_path(uri))
                    line = physical.get("region", {}).get("startLine")
                    if line is not None and (type(line) is not int or line < 1):
                        raise EvidenceError("invalid finding line")
                    locations.append({"path": path, "line": line})
                projected.append({"rule": result["ruleId"], "locations": locations})
            reports.append({"sha256": hashlib.sha256(content).hexdigest(), "version": driver["semanticVersion"], "rules": len(rules), "structure": structure})
    return {"scanner": "CodeQL", "language": language, "reports": reports, "findings": projected, "findingCount": len(projected),
            "analysisComplete": len(diagnostics) == 0, "blockingDiagnostics": diagnostics}


def dependencies(changes: str, vulnerabilities: str) -> dict:
    """Require both action outputs; absent dependency data cannot become a clean result."""
    changed, vulnerable = json.loads(changes), json.loads(vulnerabilities)
    if not isinstance(changed, list) or not isinstance(vulnerable, list):
        raise EvidenceError("dependency review outputs must be arrays")
    return {"scanner": "actions/dependency-review-action", "changeCount": len(changed), "findingCount": len(vulnerable), "analysisComplete": True,
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
            raise EvidenceError("scanner source does not match candidate")
        git(root, "diff", "--quiet")
        git(root, "diff", "--cached", "--quiet")
        registry = git(root, "show", f"{candidate}:release/action-pins.json")
        pins = json.loads(registry)["pins"]
        action = "github/codeql-action/analyze" if args.kind == "sast" else "actions/dependency-review-action"
        pinned = [pin for pin in pins if pin["action"] == action]
        if len(pinned) != 1:
            raise EvidenceError("scanner action must have one recorded revision")
        evidence.update(candidateSha=candidate, treeSha=git(root, "rev-parse", "HEAD^{tree}").decode().strip(),
                        action=action, actionSha=sha(pinned[0]["sha"]), registrySha256=hashlib.sha256(registry).hexdigest())
        if args.kind == "sast":
            if os.environ.get("DSH_CODEQL_OUTCOME") != "success" or args.sarif is None or args.language is None:
                raise EvidenceError("CodeQL did not complete")
            evidence.update(sast(args.sarif, args.language, root))
        else:
            if os.environ.get("DSH_DEPENDENCY_OUTCOME") != "success":
                raise EvidenceError("dependency review did not complete")
            evidence["baseSha"] = sha(os.environ["DSH_SECURITY_BASE"])
            evidence.update(dependencies(os.environ["DSH_DEPENDENCY_CHANGES"], os.environ["DSH_DEPENDENCY_VULNERABILITIES"]))
        evidence["status"] = "PASS" if evidence["findingCount"] == 0 and evidence["analysisComplete"] else "FAIL"
    except EvidenceError as error:
        evidence["reason"] = str(error)
        if error.structure is not None:
            evidence["sarifStructure"] = error.structure
    except Exception:
        # Scanner and parser exceptions can contain report excerpts.
        evidence["reason"] = "Security scan did not complete; no acceptance was recorded"
    args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    return 0 if evidence["status"] == "PASS" else 1
