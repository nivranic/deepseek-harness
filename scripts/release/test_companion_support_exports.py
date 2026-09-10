"""Saved Companion diagnostics must match the native scenario before any independent scan can admit them."""

import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.companion_support_exports import TEST, TITLE, validate_export, verify_exports


class CompanionSupportExportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.data = (Path(__file__).resolve().parents[2] / "apps/apple/Tests/CompanionUITests/Fixtures/support-unpaired.json").read_bytes()
        value = json.loads(self.data)
        self.product = value["application"]
        self.library = value["scanner"]
        self.scanner_directory = self.root / "scanner"
        self.scanner_directory.mkdir()
        (self.scanner_directory / "gitleaks").write_bytes(b"test scanner executable")
        self.scanner = {"version": self.library["scannerVersion"],
                        "binarySha256": hashlib.sha256(b"test scanner executable").hexdigest()}
        (self.scanner_directory / "scanner.json").write_text(json.dumps(self.scanner), encoding="utf-8")
        self.attachments = self.root / "attachments"
        self.attachments.mkdir()
        (self.attachments / "saved.json").write_bytes(self.data)
        self.manifest = [{"testIdentifier": TEST, "attachments": [{"suggestedHumanReadableName": TITLE + "_0_fixture.json",
                          "exportedFileName": "saved.json", "isAssociatedWithFailure": False}]}]
        self.write_manifest()

    def write_manifest(self):
        (self.attachments / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def verify(self, approved):
        return verify_exports(self.attachments, self.scanner_directory, self.product, self.library, approved)

    def test_scans_and_preserves_exact_swift_fixture_bytes(self):
        approved = self.root / "approved"
        def scan(executable, arguments, directory, label):
            self.assertEqual((Path(arguments[1]) / "export.json").read_bytes(), self.data)
            self.assertFalse(approved.exists())
            return []
        with patch("release.companion_support_exports.self_test") as canary, patch("release.companion_support_exports.scan", side_effect=scan):
            record = self.verify(approved)
        canary.assert_called_once()
        self.assertEqual((approved / (TITLE + ".json")).read_bytes(), self.data)
        self.assertEqual(record, {"platform": "macos", "scenario": "unpaired", "bytes": len(self.data),
                                 "sha256": hashlib.sha256(self.data).hexdigest(), "findings": 0})

    def test_private_fields_and_false_completeness_are_refused(self):
        for section in (None, "application", "scanner", "link", "connections"):
            value = json.loads(self.data)
            (value if section is None else value[section])["private"] = "payload"
            with self.subTest(section=section), self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), self.product, self.library)

        for change in ({"complete": True}, {"complete": 0}, {"schemaVersion": True}, {"uncollected": []}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_export(json.dumps({**json.loads(self.data), **change}).encode(), self.product, self.library)
        for section, key in (("application", "buildNumber"), ("scanner", "schemaVersion")):
            value = json.loads(self.data)
            value[section][key] = True
            with self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), self.product, self.library)

    def test_unpaired_admission_rejects_invented_connection_owners_and_observations(self):
        for key in ("sessionFollow", "interactions", "workspaces", "pushes"):
            for field, changed in (("producer", "another"), ("observation", "current"),
                                   ("activityScope", "host-lifetime"), ("snapshot", {"state": "open"})):
                value = json.loads(self.data)
                value["connections"][key][field] = changed
                with self.subTest(key=key, field=field), self.assertRaises(ValueError):
                    validate_export(json.dumps(value).encode(), self.product, self.library)

    def test_different_product_scanner_and_link_observations_are_refused(self):
        for section, key, new in (("application", "version", "another"), ("scanner", "sourceSha", "f" * 40),
                                  ("scanner", "rulesDigest", "e" * 64), ("link", "state", "observed")):
            value = json.loads(self.data)
            value[section][key] = new
            with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), self.product, self.library)

    def test_full_utf8_size_and_duplicate_keys_are_checked(self):
        validate_export(self.data + b" " * (16384 - len(self.data)), self.product, self.library)
        for data in (self.data + b" " * 16384, self.data + bytes([255]), b'{"kind":"companion-support","kind":"companion-support"}', b'[]'):
            with self.subTest(dataLength=len(data)), self.assertRaises((ValueError, UnicodeError)):
                validate_export(data, self.product, self.library)

    def test_no_bytes_are_published_on_findings_scan_errors_or_failed_canary(self):
        for failure in ("finding", "scan", "canary"):
            approved = self.root / failure
            with self.subTest(failure=failure), \
                    patch("release.companion_support_exports.self_test", side_effect=ValueError("failed") if failure == "canary" else None), \
                    patch("release.companion_support_exports.scan", side_effect=ValueError("failed") if failure == "scan" else None, return_value=[{"RuleID": "finding"}]):
                with self.assertRaises(ValueError):
                    self.verify(approved)
                self.assertFalse(approved.exists())

    def test_missing_duplicate_foreign_failed_and_escaping_attachments_are_refused(self):
        original = copy.deepcopy(self.manifest)
        for failure in ("missing", "duplicate", "foreign", "failed", "escape"):
            self.manifest = copy.deepcopy(original)
            if failure == "missing":
                self.manifest.clear()
            elif failure == "duplicate":
                self.manifest.append(copy.deepcopy(original[0]))
            elif failure == "foreign":
                self.manifest[0]["testIdentifier"] = "AnotherTest/testFixture()"
            elif failure == "failed":
                self.manifest[0]["attachments"][0]["isAssociatedWithFailure"] = True
            else:
                self.manifest[0]["attachments"][0]["exportedFileName"] = "../saved.json"
            self.write_manifest()
            with self.subTest(failure=failure), patch("release.companion_support_exports.scan") as scan, self.assertRaises(ValueError):
                self.verify(self.root / "approved")
            scan.assert_not_called()

    def test_changed_scanner_and_existing_user_output_are_preserved_and_refused(self):
        (self.scanner_directory / "gitleaks").write_bytes(b"changed scanner")
        with self.assertRaises(ValueError):
            self.verify(self.root / "approved")
        approved = self.root / "existing"
        approved.mkdir()
        (approved / "user-file").write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            self.verify(approved)
        self.assertEqual((approved / "user-file").read_bytes(), b"preserve")

    def test_symlinked_attachment_is_not_read(self):
        target = self.attachments / "saved.json"
        target.unlink()
        outside = self.root / "outside.json"
        outside.write_bytes(self.data)
        target.symlink_to(outside)
        with patch("release.companion_support_exports.scan") as scan, self.assertRaises(ValueError):
            self.verify(self.root / "approved")
        scan.assert_not_called()


if __name__ == "__main__":
    unittest.main()
