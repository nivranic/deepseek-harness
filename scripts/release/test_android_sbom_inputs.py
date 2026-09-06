"""Exercise the AGP metadata reader after building the real unsigned release bundle."""

import hashlib
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import tempfile
import unittest
import warnings
import zipfile

ROOT = Path(__file__).resolve().parents[2]
ANDROID = ROOT / 'apps/android'
READER = ROOT / 'scripts/release/android-sbom.init.gradle'
BUNDLE = ANDROID / 'app/build/outputs/bundle/release/app-release.aab'
METADATA = 'BUNDLE-METADATA/com.android.tools.build.libraries/dependencies.pb'


class AndroidSbomInputs(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-android-sbom-inputs-')
        self.work = Path(self.temporary.name)
        if not self.work.resolve().is_relative_to(Path(tempfile.gettempdir()).resolve()):
            raise RuntimeError('Unexpected temporary directory')
        self.addCleanup(self.temporary.cleanup)
        self.output = self.work / 'inputs.json'

    def read_inputs(self, bundle=BUNDLE, output=None):
        environment = {key: value for key, value in os.environ.items()
                       if not re.search(r'KEY|SECRET|TOKEN|PASSWORD', key, re.I)
                       and not key.startswith('DSH_ANDROID_SIGNING_')}
        environment.update(DSH_ANDROID_SBOM_INPUT=str(bundle),
                           DSH_ANDROID_SBOM_EXPORT=str(output or self.output),
                           DSH_ANDROID_SIGNING_MODE='unsigned')
        wrapper = ANDROID / ('gradlew.bat' if os.name == 'nt' else 'gradlew')
        return subprocess.run([str(wrapper), '--offline', '--no-daemon', '-I', str(READER),
                               ':app:exportAndroidSbomInputs'], cwd=ANDROID, env=environment,
                              capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=600)

    def metadata_archive(self, payloads):
        target = self.work / 'metadata.aab'
        with warnings.catch_warnings():
            warnings.filterwarnings('ignore', message='Duplicate name:')
            with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
                for payload in payloads:
                    archive.writestr(METADATA, payload)
        return target

    def rejected(self, bundle, diagnostic, output=None):
        result = self.read_inputs(bundle, output)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(diagnostic, result.stdout + result.stderr)
        self.assertFalse(self.output.exists())

    def test_exports_actual_bundle_metadata_and_original_compiler_inputs(self):
        before = hashlib.sha256(BUNDLE.read_bytes()).hexdigest()
        result = self.read_inputs()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        data = json.loads(self.output.read_text(encoding='utf-8'))
        self.assertEqual(data['schemaVersion'], 1)
        self.assertEqual(data['inputSha256'], before)
        self.assertEqual(hashlib.sha256(BUNDLE.read_bytes()).hexdigest(), before)
        with zipfile.ZipFile(BUNDLE) as archive:
            metadata = archive.read(METADATA)
        self.assertEqual(data['metadata'], {'path': METADATA, 'size': len(metadata),
                                           'sha256': hashlib.sha256(metadata).hexdigest()})
        self.assertGreater(len(data['libraries']), 0)
        self.assertEqual([item['index'] for item in data['libraries']], list(range(len(data['libraries']))))
        self.assertEqual({item['name'] for item in data['projects']}, {'app', 'core'})
        for item in data['projects']:
            self.assertTrue(Path(item['classes']).is_dir())
        for tool in data['tools'].values():
            self.assertEqual(hashlib.sha256(Path(tool['path']).read_bytes()).hexdigest(), tool['sha256'])

    def test_rejects_absent_duplicate_and_oversized_metadata(self):
        with zipfile.ZipFile(BUNDLE) as archive:
            valid = archive.read(METADATA)
        for payloads in ([], [valid, valid], [bytes(4 * 1024 * 1024 + 1)]):
            with self.subTest(entries=len(payloads)):
                self.rejected(self.metadata_archive(payloads), 'AAB requires one bounded dependency metadata entry')

    def test_rejects_malformed_protobuf(self):
        result = self.read_inputs(self.metadata_archive([b'\xff']))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.output.exists())

    def test_bounds_actual_decompression_when_zip_size_is_forged(self):
        def field_one(payload):
            length = len(payload)
            encoded = bytearray()
            while length > 127:
                encoded.append((length & 127) | 128)
                length >>= 7
            encoded.append(length)
            return b'\x0a' + encoded + payload
        # A valid Library/MavenLibrary protobuf with an oversized group id and a false ZIP size.
        maven = field_one(b'x' * (4 * 1024 * 1024)) + b'\x12\x01n\x1a\x011'
        bundle = self.metadata_archive([field_one(field_one(maven))])
        data = bytearray(bundle.read_bytes())
        struct.pack_into('<I', data, 22, 1)
        struct.pack_into('<I', data, data.rfind(b'PK\x01\x02') + 24, 1)
        bundle.write_bytes(data)
        self.rejected(bundle, 'AAB requires one bounded dependency metadata entry')

    def test_rejects_unknown_fields_at_root_and_inside_a_library(self):
        # Protobuf field 100 is absent from AGP's schema; field 1 contains a Library message.
        for payload in (b'\xa0\x06\x01', b'\x0a\x03\xa0\x06\x01'):
            with self.subTest(payload=payload.hex()):
                self.rejected(self.metadata_archive([payload]), 'Unknown Android dependency metadata fields')

    def test_rejects_invalid_input_paths(self):
        for path in ('relative.aab', self.work / 'missing.aab', self.work):
            with self.subTest(path=str(path)):
                self.rejected(path, 'DSH_ANDROID_SBOM_INPUT must be an absolute readable file')

    def test_refuses_existing_or_relative_outputs(self):
        existing = self.work / 'existing.json'
        existing.write_bytes(b'preserve existing evidence')
        for output in (existing, Path('relative.json')):
            with self.subTest(output=str(output)):
                self.rejected(BUNDLE, 'DSH_ANDROID_SBOM_EXPORT must be a new absolute file', output)
        self.assertEqual(existing.read_bytes(), b'preserve existing evidence')


if __name__ == '__main__':
    unittest.main()
