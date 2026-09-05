"""Security evidence rejects findings, failed execution, and absent scanner reports."""

import copy
import json
from pathlib import Path
import tempfile
import unittest

from release.security_evidence import dependencies, sast


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


if __name__ == "__main__":
    unittest.main()
