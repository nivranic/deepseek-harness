"""Simulator export evidence must come from the local Files provider and retain the exact scanned bytes."""

import hashlib
import json
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.ios_support_exports import FILENAME, PROVIDER, collect, document_at_destination, local_files, read_regular


class IosSupportExportTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.simulator = self.root / "simulator"
        self.groups = self.simulator / "Containers/Shared/AppGroup"
        self.group = self.groups / "local-files"
        self.storage = self.group / "File Provider Storage"
        self.storage.mkdir(parents=True)
        self.metadata = self.group / ".com.apple.mobile_container_manager.metadata.plist"
        self.metadata.write_bytes(plistlib.dumps({"MCMMetadataIdentifier": PROVIDER}))
        self.data = (Path(__file__).resolve().parents[2] / "apps/apple/Tests/CompanionUITests/Fixtures/support-unpaired.json").read_bytes()
        value = json.loads(self.data)
        self.product, self.library = value["application"], value["scanner"]
        self.source = self.library["sourceSha"]
        self.output = self.root / "evidence"

    def phase(self, phase):
        return collect(self.simulator, self.output, phase, self.source, self.product, self.library, self.root / "scanner")

    def test_cancellation_then_actual_saved_bytes_are_independently_scanned(self):
        self.assertIsNone(document_at_destination(self.simulator))
        cancelled = self.phase("cancelled")
        self.assertFalse(cancelled["destinationFileExists"])
        file = self.storage / FILENAME
        file.write_bytes(self.data)
        def scan(data, scanner, library):
            self.assertEqual(data, self.data)
            self.assertEqual(library, self.library)
            self.assertFalse((self.output / "approved.json").exists())
        with patch("release.ios_support_exports.scan_saved_document", side_effect=scan) as scanner:
            record = self.phase("saved")
        scanner.assert_called_once()
        self.assertEqual((self.output / "approved.json").read_bytes(), file.read_bytes())
        self.assertEqual(record["bytes"], len(self.data))
        self.assertEqual(record["sha256"], hashlib.sha256(self.data).hexdigest())
        self.assertFalse(record["completeSupportBundle"])

    def test_temporary_export_and_other_provider_files_cannot_prove_a_save(self):
        self.phase("cancelled")
        other = self.groups / "other"
        other.mkdir()
        (other / ".com.apple.mobile_container_manager.metadata.plist").write_bytes(plistlib.dumps({"MCMMetadataIdentifier": "another-provider"}))
        (other / FILENAME).write_bytes(self.data)
        (self.simulator / FILENAME).write_bytes(self.data)
        self.assertIsNone(document_at_destination(self.simulator))
        with self.assertRaises(ValueError):
            self.phase("saved")

    def test_missing_duplicate_and_invalid_container_metadata_are_refused(self):
        self.metadata.unlink()
        with self.assertRaises(ValueError):
            local_files(self.simulator)
        self.metadata.write_bytes(plistlib.dumps({"MCMMetadataIdentifier": PROVIDER}))
        duplicate = self.groups / "duplicate"
        duplicate.mkdir()
        (duplicate / self.metadata.name).write_bytes(self.metadata.read_bytes())
        with self.assertRaises(ValueError):
            local_files(self.simulator)
        (duplicate / self.metadata.name).write_bytes(b"invalid plist")
        with self.assertRaises(plistlib.InvalidFileException):
            local_files(self.simulator)

    def test_cancelled_destination_and_existing_user_evidence_are_not_overwritten(self):
        file = self.storage / FILENAME
        file.write_bytes(self.data)
        with self.assertRaises(ValueError):
            self.phase("cancelled")
        self.assertFalse(self.output.exists())
        file.unlink()
        self.output.mkdir()
        (self.output / "user-file").write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            self.phase("cancelled")
        self.assertEqual((self.output / "user-file").read_bytes(), b"preserve")

    def test_missing_or_foreign_cancellation_receipt_refuses_saved_files(self):
        (self.storage / FILENAME).write_bytes(self.data)
        with self.assertRaises(ValueError):
            self.phase("saved")
        (self.storage / FILENAME).unlink()
        self.phase("cancelled")
        receipt = self.output / "cancelled.json"
        value = json.loads(receipt.read_bytes())
        value["sourceSha"] = "f" * 40
        receipt.write_text(json.dumps(value), encoding="utf-8")
        (self.storage / FILENAME).write_bytes(self.data)
        with self.assertRaises(ValueError):
            self.phase("saved")

    def test_oversized_poisoned_and_scanner_rejected_files_never_publish(self):
        self.phase("cancelled")
        file = self.storage / FILENAME
        for data in (self.data + b" " * 16384, b'{"private":"unexpected"}'):
            file.write_bytes(data)
            with self.assertRaises(ValueError):
                self.phase("saved")
            self.assertFalse((self.output / "approved.json").exists())
        file.write_bytes(self.data)
        with patch("release.ios_support_exports.scan_saved_document", side_effect=ValueError("scan refused")), self.assertRaises(ValueError):
            self.phase("saved")
        self.assertFalse((self.output / "approved.json").exists())

    def test_cancellation_receipt_requires_exact_types_and_unique_json_keys(self):
        self.phase("cancelled")
        (self.storage / FILENAME).write_bytes(self.data)
        file = self.output / "cancelled.json"
        original = file.read_text(encoding="utf-8")
        invalid = [original.replace('"schemaVersion": 1', '"schemaVersion": true'),
                   original.replace('"schemaVersion": 1', '"schemaVersion": 1, "schemaVersion": 1')]
        for data in invalid:
            file.write_text(data, encoding="utf-8")
            with self.assertRaises(ValueError):
                self.phase("saved")
            self.assertFalse((self.output / "approved.json").exists())

    def test_saved_file_mutation_during_scan_is_refused(self):
        self.phase("cancelled")
        file = self.storage / FILENAME
        file.write_bytes(self.data)
        with patch("release.ios_support_exports.scan_saved_document", side_effect=lambda *_: file.write_bytes(b"changed")), self.assertRaises(ValueError):
            self.phase("saved")
        self.assertFalse((self.output / "approved.json").exists())

    def test_symlinks_and_special_files_cannot_supply_saved_bytes(self):
        outside = self.root / "outside"
        outside.write_bytes(self.data)
        file = self.storage / FILENAME
        file.symlink_to(outside)
        with self.assertRaises(ValueError):
            document_at_destination(self.simulator)
        with self.assertRaises(ValueError):
            read_regular(self.storage, 16384)
        file.unlink()
        self.storage.rmdir()
        self.storage.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            local_files(self.simulator)

    def test_invalid_phase_source_and_in_simulator_output_are_refused(self):
        with self.assertRaises(ValueError):
            self.phase("unknown")
        self.source = "f" * 40
        with self.assertRaises(ValueError):
            self.phase("cancelled")
        self.source = self.library["sourceSha"]
        self.output = self.simulator / "evidence"
        with self.assertRaises(ValueError):
            self.phase("cancelled")


if __name__ == "__main__":
    unittest.main()
