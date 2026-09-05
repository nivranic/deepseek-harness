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
                          "invocations": [{"toolExecutionSuccessful": True}], "results": []}]}

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

    def test_rejects_absent_empty_or_failed_analysis(self):
        with self.assertRaises(ValueError):
            sast(self.root, "python", self.root)
        for changed in ({"invocations": []}, {"invocations": [{"toolExecutionSuccessful": False}]},
                        {"invocations": [{"toolExecutionSuccessful": True, "toolExecutionNotifications": [{"level": "warning"}]}]},
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
