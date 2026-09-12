"""Keep stale exits, other processes and private Android diagnostic fields out of failure receipts."""

import json
import subprocess
import unittest
from unittest.mock import Mock

from android_support_process import HEADER, application_exit_records, observe_application_exits, parse_exit_records
from android_support_ui import PACKAGE


def history(*records):
    return (HEADER + "\nLast Timestamp of Persistence Into Persistent Storage: 2026-09-12 00:00:00.000\n"
            + "  package: " + PACKAGE + "\n  Historical Process Exit for uid=10123\n" + "".join(records)).encode()


def record(pid=12345, time="2026-09-12 01:02:03.004", process=PACKAGE, reason=3, subreason=30, status=9):
    return ("    ApplicationExitInfo #0:\n"
            f"      timestamp={time} pid={pid} realUid=10123 packageUid=10123 definingUid=-1 user=0\n"
            f"      process={process} reason={reason} (private label) subreason={subreason} (private label) status={status}\n"
            "      importance=400 pss=999MB rss=999MB description=private diagnostic text state=empty trace=/private/path\n")


class AndroidSupportProcessTests(unittest.TestCase):
    def test_reports_new_observed_main_process_exit_without_identifiers_or_text(self):
        device = Mock()
        device.shell.return_value = history(record())
        result = observe_application_exits(device, parse_exit_records(history()), [12345, 23456])
        self.assertEqual(result, {"observation": "observed", "records": [
            {"reason": "low-memory", "subreasonCode": 30, "statusCode": 9},
        ]})
        device.shell.assert_called_once_with(["dumpsys", "activity", "exit-info", PACKAGE], timeout=5)
        for private in ("12345", "23456", "2026", "private", PACKAGE):
            self.assertNotIn(private, json.dumps(result))

    def test_preexisting_exit_updates_and_unobserved_processes_are_not_scenario_exits(self):
        baseline = parse_exit_records(history(record(reason=0)))
        device = Mock()
        device.shell.return_value = history(record(reason=3), record(pid=23456), record(pid=34567, process=PACKAGE + ":helper"))
        self.assertEqual(observe_application_exits(device, baseline, [12345, 34567]), {"observation": "not-observed"})

    def test_reused_pid_needs_a_new_timestamp_and_cannot_relabel_earlier_record(self):
        baseline = parse_exit_records(history(record()))
        device = Mock()
        device.shell.return_value = history(record(time="2026-09-12 01:03:04.005", reason=5, subreason=0, status=11))
        self.assertEqual(observe_application_exits(device, baseline, [12345]), {"observation": "observed", "records": [
            {"reason": "crash-native", "subreasonCode": 0, "statusCode": 11},
        ]})

    def test_unknown_platform_codes_have_fixed_projection(self):
        device = Mock()
        device.shell.return_value = history(record(reason=999, subreason=1001, status=-12345))
        self.assertEqual(observe_application_exits(device, {}, [12345]), {"observation": "observed", "records": [
            {"reason": "unrecognized", "subreasonCode": "unrecognized", "statusCode": "unrecognized"},
        ]})

    def test_missing_baseline_and_missing_process_observations_are_unavailable(self):
        device = Mock()
        device.shell.return_value = history(record())
        self.assertEqual(observe_application_exits(device, None, [12345]), {"observation": "unavailable"})
        self.assertEqual(observe_application_exits(device, {}, [None]), {"observation": "unavailable"})

    def test_malformed_ambiguous_oversized_and_failed_queries_are_unavailable(self):
        device = Mock()
        bad = (b"", b" " * 65537, b"private error", history(record(), record()), history(record()).replace(b"pid=12345", b"pid=0"),
               history(record()).replace(b"status=9", b"status=private"), history(record()).replace(b"importance=", b"unknown="),
               history() + b"private command failure\n", history(record()).replace(b"process=", b"missing="),
               history(record()).replace(b"#0:", b"invalid:"), history(record())[:200], history() + b"\xff")
        for data in bad:
            with self.subTest(length=len(data)):
                device.shell.return_value = data
                self.assertIsNone(application_exit_records(device))
        for failure in (OSError("private"), ValueError("private"), subprocess.TimeoutExpired("private command", 5)):
            device.shell.side_effect = failure
            self.assertIsNone(application_exit_records(device))


if __name__ == "__main__":
    unittest.main()
