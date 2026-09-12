"""Exercise producer sequencing with synthetic tools; no emulator or signing process is launched."""
import copy
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import android_candidate as producer
from android_sbom_inventory import InventoryError, sha_file


class CandidateProducerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-candidate-unit-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.output = self.root / 'android'
        self.output.mkdir()
        for name in ('app.aab', 'mapping.txt'):
            (self.output / name).write_bytes(name.encode())
        self.request = {'sourceSha': 'a' * 40, 'identity': {'version': '0.1.0', 'buildNumber': 1, 'channel': 'dev'}}

    def test_request_rejects_malformed_process_input_and_source_mismatch(self):
        producer.validate_request(self.request, 'a' * 40)
        for value in (None, {}, {**self.request, 'extra': True}, {**self.request, 'sourceSha': 'b' * 40}):
            with self.subTest(value=value), self.assertRaises(InventoryError):
                producer.validate_request(value, 'a' * 40)
        for key, value in [('buildNumber', True), ('buildNumber', 0), ('buildNumber', 65536), ('channel', 'production'), ('version', None)]:
            request = copy.deepcopy(self.request)
            request['identity'][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(InventoryError):
                producer.validate_request(request, 'a' * 40)

    def test_persistent_host_is_rejected_before_git_tools_or_device_operations(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS': 'false'}), patch.object(producer, 'run') as run:
            with self.assertRaisesRegex(InventoryError, 'disposable'):
                producer.produce(self.output, self.request, self.root)
            run.assert_not_called()

    def test_preconditions_reject_before_resolving_tools(self):
        for status, signing, output in [(b' M source', {}, self.output), (b'', {'DSH_ANDROID_SIGNING_STORE': 'synthetic'}, self.output),
                                        (b'', {'DSH_ANDROID_SIGNING_MODE': 'release'}, self.output), (b'', {}, self.root)]:
            with self.subTest(status=status, signing=signing, output=output), patch.object(producer, 'require_disposable_host'), \
                    patch.dict(os.environ, signing, clear=True), patch.object(producer, 'run', side_effect=[b'a' * 40, status]), \
                    patch.object(producer, 'tools_from_environment') as tools:
                with self.assertRaises(InventoryError):
                    producer.produce(output, self.request, self.root)
                tools.assert_not_called()

    def test_tool_errors_hide_process_diagnostics_and_signing_inputs(self):
        for result in (subprocess.CompletedProcess([], 1, b'', b'synthetic secret'), subprocess.TimeoutExpired('synthetic secret', 1), OSError('synthetic secret')):
            options = {'side_effect': result} if isinstance(result, Exception) else {'return_value': result}
            with self.subTest(result=type(result).__name__), patch.object(producer.subprocess, 'run', **options):
                with self.assertRaisesRegex(InventoryError, '^tool stage failed$'):
                    producer.run(['synthetic tool'], 'tool stage')

    def exercise(self, failure=None, cleanup_failure=False):
        tools = {}
        for name in ('java', 'keytool', 'aapt2', 'apksigner', 'zipalign', 'apkanalyzer', 'adb', 'readelf'):
            path = self.root / name
            path.write_bytes(name.encode())
            tools[name] = path
        stage = []
        certificate = self.output / 'debug-certificate.der'

        def run(arguments, label, environment=None, timeout=120):
            stage.append(label)
            if failure == label:
                raise InventoryError(label + ' failed')
            if label == 'Candidate source lookup':
                return b'a' * 40
            if label == 'Android test certificate export':
                certificate.write_bytes(b'synthetic public certificate')
            if label == 'Android candidate APK generation':
                self.assertTrue(Path(environment['DSH_ANDROID_RC_STORE']).parent.exists())
                password_file = Path(environment['DSH_ANDROID_RC_PASSWORD_FILE'])
                self.assertTrue(password_file.is_file())
                if os.name == 'posix':
                    self.assertEqual(password_file.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(password_file.parent.stat().st_mode & 0o777, 0o700)
                Path(environment['DSH_ANDROID_RC_APKS']).write_bytes(b'synthetic set')
                Path(environment['DSH_ANDROID_RC_CLASSPATH_RECEIPT']).write_text('[]')
            if label == 'Android candidate inventory':
                directory = self.output / 'inventory'
                directory.mkdir()
                for name in ('inventory.json', 'sbom.cdx.json'):
                    (directory / name).write_text('{}')
            return b''

        def extract(_apks, apk):
            self.assertFalse(list(self.root.glob('dsh-android-rc-*/private-*')))
            apk.write_bytes(b'synthetic apk')

        def startup(apk, _manifest, output):
            self.assertIn('Android candidate inventory', stage)
            for name in ('startup.xml', 'startup.png', 'installed-base.apk'):
                (output / name).write_bytes(apk.read_bytes())
            if failure == 'mutation':
                (output / 'mapping.txt').write_bytes(b'changed')
            return {'apkSha256': sha_file(apk)}

        original = tempfile.TemporaryDirectory

        class CleanupFailure(original):
            def __exit__(self, *args):
                super().__exit__(*args)
                if Path(self.name).name.startswith('dsh-android-rc-'):
                    raise OSError('synthetic scratch cleanup failure')

        with patch.object(producer, 'require_disposable_host'), patch.dict(os.environ, {}, clear=True), \
                patch.object(producer, 'run', side_effect=run), patch.object(producer, 'tools_from_environment', return_value=(tools, '35.0.0')), \
                patch.object(producer, 'extract_universal_apk', side_effect=extract), patch.object(producer, 'verify_payload_identity', return_value={}), \
                patch.object(producer, 'certificate_identity', side_effect=lambda *_: sha_file(certificate)), \
                patch.object(producer, 'manifest_identity', return_value={}), patch.object(producer, 'native_alignment', return_value=[]), \
                patch.object(producer, 'CandidateDevice') as device, \
                patch.object(producer.tempfile, 'TemporaryDirectory', CleanupFailure if cleanup_failure else original):
            device.return_value.startup.side_effect = startup
            producer.produce(self.output, self.request, self.root)

    def test_observations_bind_retained_bytes_after_private_and_scratch_cleanup(self):
        self.exercise()
        self.assertFalse(list(self.root.glob('dsh-android-rc-*')))
        value = json.loads((self.output / 'observations.json').read_text())
        self.assertEqual(value['status'], 'PASS')
        self.assertEqual(value['sourceSha'], self.request['sourceSha'])
        for name, digest in value['evidenceSha256'].items():
            self.assertEqual(digest, sha_file(self.output / name))

    def test_incomplete_signing_does_not_write_pass_and_removes_private_inputs(self):
        with self.assertRaisesRegex(InventoryError, 'APK generation failed'):
            self.exercise(failure='Android candidate APK generation')
        self.assertFalse((self.output / 'observations.json').exists())
        self.assertFalse(list(self.root.glob('dsh-android-rc-*')))

    def test_artifact_mutation_prevents_observations(self):
        with self.assertRaisesRegex(InventoryError, 'changed during production'):
            self.exercise(failure='mutation')
        self.assertFalse((self.output / 'observations.json').exists())

    def test_failed_final_scratch_cleanup_prevents_pass(self):
        with self.assertRaisesRegex(OSError, 'scratch cleanup failure'):
            self.exercise(cleanup_failure=True)
        self.assertFalse((self.output / 'observations.json').exists())


if __name__ == '__main__':
    unittest.main()
