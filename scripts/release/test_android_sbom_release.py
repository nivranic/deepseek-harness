"""Verify the complete scanner against the current real release build, including R8 checksum rejection."""

import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from android_sbom import ROOT, json_bytes, read_json
from android_sbom_inventory import sha_file
from android_sbom_payload import tool_environment

BUNDLE = ROOT / 'apps/android/app/build/outputs/bundle/release/app-release.aab'
MAPPING = ROOT / 'apps/android/app/build/outputs/mapping/release/mapping.txt'


class AndroidReleaseInventory(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-android-release-sbom-', dir=Path(tempfile.gettempdir()).resolve())
        self.work = Path(self.temporary.name)
        self.assertEqual(self.work.resolve().parent, Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.temporary.cleanup)

    def cli(self, mode, output, mapping=MAPPING):
        return subprocess.run([sys.executable, '-B', str(ROOT / 'scripts/release/android_sbom.py'),
                               '--bundle', str(BUNDLE), '--mapping', str(mapping), mode, str(output)],
                              cwd=ROOT, env=tool_environment(), capture_output=True, text=True,
                              encoding='utf-8', errors='replace', timeout=900)

    def test_generates_schema_valid_actual_inventory_and_reverifies_every_record(self):
        before = (sha_file(BUNDLE), sha_file(MAPPING))
        output = self.work / 'evidence'
        result = self.cli('--output', output)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = read_json(output / 'inventory.json')
        bom = read_json(output / 'sbom.cdx.json')
        self.assertEqual(receipt['bundle']['sha256'], before[0])
        self.assertEqual(receipt['payload']['mappingSha256'], before[1])
        self.assertEqual(receipt['sbom']['sha256'], sha_file(output / 'sbom.cdx.json'))
        self.assertEqual(len(bom['components']), len(receipt['graph']['libraries']) + len(receipt['payload']['files']) + 2)
        self.assertGreater(receipt['payload']['dexClassCount'], 0)
        self.assertGreater(len(receipt['payload']['native']), 0)
        self.assertEqual(receipt['tools']['cycloneDx']['name'], '@cyclonedx/cyclonedx-library')
        self.assertNotIn(str(ROOT), json.dumps(receipt))
        self.assertNotIn(str(self.work), json.dumps(receipt))
        result = self.cli('--verify', output)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        result = self.cli('--output', output)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('must be new', result.stderr)
        changed = copy.deepcopy(receipt)
        changed['payload']['files'].pop()
        (output / 'inventory.json').write_bytes(json_bytes(changed))
        result = self.cli('--verify', output)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('differs from the fresh inventory', result.stderr)
        self.assertEqual((sha_file(BUNDLE), sha_file(MAPPING)), before)

    def test_official_r8_rejects_changed_mapping_before_output_publication(self):
        mapping = self.work / 'changed-mapping.txt'
        mapping.write_bytes(MAPPING.read_bytes() + b'\n# modified mapping\n')
        output = self.work / 'rejected'
        result = self.cli('--output', output, mapping)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('R8 mapping checksum verification failed', result.stderr)
        self.assertFalse(output.exists())


if __name__ == '__main__':
    unittest.main()
