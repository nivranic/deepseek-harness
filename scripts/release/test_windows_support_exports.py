"""Independent Windows saved-byte admission rejects private fields and unsuccessful scans."""

import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.windows_support_exports import COUNTERS, UNCOLLECTED, main, validate_export, verify_export


class WindowsSupportExports(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="dsh-windows-support-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.product = {"version": "0.1.2-alpha.1", "buildNumber": 1, "channel": "dev"}
        self.scanner = {"schemaVersion": 1, "version": "8.30.1", "archiveSha256": "a" * 64,
                        "originalBinarySha256": hashlib.sha256(b"scanner").hexdigest(),
                        "binarySha256": hashlib.sha256(b"scanner").hexdigest(), "licenseSha256": hashlib.sha256(b"license").hexdigest()}
        self.scanner_directory = self.root / "scanner"
        self.scanner_directory.mkdir()
        (self.scanner_directory / "gitleaks.exe").write_bytes(b"scanner")
        (self.scanner_directory / "LICENSE").write_bytes(b"license")
        self.source = self.root / "saved.json"
        self.approved = self.root / "approved.json"
        self.source.write_bytes(self.encode(self.value()))

    def value(self):
        return {"schemaVersion": 1, "platform": "windows", "runtimeClass": "full", "complete": False,
                "product": {"producer": "application-package", "freshness": "current", "value": copy.deepcopy(self.product)},
                "scanner": copy.deepcopy(self.scanner), "uncollected": UNCOLLECTED.copy(),
                "diagnostics": {"producer": "desktop-support", "freshness": "current", "scope": "since-plugin-start",
                                "counts": dict.fromkeys(COUNTERS, 0), "saturated": False},
                "link": {"producer": "link-access", "freshness": "current", "value": {
                    "listenerState": "stopped", "linkProtocolVersion": 1, "contractVersion": 1, "sessionFormatVersion": 0,
                    "runtimeClass": "full", "allowRemoteApproval": False, "capabilities": {
                        "session": dict.fromkeys(("list", "history", "follow", "prompt", "cancel"), True),
                        "workspace": {"follow": True}, "interaction": {"approval": False, "question": False}}}}}

    def encode(self, value):
        return (json.dumps(value, indent=2) + "\n").encode("utf-8")

    def verify(self):
        return verify_export(self.source, self.scanner_directory, self.product, self.scanner, self.approved)

    def test_publishes_only_exact_saved_bytes_after_zero_findings(self):
        data = self.source.read_bytes()
        def scan(executable, arguments, scratch, label):
            self.assertEqual(executable, self.scanner_directory / "gitleaks.exe")
            self.assertEqual((Path(arguments[1]) / "export.json").read_bytes(), data)
            self.assertFalse(self.approved.exists())
            return []
        with patch("release.windows_support_exports.self_test") as canary, patch("release.windows_support_exports.scan", side_effect=scan):
            receipt = self.verify()
        canary.assert_called_once()
        self.assertEqual(self.approved.read_bytes(), data)
        self.assertEqual(receipt, {"schemaVersion": 1, "status": "PASS", "completeSupportBundle": False,
                                   "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "findings": 0})

    def test_refuses_unknown_fields_at_every_nested_level(self):
        paths = [(), ("product",), ("product", "value"), ("scanner",), ("diagnostics",), ("diagnostics", "counts"),
                 ("link",), ("link", "value"), ("link", "value", "capabilities")]
        paths.extend(("link", "value", "capabilities", key) for key in ("session", "workspace", "interaction"))
        for path in paths:
            value = self.value()
            selected = value
            for key in path:
                selected = selected[key]
            selected["private"] = "must-not-export"
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate_export(self.encode(value), self.product, self.scanner)

    def test_refuses_missing_producers_and_contradictory_fresh_application_facts(self):
        changes = [((), "complete", True), ((), "schemaVersion", True), ((), "uncollected", []), ((), "platform", "macos"),
                   (("product", "value"), "buildNumber", True), (("product",), "freshness", "unavailable"),
                   (("scanner",), "schemaVersion", True), (("diagnostics",), "saturated", 0),
                   (("diagnostics",), "scope", "all-time"), (("diagnostics", "counts"), "toolCalls", 1),
                   (("diagnostics", "counts"), "toolResults", False), (("link",), "freshness", "failed"),
                   (("link", "value"), "listenerState", "listening"), (("link", "value"), "runtimeClass", "lite"),
                   (("link", "value"), "allowRemoteApproval", True), (("link", "value"), "contractVersion", True),
                   (("link", "value", "capabilities", "session"), "list", 1)]
        for path, field, replacement in changes:
            value = self.value()
            selected = value
            for key in path:
                selected = selected[key]
            selected[field] = replacement
            with self.subTest(path=path, field=field), self.assertRaises(ValueError):
                validate_export(self.encode(value), self.product, self.scanner)

    def test_refuses_duplicate_keys_malformed_json_and_complete_byte_overflow(self):
        data = self.source.read_bytes()
        validate_export(data + b" " * (1024 * 1024 - len(data)), self.product, self.scanner)
        for invalid in (b"", b"null", b"{", b'{"schemaVersion":1,"schemaVersion":1}', data + bytes([255]), data + b" " * 1024 * 1024):
            with self.assertRaises((ValueError, UnicodeError)):
                validate_export(invalid, self.product, self.scanner)

    def test_finding_or_scanner_failure_never_publishes_a_file(self):
        for failure in ("finding", "canary", "scan", "binary", "license"):
            with self.subTest(failure=failure), patch("release.windows_support_exports.self_test",
                    side_effect=ValueError("private native text") if failure == "canary" else None), \
                    patch("release.windows_support_exports.scan", side_effect=ValueError("private scanner text") if failure == "scan" else [{"RuleID": "github-pat"}]):
                if failure in ("binary", "license"):
                    (self.scanner_directory / ("gitleaks.exe" if failure == "binary" else "LICENSE")).write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    self.verify()
                self.assertFalse(self.approved.exists())
                (self.scanner_directory / "gitleaks.exe").write_bytes(b"scanner")
                (self.scanner_directory / "LICENSE").write_bytes(b"license")

    def test_cli_rejects_invalid_input_without_retaining_payload_in_receipt(self):
        identity = self.root / "identity.json"
        identity.write_text(json.dumps({"product": self.product, "scanner": self.scanner}), encoding="utf-8")
        receipt = self.root / "receipt.json"
        self.source.write_text('{"private":"must-not-retain"}', encoding="utf-8")
        argv = ["verify", "--input", str(self.source), "--scanner-directory", str(self.scanner_directory),
                "--identity", str(identity), "--approved", str(self.approved), "--output", str(receipt)]
        with patch.object(sys, "argv", argv):
            self.assertEqual(main(), 1)
        self.assertFalse(self.approved.exists())
        self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), {
            "schemaVersion": 1, "status": "FAIL", "reason": "Windows support export was not accepted"})


if __name__ == "__main__":
    unittest.main()
