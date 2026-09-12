"""Retain startup failures and system history without requiring a surviving application process."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

import android_support_instrumentation as owner
from test_android_support_process import history, record


class AndroidInstrumentationTests(unittest.TestCase):
    def test_failure_preserves_exit_code_and_observes_new_main_process_without_live_pid(self):
        device = Mock()
        device.shell.side_effect = [history(record(pid=123)), history(record(pid=123), record(pid=456, pss="0.00"))]
        run = Mock(return_value=17)
        value = owner.instrumentation_observation(device, run)
        self.assertEqual(value["status"], "FAIL")
        self.assertEqual(value["commandExitCode"], 17)
        self.assertEqual(value["applicationExit"]["scope"], "main-process-history-delta")
        self.assertEqual(len(value["applicationExit"]["records"]), 1)
        self.assertEqual(value["applicationExit"]["records"][0]["reason"], "low-memory")
        self.assertEqual(value["applicationExit"]["records"][0]["memory"]["pss"], {"observation": "not-sampled"})
        for text in ("123", "456", "private", "timestamp", "pid"):
            self.assertNotIn(text, json.dumps(value))
        run.assert_called_once_with()

    def test_missing_or_failed_exit_queries_cannot_change_the_command_result(self):
        for code in (0, 23):
            for observations in ((b"", history()), (history(), subprocess.TimeoutExpired("private", 5))):
                device = Mock()
                device.shell.side_effect = observations
                value = owner.instrumentation_observation(device, lambda: code)
                self.assertEqual(value["commandExitCode"], code)
                self.assertEqual(value["status"], "PASS" if code == 0 else "FAIL")
                self.assertEqual(value["applicationExit"]["observation"], "unavailable")

    def test_old_records_and_other_processes_do_not_become_new_instrumentation_exits(self):
        device = Mock()
        device.shell.side_effect = [history(record()), history(record(reason=5), record(pid=678, process="other"))]
        value = owner.instrumentation_observation(device, lambda: 1)
        self.assertEqual(value["applicationExit"], {"scope": "main-process-history-delta", "observation": "not-observed"})
        self.assertEqual(value["status"], "FAIL")

    def test_persistent_hosts_are_refused_before_source_device_or_launcher_access(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {}, clear=True), \
                patch.object(owner, "verify_source") as source, patch.object(owner, "CandidateDevice") as device, \
                patch.object(owner.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "disposable GitHub-hosted Linux"):
                owner.main(["--source-sha", "a" * 40, "--output", str(Path(temp) / "receipt.json")])
            source.assert_not_called()
            device.assert_not_called()
            run.assert_not_called()

    def test_malformed_source_is_refused_without_git_and_wrong_checkout_is_refused(self):
        with patch.object(owner.subprocess, "check_output") as git:
            with self.assertRaises(ValueError):
                owner.verify_source("branch-name")
            git.assert_not_called()
            git.return_value = b"b" * 40
            with self.assertRaisesRegex(ValueError, "checkout differs"):
                owner.verify_source("a" * 40)

    def test_main_runs_only_the_owned_command_and_persists_success_and_failure(self):
        for code in (0, 19):
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                output = root / "receipt.json"
                device = Mock()
                device.runtime.return_value = {"apiLevel": 36, "pageSizeBytes": 16384}
                device.shell.return_value = history()
                with patch.object(owner, "require_disposable_host"), patch.object(owner, "verify_source", return_value="b" * 40), \
                        patch.object(owner, "ROOT", root), patch.dict(os.environ, {"ANDROID_HOME": str(root / "sdk")}), \
                        patch.object(owner, "CandidateDevice", return_value=device), \
                        patch.object(owner.subprocess, "run", return_value=Mock(returncode=code)) as run:
                    self.assertEqual(owner.main(["--source-sha", "a" * 40, "--output", str(output)]), code)
                    run.assert_called_once_with(["./gradlew", "--no-daemon",
                                                 "-Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true",
                                                 ":app:connectedDebugAndroidTest"], cwd=root / "apps/android", check=False)
                value = json.loads(output.read_bytes())
                self.assertEqual(value["sourceSha"], "a" * 40)
                self.assertEqual(value["treeSha"], "b" * 40)
                self.assertEqual(value["status"], "PASS" if code == 0 else "FAIL")
                self.assertEqual(value["runtime"], device.runtime.return_value)

    def test_existing_receipt_is_never_overwritten_and_does_not_start_a_device(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "receipt.json"
            output.write_text('retained bytes', encoding='utf-8')
            with patch.object(owner, "require_disposable_host"), patch.object(owner, "verify_source", return_value="b" * 40), \
                    patch.dict(os.environ, {"ANDROID_HOME": temp}), patch.object(owner, "CandidateDevice") as device:
                with self.assertRaises(FileExistsError):
                    owner.main(["--source-sha", "a" * 40, "--output", str(output)])
                device.assert_not_called()
            self.assertEqual(output.read_text(encoding='utf-8'), 'retained bytes')

    def test_device_failure_keeps_a_fixed_failed_receipt_without_starting_gradle(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "receipt.json"
            with patch.object(owner, "require_disposable_host"), patch.object(owner, "verify_source", return_value="b" * 40), \
                    patch.dict(os.environ, {"ANDROID_HOME": temp}), \
                    patch.object(owner, "CandidateDevice", side_effect=ValueError("private device text")), \
                    patch.object(owner.subprocess, "run") as run:
                self.assertEqual(owner.main(["--source-sha", "a" * 40, "--output", str(output)]), 1)
                run.assert_not_called()
            value = json.loads(output.read_bytes())
            self.assertEqual(value["status"], "FAIL")
            self.assertNotIn("private", json.dumps(value))


if __name__ == "__main__":
    unittest.main()
