"""Reject false unpaired observations, foreign scanner bytes, failed admission and incomplete cleanup."""

import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from android_support_exports import collect_export, scanner_identity, validate_export, verify


class Device:
    def __init__(self, data, path):
        self.data, self.path = data, path
        self.present = False
        self.reads = 0
        self.changed = self.fail_cleanup = False

    def shell(self, arguments):
        if arguments[0] == "find":
            return (self.path + "\n").encode() if self.present else b""
        if arguments[0] == "head":
            self.reads += 1
            return self.data + b" " if self.changed and self.reads > 1 else self.data
        if arguments[0] == "rm":
            if self.fail_cleanup:
                raise ValueError("cleanup failed")
            self.present = False
            return b""
        raise AssertionError("Unexpected device command")


class Ui:
    def __init__(self, device):
        self.device = device
        self.cancel_creates = False
        self.events = []

    def open_picker(self, filename):
        self.events.append("open")
        return filename

    def cancel(self):
        self.events.append("cancel")
        self.device.present = self.cancel_creates

    def save(self, root):
        self.events.append("save")
        self.device.present = True

    def screenshot(self, name):
        self.events.append(name + " screenshot")


class AndroidSupportExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.data = (Path(__file__).resolve().parents[2] / "apps/android/core/src/test/resources/support-unpaired-app.json").read_bytes()
        value = json.loads(self.data)
        self.product, self.identity = value["product"], value["scanner"]
        self.filename = "dsh-support-" + "a" * 32 + ".json"
        self.device = Device(self.data, "/sdcard/Download/" + self.filename)
        self.ui = Ui(self.device)

    def collect(self):
        return collect_export(self.device, self.ui, self.filename, self.product, self.identity, self.root / "scanner", self.root)

    def test_accepts_the_kotlin_model_owned_unpaired_fixture(self):
        validate_export(self.data, self.product, self.identity)

    def test_rejects_private_fields_at_every_section(self):
        for section in (None, "product", "localIdentity", "transport", "connections", "role", "protocol", "capabilities", "scanner"):
            value = json.loads(self.data)
            (value if section is None else value[section])["private"] = "payload"
            with self.subTest(section=section), self.assertRaises(ValueError):
                validate_export(json.dumps(value).encode(), self.product, self.identity)

    def test_rejects_false_model_observations_and_numeric_boolean_aliases(self):
        for owner in ("sessionFollow", "interactions", "workspaces", "pushes"):
            for field, changed in (("producer", "invented"), ("observation", "unavailable"), ("activityScope", "client-lifetime")):
                value = json.loads(self.data); value["connections"][owner][field] = changed
                with self.subTest(owner=owner, field=field), self.assertRaises(ValueError):
                    validate_export(json.dumps(value).encode(), self.product, self.identity)
            for field, changed in (("state", "open"), ("attempts", False), ("attempts", 0.0), ("interruptions", 1), ("countsSaturated", 0)):
                value = json.loads(self.data); value["connections"][owner]["snapshot"][field] = changed
                with self.subTest(owner=owner, field=field), self.assertRaises(ValueError):
                    validate_export(json.dumps(value).encode(), self.product, self.identity)
        for changed in ({"schemaVersion": True}, {"complete": 0}, {"complete": True}, {"uncollected": []}):
            with self.assertRaises(ValueError):
                validate_export(json.dumps({**json.loads(self.data), **changed}).encode(), self.product, self.identity)

    def test_rejects_duplicate_keys_oversized_utf8_and_changed_identity(self):
        for data in (b"", b" " * 16385, b'\xff', self.data.replace(b'"schemaVersion":1', b'"schemaVersion":1,"schemaVersion":1'),
                     self.data + (' ' * 16384).encode(), self.data.replace(b'"buildNumber":1', b'"buildNumber":true')):
            with self.assertRaises((ValueError, UnicodeError)):
                validate_export(data, self.product, self.identity)
        identity = {**self.identity, "rulesDigest": "d" * 64}
        with self.assertRaises(ValueError):
            validate_export(self.data, self.product, identity)

    def test_cancel_then_save_scans_actual_bytes_and_joins_cleanup(self):
        def scan(executable, arguments, directory, label):
            self.assertEqual((Path(arguments[1]) / "export.json").read_bytes(), self.data)
            self.assertTrue(self.device.present)
            return []
        with patch("android_support_exports.self_test") as canary, patch("android_support_exports.scan", side_effect=scan):
            self.assertEqual(self.collect(), self.data)
        canary.assert_called_once()
        self.assertEqual(self.ui.events, ["open", "cancel", "cancelled screenshot", "open", "save", "saved screenshot"])
        self.assertEqual(self.device.reads, 2)
        self.assertFalse(self.device.present)

    def test_preexisting_destination_is_never_removed_or_overwritten(self):
        self.device.present = True
        with self.assertRaises(ValueError):
            self.collect()
        self.assertTrue(self.device.present)
        self.assertEqual(self.ui.events, [])

    def test_cancellation_cannot_create_a_file(self):
        self.ui.cancel_creates = True
        with self.assertRaises(ValueError):
            self.collect()
        self.assertNotIn("save", self.ui.events)
        self.assertFalse(self.device.present)

    def test_scan_findings_errors_canary_failure_and_changed_bytes_refuse_delivery(self):
        for failure in ("findings", "scan-error", "canary-error", "changed"):
            self.setUp()
            self.device.changed = failure == "changed"
            with patch("android_support_exports.self_test", side_effect=ValueError("canary") if failure == "canary-error" else None), \
                    patch("android_support_exports.scan", return_value=[{}] if failure == "findings" else [],
                          side_effect=ValueError("scan") if failure == "scan-error" else None), \
                    self.subTest(failure=failure), self.assertRaises(ValueError):
                self.collect()
            self.assertFalse(self.device.present)
            self.assertNotIn("saved screenshot", self.ui.events)

    def test_cleanup_failure_cannot_return_admitted_bytes(self):
        self.device.fail_cleanup = True
        with patch("android_support_exports.self_test"), patch("android_support_exports.scan", return_value=[]), self.assertRaises(ValueError):
            self.collect()

    def test_requires_disposable_host_before_any_device_or_scanner_operation(self):
        with patch("android_support_exports.sys.platform", "win32"), patch("android_support_exports.CandidateDevice") as device, \
                patch("android_support_exports.install_gitleaks") as scanner, self.assertRaises(ValueError):
            verify(self.root / "app.apk", "b" * 40, self.root)
        device.assert_not_called(); scanner.assert_not_called()

    def test_scanner_identity_requires_exact_apk_source_and_native_bytes(self):
        apk = self.root / "app.apk"
        library = b"fixture JNI bytes"
        native_sha = hashlib.sha256(library).hexdigest()
        manifest = {"source": {"sourceSha": "b" * 40}, "libraries": [{"abi": "x86_64", "bytes": len(library), "sha256": native_sha}]}
        with zipfile.ZipFile(apk, "w") as archive:
            archive.writestr("assets/dsh-support-scanner/manifest.json", json.dumps(manifest))
            archive.writestr("lib/x86_64/libgojni.so", library)
        identity = {**self.identity, "nativeSha256": native_sha}
        proof = {"schemaVersion": 1, "apkSha256": hashlib.sha256(apk.read_bytes()).hexdigest(), "scanner": identity}
        registry = {"gitleaks": {"version": identity["version"]}}
        self.assertEqual(scanner_identity(apk, proof, "b" * 40, "x86_64", registry), identity)
        for field, value in (("sourceSha", "c" * 40), ("nativeSha256", "c" * 64), ("rulesDigest", "private"), ("version", "0.0.1")):
            changed = copy.deepcopy(proof); changed["scanner"][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                scanner_identity(apk, changed, "b" * 40, "x86_64", registry)
        with self.assertRaises(ValueError):
            scanner_identity(apk, {**proof, "apkSha256": "a" * 64}, "b" * 40, "x86_64", registry)
