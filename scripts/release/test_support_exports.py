"""Saved native support documents must satisfy the full allowlist and scan before publication."""

import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.support_exports import UNCOLLECTED, validate_export, verify_exports


class SupportExports(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-support-export-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.product = {"version": "0.1.2-alpha.1", "buildNumber": 1, "channel": "dev"}
        self.application_source = {"sourceSha": "e" * 40, "treeSha": "f" * 40}
        self.scanner = {"schemaVersion": 1, "version": "8.30.1", "archiveSha256": "a" * 64,
                        "originalBinarySha256": hashlib.sha256(b"scanner fixture").hexdigest(),
                        "binarySha256": hashlib.sha256(b"scanner fixture").hexdigest(), "licenseSha256": "c" * 64}
        self.scanner_directory = self.root / "scanner"
        self.scanner_directory.mkdir()
        (self.scanner_directory / "gitleaks").write_bytes(b"scanner fixture")
        (self.scanner_directory / "scanner.json").write_text(json.dumps(self.scanner), encoding="utf-8")
        self.attachments = self.root / "attachments"
        self.attachments.mkdir()
        self.manifest = []
        for state in ("ready", "stopped", "failed"):
            (self.attachments / (state + ".json")).write_bytes(self.bytes(state))
            test = "testInvalidHomeConfigurationDoesNotLaunchTheRuntime" if state == "failed" else "testBundledWebCarrierSurvivesStopStartAndRestart"
            self.manifest.append({"testIdentifier": f"DirectHostStartupTests/{test}()", "attachments": [{
                "suggestedHumanReadableName": f"host-runtime-support-{state}_0_fixture.json", "exportedFileName": state + ".json",
                "isAssociatedWithFailure": False}]})
        self.write_manifest()

    def write_manifest(self):
        (self.attachments / "manifest.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def value(self, state="ready"):
        events = ["stopped"] + (["invalidConfiguration"] if state == "failed" else ["starting", "ready"] if state == "ready" else [])
        runtime = {"producer": "RuntimeSupervisor", "observation": "current", "state": state, "lifecycleCounts": [{"event": event, "count": 1, "saturated": False} for event in events]}
        runtime["carrierProbe"] = {"producer": "RuntimeSupervisor.carrierProbe", "activityScope": "supervisor-lifetime",
                                   "observation": "last-known" if state == "ready" else "current",
                                   "state": "reachable" if state == "ready" else "unavailable",
                                   "attempts": 1 if state == "ready" else 0, "successes": 1 if state == "ready" else 0,
                                   "failures": 0, "countsSaturated": False}
        if state == "failed":
            runtime["failure"] = "invalidConfiguration"
        return {"schemaVersion": 1, "platform": "macos", "runtimeClass": "full", "complete": False,
                "product": self.product, "applicationSource": {"producer": "application-build", "observation": "current", **self.application_source}, "runtime": runtime, "scanner": self.scanner, "uncollected": UNCOLLECTED}

    def bytes(self, state="ready"):
        return (json.dumps(self.value(state), ensure_ascii=False) + "\n").encode("utf-8")

    def test_retains_the_exact_saved_bytes_only_after_all_scans_pass(self):
        approved = self.root / "approved"
        observed = []
        def scan(executable, arguments, directory, label):
            observed.append((Path(arguments[1]) / "export.json").read_bytes())
            self.assertFalse(approved.exists())
            return []
        with patch("release.support_exports.self_test") as canary, patch("release.support_exports.scan", side_effect=scan):
            records = verify_exports(self.attachments, self.scanner_directory, self.product, approved, self.application_source)
        canary.assert_called_once()
        self.assertEqual(len(observed), 3)
        for record in records:
            data = self.bytes(record["state"])
            self.assertIn(data, observed)
            self.assertEqual((approved / (record["state"] + ".json")).read_bytes(), data)
            self.assertEqual(record["sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(record["bytes"], len(data))
            self.assertEqual(record["findings"], 0)

    def test_rejects_private_extra_fields_and_unproven_completeness(self):
        for section in (None, "product", "applicationSource", "runtime", "scanner"):
            value = copy.deepcopy(self.value())
            (value if section is None else value[section])["private"] = "private-payload"
            with self.subTest(section=section), self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), "ready", self.product, self.scanner, self.application_source)
        for changed in ({"complete": True}, {"complete": 0}, {"schemaVersion": True}, {"uncollected": []}, {"runtimeClass": "lite"}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_export(json.dumps({**self.value(), **changed}).encode(), "ready", self.product, self.scanner, self.application_source)
        for section, field in (("product", "buildNumber"), ("scanner", "schemaVersion")):
            value = copy.deepcopy(self.value())
            value[section][field] = True
            with self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), "ready", self.product, self.scanner, self.application_source)

    def test_rejects_duplicate_keys_invalid_counts_and_missing_current_state(self):
        with self.assertRaises(ValueError):
            validate_export(b'{"schemaVersion":1,"schemaVersion":1}', "ready", self.product, self.scanner, self.application_source)
        counts = [[], [{"event": "ready", "count": 1, "saturated": False}],
                  [{"event": "stopped", "count": True, "saturated": False}],
                  [{"event": "stopped", "count": 4294967296, "saturated": True}],
                  [{"event": "stopped", "count": 1, "saturated": True}],
                  [{"event": "unknown", "count": 1, "saturated": False}]]
        counts.append(self.value()["runtime"]["lifecycleCounts"] * 2)
        for rows in counts:
            value = self.value()
            value["runtime"]["lifecycleCounts"] = rows
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), "ready", self.product, self.scanner, self.application_source)

    def test_missing_or_changed_application_source_refuses_publication_before_scanning(self):
        for field in (None, "sourceSha", "treeSha", "producer", "observation"):
            value = self.value()
            if field is None:
                del value["applicationSource"]
            else:
                value["applicationSource"][field] = "unrelated"
            (self.attachments / "ready.json").write_bytes(json.dumps(value).encode())
            with self.subTest(field=field), patch("release.support_exports.scan") as scan, self.assertRaises(ValueError):
                verify_exports(self.attachments, self.scanner_directory, self.product, self.root / "approved", self.application_source)
            scan.assert_not_called()
            self.assertFalse((self.root / "approved").exists())

    def test_accepts_a_pending_probe_after_success_and_explicit_saturated_counts(self):
        for changed in ({"state": "checking", "observation": "current", "attempts": 2},
                        {"attempts": 4294967295, "successes": 4294967295, "countsSaturated": True}):
            value = self.value()
            value["runtime"]["carrierProbe"].update(changed)
            validate_export(json.dumps(value).encode(), "ready", self.product, self.scanner, self.application_source)

    def test_carrier_admission_rejects_private_or_contradictory_observations(self):
        invalid = ({"private": "private address"}, {"producer": "invented"}, {"activityScope": "application"},
                   {"observation": "current"}, {"state": "healthy"}, {"successes": 0}, {"failures": 1},
                   {"successes": 2}, {"state": "checking", "observation": "current"},
                   {"attempts": True}, {"attempts": 1.0}, {"attempts": -1}, {"attempts": 4294967296},
                   {"countsSaturated": 0}, {"countsSaturated": True}, {"attempts": 4294967295})
        for changed in invalid:
            value = self.value()
            value["runtime"]["carrierProbe"].update(changed)
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), "ready", self.product, self.scanner, self.application_source)
        for field, changed in (("producer", "invented"), ("observation", "last-known")):
            value = self.value()
            value["runtime"][field] = changed
            with self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), "ready", self.product, self.scanner, self.application_source)

    def test_stopped_and_invalid_configuration_cases_cannot_claim_a_live_probe(self):
        for state in ("stopped", "failed"):
            value = self.value(state)
            value["runtime"]["carrierProbe"] = self.value()["runtime"]["carrierProbe"]
            with self.subTest(state=state), self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), state, self.product, self.scanner, self.application_source)
        value = self.value("failed")
        value["runtime"]["carrierProbe"]["attempts"] = 1
        with self.assertRaises(ValueError):
            validate_export(json.dumps(value).encode(), "failed", self.product, self.scanner, self.application_source)

    def test_complete_utf8_byte_limit_includes_whitespace(self):
        data = self.bytes()
        validate_export(data + b" " * (16384 - len(data)), "ready", self.product, self.scanner, self.application_source)
        with self.assertRaises(ValueError):
            validate_export(data + b" " * (16385 - len(data)), "ready", self.product, self.scanner, self.application_source)
        with self.assertRaises((ValueError, UnicodeError)):
            validate_export(data + bytes([255]), "ready", self.product, self.scanner, self.application_source)

    def test_any_finding_or_incomplete_scanner_prevents_every_approved_file(self):
        for failure in ("finding", "error", "canary"):
            approved = self.root / ("approved-" + failure)
            with self.subTest(failure=failure), patch("release.support_exports.self_test", side_effect=ValueError("fixture") if failure == "canary" else None), \
                    patch("release.support_exports.scan", side_effect=ValueError("fixture") if failure == "error" else [[], [], [{"RuleID": "github-pat"}]]):
                with self.assertRaises(ValueError):
                    verify_exports(self.attachments, self.scanner_directory, self.product, approved, self.application_source)
                self.assertFalse(approved.exists())

    def test_missing_duplicate_foreign_failed_or_escaping_attachments_are_refused(self):
        original = copy.deepcopy(self.manifest)
        for failure in ("missing", "duplicate", "foreign", "failed", "escape"):
            self.manifest = copy.deepcopy(original)
            if failure == "missing":
                self.manifest.pop()
            elif failure == "duplicate":
                self.manifest.append(copy.deepcopy(self.manifest[0]))
            elif failure == "foreign":
                self.manifest[0]["testIdentifier"] = "AnotherTest/testFixture()"
            elif failure == "failed":
                self.manifest[0]["attachments"][0]["isAssociatedWithFailure"] = True
            else:
                self.manifest[0]["attachments"][0]["exportedFileName"] = "../ready.json"
            self.write_manifest()
            with self.subTest(failure=failure), patch("release.support_exports.scan") as scanner:
                with self.assertRaises(ValueError):
                    verify_exports(self.attachments, self.scanner_directory, self.product, self.root / "approved", self.application_source)
                scanner.assert_not_called()

    def test_changed_executable_and_existing_output_are_refused(self):
        (self.scanner_directory / "gitleaks").write_bytes(b"changed")
        with self.assertRaises(ValueError):
            verify_exports(self.attachments, self.scanner_directory, self.product, self.root / "approved", self.application_source)
        approved = self.root / "approved"
        approved.mkdir()
        (approved / "user-file").write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            verify_exports(self.attachments, self.scanner_directory, self.product, approved, self.application_source)
        self.assertEqual((approved / "user-file").read_bytes(), b"preserve")


if __name__ == "__main__":
    unittest.main()
