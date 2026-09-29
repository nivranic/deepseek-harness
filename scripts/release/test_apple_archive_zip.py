"""Require every encoded member, including metadata invisible to a macOS round trip, to be inventoried."""

import copy
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
import warnings
import zipfile

from apple_archive_zip import verify_archive_zip


class AppleArchiveZipTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.path = self.root / "archive.zip"
        self.prefix = "Fixture.xcarchive/"
        self.data = b"binary-fixture"
        self.inventory = {"schemaVersion": 1, "sourceSha": "a" * 40, "archive": "Fixture.xcarchive", "files": [
            {"path": "Products", "kind": "directory", "mode": 0o755},
            {"path": "Products/app", "kind": "file", "mode": 0o755, "bytes": len(self.data), "sha256": hashlib.sha256(self.data).hexdigest()},
            {"path": "Products/current", "kind": "symlink", "target": "app"},
        ]}
        self.entries = {self.prefix: (b"", stat.S_IFDIR | 0o755),
                        self.prefix + "Products/": (b"", stat.S_IFDIR | 0o755),
                        self.prefix + "Products/app": (self.data, stat.S_IFREG | 0o755),
                        self.prefix + "Products/current": (b"app", stat.S_IFLNK | 0o777)}

    def write(self, entries=None, duplicate=False):
        with zipfile.ZipFile(self.path, "w") as zipped:
            values = list((self.entries if entries is None else entries).items())
            if duplicate:
                values.append(values[-1])
            for name, (data, mode) in values:
                item = zipfile.ZipInfo(name)
                item.create_system = 3
                item.external_attr = mode << 16
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    zipped.writestr(item, data)

    def test_regular_bytes_directory_modes_and_internal_links_match_without_extraction(self):
        self.write()
        self.assertEqual(verify_archive_zip(self.path, self.inventory), {"members": 4, "inventoryEntries": 3})
        self.assertFalse((self.root / "Fixture.xcarchive").exists())
        entries = dict(self.entries)
        del entries[self.prefix]
        self.write(entries)
        self.assertEqual(verify_archive_zip(self.path, self.inventory), {"members": 3, "inventoryEntries": 3})

    def test_appledouble_and_any_other_unlisted_member_are_refused(self):
        for extra in ("._Products", "unowned.bin", "../outside"):
            entries = {**self.entries, self.prefix + extra: (b"unlisted bytes", stat.S_IFREG | 0o644)}
            self.write(entries)
            with self.subTest(extra=extra), self.assertRaisesRegex(ValueError, "members differ"):
                verify_archive_zip(self.path, self.inventory)

    def test_missing_and_duplicate_members_are_refused(self):
        entries = dict(self.entries)
        del entries[self.prefix + "Products/app"]
        self.write(entries)
        with self.assertRaises(ValueError):
            verify_archive_zip(self.path, self.inventory)
        self.write(duplicate=True)
        with self.assertRaises(ValueError):
            verify_archive_zip(self.path, self.inventory)

    def test_changed_bytes_sizes_permissions_and_file_kinds_are_refused(self):
        for content, mode in ((b"Binary-fixture", stat.S_IFREG | 0o755), (b"short", stat.S_IFREG | 0o755),
                              (self.data, stat.S_IFREG | 0o644), (self.data, stat.S_IFLNK | 0o755),
                              (self.data, stat.S_IFIFO | 0o755)):
            entries = {**self.entries, self.prefix + "Products/app": (content, mode)}
            self.write(entries)
            with self.subTest(mode=mode, size=len(content)), self.assertRaises(ValueError):
                verify_archive_zip(self.path, self.inventory)

    def test_links_cannot_change_values_or_escape_even_when_the_inventory_agrees(self):
        for target in (b"other", b"../../outside", b"/outside", b"C:\\outside"):
            entries = {**self.entries, self.prefix + "Products/current": (target, stat.S_IFLNK | 0o777)}
            inventory = copy.deepcopy(self.inventory)
            if target != b"other":
                inventory["files"][2]["target"] = target.decode()
            self.write(entries)
            with self.subTest(target=target), self.assertRaises(ValueError):
                verify_archive_zip(self.path, inventory)

    def test_directory_entries_cannot_carry_bytes_or_regular_file_modes(self):
        for name in (self.prefix, self.prefix + "Products/"):
            for content, mode in ((b"hidden", stat.S_IFDIR | 0o755), (b"", stat.S_IFREG | 0o755)):
                self.write({**self.entries, name: (content, mode)})
                with self.subTest(name=name, mode=mode), self.assertRaises(ValueError):
                    verify_archive_zip(self.path, self.inventory)

    def test_noncanonical_duplicate_and_incomplete_inventory_entries_are_refused(self):
        self.write()
        for name in ("../outside", "/absolute", "Products/./app", "Products//app", "Products\\app", "C:app"):
            inventory = copy.deepcopy(self.inventory)
            inventory["files"][1]["path"] = name
            with self.subTest(name=name), self.assertRaises(ValueError):
                verify_archive_zip(self.path, inventory)
        for change in ({"files": []}, {"archive": "../Fixture.xcarchive"},
                       {"files": self.inventory["files"] + [self.inventory["files"][0]]}):
            with self.assertRaises(ValueError):
                verify_archive_zip(self.path, {**self.inventory, **change})

    def test_encrypted_flag_is_refused_before_reading_any_payload(self):
        self.write()
        data = bytearray(self.path.read_bytes())
        offset = data.index(b"PK\x01\x02")
        data[offset + 8] |= 1
        self.path.write_bytes(data)
        with self.assertRaisesRegex(ValueError, "encrypted"):
            verify_archive_zip(self.path, self.inventory)

    def test_cli_refusal_has_no_input_paths_or_metadata_text(self):
        self.write({**self.entries, self.prefix + "._Products": (b"PRIVATE_METADATA", stat.S_IFREG | 0o644)})
        inventory = self.root / "inventory.json"
        inventory.write_text(json.dumps(self.inventory), encoding="utf-8")
        result = subprocess.run([sys.executable, "-B", str(Path(__file__).with_name("apple_archive_zip.py")),
                                 str(self.path), str(inventory)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, "")
        self.assertEqual(result.stderr.strip(), "Apple archive ZIP does not match its inventory")


if __name__ == "__main__":
    unittest.main()
