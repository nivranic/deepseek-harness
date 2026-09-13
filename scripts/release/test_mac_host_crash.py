"""Check native crash projections and reject stale, unsafe and malformed report inputs."""
import json
import os
from pathlib import Path
import tempfile
import unittest

from mac_host_crash import collect, summarize


class MacCrashEvidenceTests(unittest.TestCase):
    def report(self):
        return {'procName': 'DSH Host', 'bundleInfo': {'CFBundleIdentifier': 'com.deepseek-harness.host.mac'},
                'procPath': '/private/process', 'environment': {'KEY': 'PRIVATE_SENTINEL'},
                'exception': {'type': 'EXC_CRASH', 'signal': 'SIGABRT', 'message': 'PRIVATE_SENTINEL'},
                'termination': {'namespace': 'SIGNAL', 'code': 6, 'reason': 'PRIVATE_SENTINEL'},
                'faultingThread': 0, 'threads': [{'frames': [{'symbol': 'RuntimeSupervisor.restart()', 'imageIndex': 1,
                    'imageOffset': 123, 'symbolLocation': 4, 'source': '/private/source.swift'},
                    {'symbol': '/private/PRIVATE_SENTINEL', 'imageIndex': 1}]}]}

    def test_retains_machine_failure_fields_without_paths_or_exception_messages(self):
        result = summarize(json.dumps({'app_name': 'DSH Host'}) + '\n' + json.dumps(self.report()))
        self.assertEqual(result, {'process': 'DSH Host', 'exception': {'type': 'EXC_CRASH', 'signal': 'SIGABRT'},
            'termination': {'namespace': 'SIGNAL', 'code': 6}, 'frames': [
                {'symbol': 'RuntimeSupervisor.restart()', 'imageIndex': 1, 'imageOffset': 123, 'symbolLocation': 4},
                {'imageIndex': 1}]})
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_ignores_other_processes_and_bounds_frames(self):
        report = self.report()
        report['procName'] = 'Other'
        self.assertIsNone(summarize(json.dumps(report)))
        report = self.report()
        report['threads'][0]['frames'] *= 100
        self.assertEqual(len(summarize(json.dumps(report))['frames']), 64)

    def test_rejects_extra_documents_and_invalid_top_level(self):
        for text in ('[]', '{}\n{}\n{}', 'not json'):
            with self.subTest(text=text), self.assertRaises(ValueError):
                summarize(text)

    def test_collection_distinguishes_absent_stale_and_unreadable_reports(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.assertEqual(collect(root / 'missing', 1)['status'], 'NO_REPORT')
            path = root / 'DSH_Host-fixture.ips'
            path.write_text(json.dumps(self.report()), encoding='utf-8')
            os.utime(path, (100, 100))
            self.assertEqual(collect(root, 101)['status'], 'NO_REPORT')
            self.assertEqual(collect(root, 99)['status'], 'REPORTS_FOUND')
            path.write_text('invalid', encoding='utf-8')
            self.assertEqual(collect(root, 99), {'status': 'INCOMPLETE', 'records': [], 'errors': ['host-report-unreadable']})

    def test_rejects_report_directories_and_excess_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'DSH_Host-directory.ips').mkdir()
            self.assertEqual(collect(root, 1)['status'], 'INCOMPLETE')
            for index in range(128):
                (root / f'DSH_Host-{index}.ips').write_text('{}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'too many'):
                collect(root, 1)


if __name__ == '__main__':
    unittest.main()
