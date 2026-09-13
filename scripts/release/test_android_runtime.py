"""Exercise Android runtime receipts against device mismatches and failed adb observations."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from android_runtime import main


class AndroidRuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-android-runtime-')
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / 'runtime.json'

    def invoke(self, responses):
        with patch('android_runtime.subprocess.run', side_effect=responses) as run:
            result = main(['--api-level', '36', '--page-size', '16384', '--output', str(self.output)])
        return result, json.loads(self.output.read_text(encoding='utf-8')), run

    @staticmethod
    def response(value, code=0):
        return subprocess.CompletedProcess(['adb'], code, stdout=value, stderr='untrusted device diagnostics')

    def test_records_actual_api_and_page_size_before_success(self):
        result, record, run = self.invoke([self.response('36\r\n'), self.response('16384\n')])
        self.assertEqual(result, 0)
        self.assertEqual(record['status'], 'PASS')
        self.assertEqual(record['observed'], {'apiLevel': 36, 'pageSizeBytes': 16384})
        self.assertEqual([call.args[0] for call in run.call_args_list], [
            ['adb', 'shell', 'getprop', 'ro.build.version.sdk'], ['adb', 'shell', 'getconf', 'PAGE_SIZE'],
        ])

    def test_retains_mismatched_device_values_as_failure(self):
        for api, pages in [('35', '16384'), ('36', '4096')]:
            with self.subTest(api=api, pages=pages):
                result, record, _ = self.invoke([self.response(api), self.response(pages)])
                self.assertEqual(result, 1)
                self.assertEqual(record['status'], 'FAIL')
                self.assertEqual(record['observed'], {'apiLevel': int(api), 'pageSizeBytes': int(pages)})
                self.output.unlink()

    def test_rejects_failed_ambiguous_or_non_numeric_device_queries(self):
        for response in [self.response('36', 1), self.response(''), self.response('36\n35'), self.response('device-secret'),
                         FileNotFoundError('device-secret'), subprocess.TimeoutExpired('device-secret', 30)]:
            with self.subTest(response=type(response).__name__):
                result, record, _ = self.invoke([response])
                self.assertEqual(result, 1)
                self.assertEqual(record['observed'], {})
                self.assertNotIn('device-secret', self.output.read_text())
                self.output.unlink()

    def test_preserves_a_completed_api_read_when_page_query_fails(self):
        result, record, _ = self.invoke([self.response('36'), self.response('getconf failed', 1)])
        self.assertEqual(result, 1)
        self.assertEqual(record['observed'], {'apiLevel': 36})

    def test_refuses_to_reuse_an_existing_observation(self):
        self.output.write_text('prior observation')
        with self.assertRaises(FileExistsError), patch('android_runtime.subprocess.run') as run:
            main(['--api-level', '36', '--page-size', '16384', '--output', str(self.output)])
        run.assert_not_called()
        self.assertEqual(self.output.read_text(), 'prior observation')


if __name__ == '__main__':
    unittest.main()
