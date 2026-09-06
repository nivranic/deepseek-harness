"""Security evidence rejects findings, failed execution, and absent scanner reports."""

import copy
import json
import os
from pathlib import Path
from subprocess import CalledProcessError
import tempfile
import unittest
from unittest.mock import patch

from release.secret_scan import git
from release.sast_reviews import ReviewError, parse_reviews, review_findings
from release.security_evidence import dependencies, diagnostic_source, main, sast


class SecurityEvidence(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-sast-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.document = {"version": "2.1.0", "runs": [{"tool": {"driver": {"name": "CodeQL", "semanticVersion": "2.23.9", "rules": [{"id": "py/code-injection"}]}},
                          "invocations": [{"executionSuccessful": True}], "results": []}]}

    def write(self, document):
        (self.root / "python.sarif").write_text(json.dumps(document), encoding="utf-8")

    def test_accepts_completed_scan_with_no_findings(self):
        self.write(self.document)
        result = sast(self.root, "python", self.root)
        self.assertEqual(result["findingCount"], 0)
        self.assertEqual(result["reports"][0]["version"], "2.23.9")

    def test_preserves_suppressed_findings_without_source_or_messages(self):
        result = {"ruleId": "py/code-injection", "message": {"text": "private source"}, "suppressions": [{"kind": "inSource"}],
                  "locations": [{"physicalLocation": {"artifactLocation": {"uri": "scripts/source.py"}, "region": {"startLine": 3, "snippet": {"text": "private payload"}}}}]}
        self.document["runs"][0]["results"] = [result]
        self.write(self.document)
        projected = sast(self.root, "python", self.root)
        self.assertEqual(projected["findingCount"], 1)
        self.assertNotIn("private", json.dumps(projected))
        self.assertEqual(projected["findings"][0]["locations"], [{"path": "scripts/source.py", "line": 3}])

    def test_accepts_query_rules_in_sarif_tool_extensions(self):
        run = self.document["runs"][0]
        rules = run["tool"]["driver"].pop("rules")
        run["tool"]["extensions"] = [{"name": "codeql/python-queries", "rules": rules}]
        run["results"] = [{"ruleId": "py/code-injection", "rule": {"toolComponent": {"index": 0}}}]
        self.write(self.document)
        self.assertEqual(sast(self.root, "python", self.root)["findingCount"], 1)
        run["results"][0]["rule"]["toolComponent"]["index"] = 1
        self.write(self.document)
        with self.assertRaisesRegex(ValueError, "component"):
            sast(self.root, "python", self.root)

    def test_missing_rule_diagnostics_contain_only_structural_counts(self):
        self.document["runs"][0]["tool"]["driver"]["rules"] = []
        self.write(self.document)
        with self.assertRaises(ValueError) as caught:
            sast(self.root, "python", self.root)
        self.assertEqual(caught.exception.structure, {"driverRuleCount": 0, "extensionRuleCounts": [], "resultsPresent": True, "resultCount": 0})

    def test_analysis_warnings_block_acceptance_without_hiding_findings_or_copying_messages(self):
        run = self.document["runs"][0]
        run["invocations"][0]["toolExecutionNotifications"] = [
            {"level": "warning", "descriptor": {"id": "py/extraction-warning"}, "message": {"text": "private source"}},
            {"level": "error", "descriptor": {"id": "private source text"}},
            {"level": "note", "message": {"text": "private note"}},
        ]
        run["results"] = [{"ruleId": "py/code-injection"}]
        self.write(self.document)
        result = sast(self.root, "python", self.root)
        self.assertFalse(result["analysisComplete"])
        self.assertEqual(result["findingCount"], 1)
        self.assertEqual(result["blockingDiagnostics"], [{"rule": "py/extraction-warning", "level": "warning"}, {"rule": "unclassified", "level": "error"}])
        self.assertNotIn("private", json.dumps(result))

    def test_java_diagnostics_reveal_only_existing_repository_paths(self):
        source = self.root / "Source.kt"
        source.write_text("private source fixture", encoding="utf-8")
        for message, category in [(f"Frontend errors in file: {source} (3)", "frontend-errors"),
                                  (f"Extraction incomplete in file: {source}", "extraction-incomplete"),
                                  ("Unknown errors in file: Source.kt (5)", "unknown-extraction-errors")]:
            with self.subTest(category=category):
                self.assertEqual(diagnostic_source({"message": {"text": message}}, self.root), {"category": category, "path": "Source.kt"})
        for message in [f"Frontend errors in file: {source} (private message)", "Severe error: private source",
                        "Extraction incomplete in file: ../outside.kt", "Extraction incomplete in file: absent.kt",
                        "Extraction incomplete in file: bad\0path.kt"]:
            projected = diagnostic_source({"message": {"text": message}}, self.root)
            self.assertNotIn("path", projected)
            self.assertNotIn("private", json.dumps(projected))
        self.assertEqual(diagnostic_source({}, self.root), {})

    def test_rejects_absent_empty_or_failed_analysis(self):
        with self.assertRaises(ValueError):
            sast(self.root, "python", self.root)
        for changed in ({"invocations": []}, {"invocations": [{"executionSuccessful": False}]}, {"invocations": [{"toolExecutionSuccessful": True}]},
                        {"results": None}, {"tool": {"driver": {"name": "CodeQL", "semanticVersion": "2.23.9", "rules": []}}}):
            document = copy.deepcopy(self.document)
            document["runs"][0].update(changed)
            self.write(document)
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                sast(self.root, "python", self.root)
        self.write({"version": "2.1.0", "runs": []})
        with self.assertRaises(ValueError):
            sast(self.root, "python", self.root)

    def test_dependency_outputs_cannot_default_to_empty(self):
        self.assertEqual(dependencies("[]", "[]")["findingCount"], 0)
        self.assertEqual(dependencies('[{"name":"fixture"}]', '[{"advisory":"fixture"}]')["findingCount"], 1)
        for changes, vulnerabilities in (("", "[]"), ("[]", "null"), ("{}", "[]")):
            with self.subTest(changes=changes, vulnerabilities=vulnerabilities), self.assertRaises(ValueError):
                dependencies(changes, vulnerabilities)


def review_fixture():
    return {"schemaVersion": 1, "reviews": [{
        "language": "swift", "rule": "swift/weak-password-hashing", "path": "app/Signing.swift", "line": 2,
        "reason": "Request body digest; current callers do not store passwords.",
        "materials": {"app": {"kind": "tree", "oid": "a" * 40}},
    }]}


class SastReviewParsing(unittest.TestCase):
    def test_requires_exact_schema(self):
        for value in ([], {}, {"schemaVersion": True, "reviews": []}, {"schemaVersion": 2, "reviews": []},
                      {"schemaVersion": 1, "reviews": {}}, {**review_fixture(), "allowAll": True}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_reviews(value)
        self.assertEqual(parse_reviews({"schemaVersion": 1, "reviews": []}), [])

    def test_rejects_broad_or_malformed_selectors(self):
        values = [("language", "all"), ("language", []), ("rule", "swift/*"), ("rule", 1), ("line", True), ("line", 0),
                  ("line", -1), ("line", 2.0), ("reason", " "), ("reason", None), ("path", "../Signing.swift"),
                  ("path", "/app/Signing.swift"), ("path", "C:/Signing.swift"), ("path", "app/*.swift"),
                  ("path", "app/[a].swift"), ("path", "app/?.swift"), ("path", "app//Signing.swift"),
                  ("path", "app/./Signing.swift"), ("path", "app\\Signing.swift"), ("path", "app/Signing\0.swift"),
                  ("path", ""), ("path", None)]
        for field, changed in values:
            registry = review_fixture()
            registry["reviews"][0][field] = changed
            with self.subTest(field=field, changed=changed), self.assertRaises(ValueError):
                parse_reviews(registry)
        for changed in (None, {"allowAll": True}, {**review_fixture()["reviews"][0], "extra": True}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                parse_reviews({"schemaVersion": 1, "reviews": [changed]})

    def test_requires_valid_context_covering_the_source(self):
        for material in ({}, [], {"kind": "commit", "oid": "a" * 40}, {"kind": "tree", "oid": "a" * 39},
                         {"kind": "tree", "oid": "A" * 40}, {"kind": "tree", "oid": 1},
                         {"kind": "tree", "oid": "a" * 40, "optional": True}):
            registry = review_fixture()
            registry["reviews"][0]["materials"]["app"] = material
            with self.subTest(material=material), self.assertRaises(ValueError):
                parse_reviews(registry)
        for materials in ({}, [], {"other": {"kind": "tree", "oid": "a" * 40}},
                          {"ap": {"kind": "tree", "oid": "a" * 40}},
                          {"app": {"kind": "blob", "oid": "a" * 40}},
                          {"app/*": {"kind": "tree", "oid": "a" * 40}}):
            registry = review_fixture()
            registry["reviews"][0]["materials"] = materials
            with self.subTest(materials=materials), self.assertRaises(ValueError):
                parse_reviews(registry)
        registry = review_fixture()
        registry["reviews"][0]["materials"] = {"app/Signing.swift": {"kind": "blob", "oid": "b" * 40}}
        self.assertEqual(len(parse_reviews(registry)), 1)

    def test_rejects_duplicate_exact_review(self):
        registry = review_fixture()
        registry["reviews"].append(copy.deepcopy(registry["reviews"][0]))
        with self.assertRaisesRegex(ValueError, "duplicate"):
            parse_reviews(registry)


class SastReviewCandidate(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-sast-review-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        git(self.root, "init", "-q")
        git(self.root, "config", "user.name", "Fixture")
        git(self.root, "config", "user.email", "fixture@example.invalid")
        git(self.root, "config", "commit.gpgsign", "false")
        self.write("app/Signing.swift", "import CryptoKit\nlet bodyDigest = SHA256.hash(data: body)\n")
        self.write("app/Caller.swift", "let digest = signRequest(body)\n")
        self.write("app/nested/Child.swift", "let nested = true\n")
        self.write("release/action-pins.json", json.dumps({"pins": [{"action": "github/codeql-action/analyze", "sha": "a" * 40}]}))
        self.commit()
        self.registry = review_fixture()
        self.registry["reviews"][0]["materials"]["app"]["oid"] = git(self.root, "rev-parse", "HEAD:app").decode().strip()
        self.write(".github/security/sast-reviews.json", json.dumps(self.registry))
        self.candidate = self.commit()
        self.finding = {"rule": "swift/weak-password-hashing", "locations": [{"path": "app/Signing.swift", "line": 2}]}
        self.result = {"language": "swift", "findings": [self.finding], "findingCount": 1, "analysisComplete": True, "blockingDiagnostics": []}

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def commit(self):
        git(self.root, "add", "-A")
        git(self.root, "commit", "-qm", "fixture")
        return git(self.root, "rev-parse", "HEAD").decode().strip()

    def classify(self, result=None, registry=None, candidate=None):
        return review_findings(result or self.result, parse_reviews(registry or self.registry), self.root, candidate or self.candidate)

    def test_only_exact_rule_language_and_all_locations_are_reviewed(self):
        reviewed = self.classify()
        self.assertEqual(reviewed["findingCount"], 1)
        self.assertEqual(reviewed["reviewedFindings"], 1)
        self.assertEqual(reviewed["unreviewedFindings"], 0)
        self.assertNotIn("classification", self.finding)
        for finding in ({**self.finding, "rule": "swift/other-rule"}, {**self.finding, "locations": []},
                        {**self.finding, "locations": [{"path": "app/Signing.swift", "line": None}]},
                        {**self.finding, "locations": [{"path": "app/Signing.swift", "line": 1}]},
                        {**self.finding, "locations": [{"path": "app/Caller.swift", "line": 2}]},
                        {**self.finding, "locations": [*self.finding["locations"], {"path": "app/Caller.swift", "line": 1}]}):
            with self.subTest(finding=finding):
                result = self.classify({**self.result, "findings": [self.finding, finding], "findingCount": 2})
                self.assertEqual(result["reviewedFindings"], 1)
                self.assertEqual(result["unreviewedFindings"], 1)
        self.assertEqual(self.classify({**self.result, "language": "python"})["unreviewedFindings"], 1)

    def test_immutable_tree_rejects_changed_source_and_new_callers(self):
        for path in ("app/Signing.swift", "app/NewCaller.swift"):
            with self.subTest(path=path):
                self.write(path, "new unreviewed caller or source\n")
                self.assertEqual(self.classify()["reviewedFindings"], 1)
                changed = self.commit()
                with self.assertRaisesRegex(ValueError, "context changed"):
                    self.classify(candidate=changed)

    def test_exact_blob_rejects_changed_source_and_wrong_kind(self):
        review = self.registry["reviews"][0]
        review["materials"] = {"app/Signing.swift": {"kind": "blob", "oid": git(self.root, "rev-parse", "HEAD:app/Signing.swift").decode().strip()}}
        self.assertEqual(self.classify()["reviewedFindings"], 1)
        self.write("app/Signing.swift", "changed\n")
        with self.assertRaisesRegex(ValueError, "context changed"):
            self.classify(candidate=self.commit())
        review["materials"]["app"] = {"kind": "blob", "oid": git(self.root, "rev-parse", f"{self.candidate}:app").decode().strip()}
        with self.assertRaisesRegex(ValueError, "context changed"):
            self.classify()

    def test_rejects_absent_review_source_or_line_even_without_findings(self):
        for path, line, error in (("app/absent.swift", 1, CalledProcessError), ("app/Signing.swift", 3, ReviewError),
                                  ("app/nested", 1, ReviewError)):
            registry = copy.deepcopy(self.registry)
            registry["reviews"][0].update(path=path, line=line)
            with self.subTest(path=path, line=line), self.assertRaises(error):
                self.classify({**self.result, "findings": [], "findingCount": 0}, registry)

    def test_cli_preserves_findings_and_blocks_incomplete_or_stale_reviews(self):
        with tempfile.TemporaryDirectory(prefix="dsh-sarif-") as directory:
            report = Path(directory)
            output = report / "evidence.json"
            document = {"version": "2.1.0", "runs": [{"tool": {"driver": {"name": "CodeQL", "semanticVersion": "2.26.4", "rules": [{"id": self.finding["rule"]}]}},
                "invocations": [{"executionSuccessful": True}], "results": [{"ruleId": self.finding["rule"], "suppressions": [{"kind": "inSource"}],
                "locations": [{"physicalLocation": {"artifactLocation": {"uri": "app/Signing.swift"}, "region": {"startLine": 2}}}]}]}]}
            argv = ["security-evidence.py", "sast", "--language", "swift", "--sarif", str(report), "--output", str(output)]
            with patch("sys.argv", argv), patch.dict(os.environ, {"DSH_SECURITY_CANDIDATE": self.candidate, "DSH_CODEQL_OUTCOME": "success"}), patch("release.security_evidence.Path.cwd", return_value=self.root):
                for incomplete in (False, True):
                    document["runs"][0]["invocations"][0]["toolExecutionNotifications"] = [{"level": "error", "message": {"text": "private extraction error"}}] if incomplete else []
                    (report / "swift.sarif").write_text(json.dumps(document), encoding="utf-8")
                    self.assertEqual(main(), int(incomplete))
                    evidence = json.loads(output.read_text(encoding="utf-8"))
                    self.assertEqual(evidence["status"], "FAIL" if incomplete else "PASS")
                    self.assertEqual(evidence["reviewedFindings"], 1)
                    self.assertEqual(evidence["findingCount"], 1)
                    self.assertEqual(len(evidence["reviewRegistrySha256"]), 64)
                    self.assertNotIn("private", json.dumps(evidence))
                self.write("app/Caller.swift", "changed caller\n")
                changed = self.commit()
                with patch.dict(os.environ, {"DSH_SECURITY_CANDIDATE": changed}):
                    self.assertEqual(main(), 1)
                    evidence = json.loads(output.read_text(encoding="utf-8"))
                    self.assertEqual(evidence["status"], "FAIL")
                    self.assertEqual(evidence["findingCount"], 1)
                    self.assertFalse(evidence["analysisComplete"])
                    self.assertIn("context changed", evidence["reason"])


if __name__ == "__main__":
    unittest.main()
