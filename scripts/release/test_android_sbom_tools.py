"""Exercise explicit tool-root aliases without accepting linked artifact inputs."""

import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

from android_sbom import main
from android_sbom_inventory import sha_file


class AndroidToolRoots(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-android-tool-roots-', dir=Path(tempfile.gettempdir()).resolve())
        self.work = Path(self.temporary.name)
        self.assertEqual(self.work.resolve().parent, Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.temporary.cleanup)
        self.java_home = self.work / 'jdk'
        (self.java_home / 'bin').mkdir(parents=True)
        self.java = self.java_home / 'bin' / ('java.exe' if os.name == 'nt' else 'java')
        self.java.write_bytes(b'controlled Java executable')
        self.sdk = self.work / 'sdk'
        self.sdk.mkdir()
        self.java_alias, self.sdk_alias = self.work / 'jdk-alias', self.work / 'sdk-alias'
        self.bundle, self.mapping = self.work / 'bundle.aab', self.work / 'mapping.txt'
        self.bundle.write_bytes(b'controlled bundle')
        self.mapping.write_bytes(b'controlled mapping')

    def create_aliases(self):
        try:
            self.java_alias.symlink_to(self.java_home, target_is_directory=True)
            self.sdk_alias.symlink_to(self.sdk, target_is_directory=True)
        except OSError:
            self.skipTest('Tool-root alias creation requires host privileges')

    def test_resolves_configured_java_and_sdk_roots_before_scanner_reads(self):
        self.create_aliases()
        def inspect(bundle, mapping, java, sdk, node, work):
            # This is the same bounded regular-file admission the real scanner performs first.
            self.assertEqual(sha_file(java), sha_file(self.java))
            self.assertEqual(java, self.java.resolve())
            self.assertEqual(sdk, self.sdk.resolve())
            return {}, {}
        argv = ['android_sbom.py', '--bundle', str(self.bundle), '--mapping', str(self.mapping),
                '--output', str(self.work / 'output')]
        with patch.object(sys, 'argv', argv), patch.dict(os.environ, {'JAVA_HOME': str(self.java_alias), 'ANDROID_HOME': str(self.sdk_alias)}), \
                patch('android_sbom.shutil.which', return_value=sys.executable), \
                patch('android_sbom.scan', side_effect=inspect) as scan:
            main()
        scan.assert_called_once()

    def test_still_rejects_an_artifact_reached_through_a_link(self):
        self.create_aliases()
        alias = self.work / 'bundle-link.aab'
        alias.symlink_to(self.bundle)
        argv = ['android_sbom.py', '--bundle', str(alias), '--mapping', str(self.mapping),
                '--output', str(self.work / 'output')]
        with patch.object(sys, 'argv', argv), patch('android_sbom.scan') as scan:
            with self.assertRaisesRegex(ValueError, 'input paths must not contain links'):
                main()
        scan.assert_not_called()

    def test_rejects_relative_java_or_sdk_roots(self):
        argv = ['android_sbom.py', '--bundle', str(self.bundle), '--mapping', str(self.mapping),
                '--output', str(self.work / 'output')]
        for java_home, sdk_home in (('relative', str(self.sdk)), (str(self.java_home), 'relative')):
            with self.subTest(java=java_home, sdk=sdk_home), patch.object(sys, 'argv', argv), \
                    patch.dict(os.environ, {'JAVA_HOME': java_home, 'ANDROID_HOME': sdk_home}), patch('android_sbom.scan') as scan:
                with self.assertRaisesRegex(ValueError, 'roots must be absolute'):
                    main()
                scan.assert_not_called()


if __name__ == '__main__':
    unittest.main()
