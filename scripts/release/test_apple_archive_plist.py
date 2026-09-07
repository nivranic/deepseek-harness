"""Exercise the standard-library plist reader against actual XML/binary date values and its CLI."""
import datetime
import json
import plistlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from apple_archive_plist import archive_properties


class ArchivePlistTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-apple-plist-')
        self.addCleanup(self.temporary.cleanup)
        self.path = Path(self.temporary.name) / 'Info.plist'

    def test_reads_xml_and_binary_without_changing_non_json_dates(self):
        properties = {'ApplicationPath': 'Applications/DSH Companion.app', 'CFBundleVersion': '1.0.1'}
        for fmt in [plistlib.FMT_XML, plistlib.FMT_BINARY]:
            with self.subTest(format=fmt):
                data = plistlib.dumps({'ApplicationProperties': properties, 'CreationDate': datetime.datetime(2026, 9, 7)}, fmt=fmt)
                self.path.write_bytes(data)
                self.assertEqual(archive_properties(self.path), {'ApplicationProperties': properties})
                self.assertEqual(self.path.read_bytes(), data)
                result = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('apple_archive_plist.py')), str(self.path)],
                                        capture_output=True, text=True, check=True)
                self.assertEqual(json.loads(result.stdout), {'ApplicationProperties': properties})

    def test_rejects_missing_or_non_dictionary_application_properties(self):
        for value in [[], {}, {'ApplicationProperties': []}]:
            with self.subTest(value=value):
                self.path.write_bytes(plistlib.dumps(value))
                with self.assertRaisesRegex(ValueError, 'ApplicationProperties'):
                    archive_properties(self.path)

    def test_rejects_a_non_json_value_inside_application_properties(self):
        self.path.write_bytes(plistlib.dumps({'ApplicationProperties': {'date': datetime.datetime(2026, 9, 7)}}))
        with self.assertRaises(TypeError):
            archive_properties(self.path)

    def test_cli_rejects_invalid_input_without_echoing_its_contents(self):
        self.path.write_bytes(b'private synthetic plist contents')
        result = subprocess.run([sys.executable, '-B', str(Path(__file__).with_name('apple_archive_plist.py')), str(self.path)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, '')
        self.assertNotIn('private synthetic', result.stderr)


if __name__ == '__main__':
    unittest.main()
