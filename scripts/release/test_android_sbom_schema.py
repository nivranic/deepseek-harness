"""Exercise the shipped CycloneDX schema entry point with valid and invalid documents."""

import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from android_sbom import ROOT
from android_sbom_payload import tool_environment


class AndroidSbomSchema(unittest.TestCase):
    def test_accepts_16_and_rejects_old_versions_invalid_components_and_hashes(self):
        temporary_root = Path(tempfile.gettempdir()).resolve()
        with tempfile.TemporaryDirectory(prefix='dsh-android-schema-', dir=temporary_root) as directory:
            work = Path(directory)
            self.assertEqual(work.resolve().parent, temporary_root)
            target = work / 'sbom.json'
            valid = {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'version': 1,
                     'components': [{'type': 'file', 'name': 'base/resource'}]}
            for value, accepted in ((valid, True), ({**valid, 'specVersion': '1.5'}, False),
                                    ({**valid, 'components': [{'type': 'unsupported', 'name': 'bad'}]}, False),
                                    ({**valid, 'components': [{'type': 'file', 'name': 'bad',
                                                               'hashes': [{'alg': 'SHA-256', 'content': 'wrong'}]}]}, False)):
                target.write_text(json.dumps(value), encoding='utf-8')
                result = subprocess.run([shutil.which('node'), str(ROOT / 'scripts/release/android-sbom-schema.mjs'), str(target)],
                                        capture_output=True, text=True, env=tool_environment(), timeout=120)
                with self.subTest(value=value):
                    self.assertEqual(result.returncode == 0, accepted, result.stderr)
                    if accepted:
                        identity = json.loads(result.stdout)
                        self.assertEqual(identity['name'], '@cyclonedx/cyclonedx-library')
                        self.assertRegex(identity['distributionSha256'], r'^[0-9a-f]{64}$')


if __name__ == '__main__':
    unittest.main()
