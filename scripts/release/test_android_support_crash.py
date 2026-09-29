"""Controlled crashes require the disposable host, one owned process, a new system record and a native marker assertion."""

import unittest
from unittest.mock import Mock, patch

from android_support_crash import exercise_build_crash
from android_support_ui import PACKAGE


class ControlledCrashTests(unittest.TestCase):
    def run_probe(self, device, history, times=(0, 1)):
        with patch("android_support_crash.require_disposable_host") as guard, \
                patch("android_support_crash.application_exit_records", side_effect=history), \
                patch("android_support_crash.time.monotonic", side_effect=times), \
                patch("android_support_crash.time.sleep"):
            result = exercise_build_crash(device)
        guard.assert_called_once()
        return result

    def test_matches_new_crash_and_requires_native_marker_probe(self):
        device = Mock()
        device.shell.side_effect = [b"2468\n", b"", b"", b"OK (1 test)\n"]
        result = self.run_probe(device, [{}, {("new", 2468): (5, 0, 0, {})}])
        self.assertEqual(result, {"status": "PASS", "trigger": "run-as-sigsegv", "systemReason": "native-crash",
                                  "processStopped": True, "nativeMarkerAssertion": "PASS"})
        self.assertEqual(device.shell.call_args_list[1].args[0], ["run-as", PACKAGE, "kill", "-11", "2468"])
        self.assertEqual(device.shell.call_args_list[-1].args[0][-3:], ["dshExitProbePid", "2468", PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner"])
        self.assertNotIn("2468", str(result))
        self.assertNotIn("new", str(result))

    def test_host_guard_rejects_before_any_device_mutation(self):
        device = Mock()
        with patch("android_support_crash.require_disposable_host", side_effect=ValueError("disposable host required")), \
                self.assertRaisesRegex(ValueError, "disposable host required"):
            exercise_build_crash(device)
        device.shell.assert_not_called()

    def test_missing_history_or_ambiguous_process_never_requests_a_crash(self):
        for history, process in ((None, b"2468"), ({}, b""), ({}, b"0"), ({}, b"2468 5678")):
            with self.subTest(history=history, process=process):
                device = Mock()
                device.shell.return_value = process
                with self.assertRaises(ValueError):
                    self.run_probe(device, [history])
                self.assertTrue(all(call.args[0][0] != "run-as" for call in device.shell.call_args_list))

    def test_old_other_process_or_other_reason_records_cannot_accept_the_crash(self):
        matching = {("record", 2468): (5, 0, 0, {})}
        for before, after in ((matching, matching), ({}, {("record", 5678): (5, 0, 0, {})}),
                              ({}, {("record", 2468): (3, 0, 0, {})})):
            device = Mock()
            device.shell.side_effect = [b"2468", b"", b""]
            with self.assertRaisesRegex(ValueError, "not observed"):
                self.run_probe(device, [before, after], times=(0, 1, 31))
            self.assertEqual(len(device.shell.call_args_list), 3)

    def test_surviving_process_or_failed_native_assertion_cannot_pass(self):
        device = Mock()
        device.shell.side_effect = [b"2468", b"", b"2468"]
        with self.assertRaisesRegex(ValueError, "not observed"):
            self.run_probe(device, [{}, {("new", 2468): (5, 0, 0, {})}], times=(0, 1, 31))
        for result in (b"OK (2 tests)\n", b"FAILURES!!!\n", b"INSTRUMENTATION_FAILED\nOK (1 test)\n", b"private native traceback"):
            device = Mock()
            device.shell.side_effect = [b"2468", b"", b"", result]
            with self.assertRaisesRegex(ValueError, "native assertion failed"):
                self.run_probe(device, [{}, {("new", 2468): (5, 0, 0, {})}])


if __name__ == "__main__":
    unittest.main()
