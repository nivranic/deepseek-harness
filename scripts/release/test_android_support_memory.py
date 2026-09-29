"""Reject malformed procfs observations and keep memory-query failure separate from export acceptance."""

import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import Mock

from android_support_memory import SYSTEM_FIELDS, memory_fields, memory_pressure, observe_memory, optional_query, process_memory
from android_support_ui import PACKAGE


SYSTEM = b"MemTotal: 2621440 kB\nMemAvailable: 327680 kB\nMemFree: 65536 kB\nCached: 393216 kB\nSwapTotal: 1048576 kB\nSwapFree: 524288 kB\nPrivate: ignored\n"
PRESSURE = b"some avg10=12.34 avg60=1.00 avg300=0.25 total=123456\nfull avg10=2.34 avg60=0.10 avg300=0.00 total=3456\n"
STATUS = b"Name: private process\nUid: 12345 12345 12345 12345\nVmRSS: 232448 kB\nRssAnon: 220000 kB\nRssFile: 12000 kB\nRssShmem: 448 kB\n"


def stat(start=1234, pid=12345):
    return str(pid).encode() + b" (private (process) name) S " + b"0 " * 18 + str(start).encode() + b" 0 0\n"


def process_sample(start=1234, end=1234):
    return stat(start) + STATUS + b"950\n" + stat(end)


class AndroidSupportMemoryTests(unittest.TestCase):
    def test_records_fixed_counters_without_process_identity_or_unknown_fields(self):
        device = Mock()
        device.shell.side_effect = [SYSTEM, PRESSURE, process_sample()]
        result = observe_memory(device, 12345)
        self.assertEqual(result["system"], {"observation": "sampled", "reportedKiB": {
            "total": 2621440, "available": 327680, "free": 65536, "cached": 393216,
            "swapTotal": 1048576, "swapFree": 524288}})
        self.assertEqual(result["pressure"], {"observation": "sampled",
            "some": {"average10SecondsPercent": 12.34, "totalMicroseconds": 123456},
            "full": {"average10SecondsPercent": 2.34, "totalMicroseconds": 3456}})
        self.assertEqual(result["application"], {"observation": "sampled", "reportedKiB": {
            "resident": 232448, "anonymous": 220000, "file": 12000, "shared": 448}, "oomScoreAdjustment": 950})
        self.assertGreaterEqual(result["elapsedMilliseconds"], 0)
        self.assertLessEqual(result["elapsedMilliseconds"], 2 ** 32 - 1)
        for private in ("private", "Uid", "Name", PACKAGE, "/proc/"):
            self.assertNotIn(private, json.dumps(result))
        self.assertEqual([call.kwargs for call in device.shell.call_args_list], [{"timeout": 2}] * 3)
        self.assertEqual(device.shell.call_args_list[2].args[0], ["run-as", PACKAGE, "cat", "/proc/12345/stat",
                         "/proc/12345/status", "/proc/12345/oom_score_adj", "/proc/12345/stat"])

    def test_zero_available_memory_and_pressure_are_real_samples(self):
        result = memory_fields(SYSTEM.replace(b"MemAvailable: 327680", b"MemAvailable: 0"), SYSTEM_FIELDS)
        self.assertEqual(result["reportedKiB"]["available"], 0)
        zero = b"some avg10=0.00 avg60=0.00 avg300=0.00 total=0\nfull avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"
        self.assertEqual(memory_pressure(zero)["full"], {"average10SecondsPercent": 0.0, "totalMicroseconds": 0})

    def test_duplicate_missing_overflow_and_unrecognized_units_refuse_counters(self):
        for data in (b"", b"x" * 16385, SYSTEM + b"MemTotal: 1 kB\n",
                     SYSTEM.replace(b"MemFree:", b"Missing:"), SYSTEM.replace(b"65536 kB", b"65536 MB"),
                     SYSTEM.replace(b"65536 kB", b"-1 kB"), SYSTEM.replace(b"65536 kB", b"9223372036854775808 kB")):
            with self.subTest(data=data[:20]), self.assertRaises(ValueError):
                memory_fields(data, SYSTEM_FIELDS)

    def test_pressure_rejects_partial_duplicate_extra_and_out_of_range_records(self):
        for data in (b"", b"x" * 1025, PRESSURE.splitlines()[0], PRESSURE.replace(b"full", b"some"),
                     PRESSURE + b"private trailing error\n", PRESSURE.replace(b"12.34", b"100.01"),
                     PRESSURE.replace(b"1.00", b"NaN"), PRESSURE.replace(b"3456", b"18446744073709551616")):
            with self.subTest(data=data[:30]), self.assertRaises(ValueError):
                memory_pressure(data)

    def test_reused_pid_and_changed_or_malformed_process_samples_are_unavailable(self):
        samples = (process_sample(end=1235), process_sample().replace(b"12345 (", b"23456 ("),
                   process_sample().replace(b"950\n", b"1001\n"), process_sample().replace(b"950\n", b"private\n"),
                   process_sample().replace(b"RssFile:", b"Missing:"), stat() + b"950\n" + stat(),
                   process_sample().replace(b"1234 0 0", b"18446744073709551616 0 0"), b"x" * 16385)
        for data in samples:
            device = Mock()
            device.shell.side_effect = [SYSTEM, PRESSURE, data]
            result = observe_memory(device, 12345)
            self.assertEqual(result["application"], {"observation": "unavailable"})
            self.assertEqual(result["system"]["observation"], "sampled")
            self.assertEqual(result["pressure"]["observation"], "sampled")

    def test_one_failed_query_does_not_erase_other_samples_and_absent_pid_is_not_read(self):
        for failure in (ValueError("private"), OSError("private"), subprocess.TimeoutExpired("private", 2)):
            device = Mock()
            device.shell.side_effect = [failure, PRESSURE]
            result = observe_memory(device, None)
            self.assertEqual(result["system"], {"observation": "unavailable"})
            self.assertEqual(result["application"], {"observation": "unavailable"})
            self.assertEqual(result["pressure"]["observation"], "sampled")
            self.assertEqual(device.shell.call_count, 2)

    @unittest.skipUnless(sys.platform == "linux", "requires Linux procfs")
    def test_parses_actual_linux_kernel_files_for_the_current_test_process(self):
        pid = os.getpid()
        directory = Path('/proc') / str(pid)
        data = b''.join((directory / name).read_bytes() for name in ('stat', 'status', 'oom_score_adj', 'stat'))
        value = process_memory(data, pid)
        self.assertGreater(value['reportedKiB']['resident'], 0)
        self.assertGreater(memory_fields(Path('/proc/meminfo').read_bytes(), SYSTEM_FIELDS)['reportedKiB']['total'], 0)

    @unittest.skipUnless(sys.platform == "linux", "requires Linux procfs")
    def test_actual_kernel_without_psi_exposes_unavailability_without_erasing_other_counters(self):
        device = Mock()
        device.shell.side_effect = lambda arguments, **_options: Path(arguments[1]).read_bytes()
        value = optional_query(device, ["cat", "/proc/pressure/memory"], memory_pressure)
        expected = "sampled" if Path('/proc/pressure/memory').exists() else "unavailable"
        self.assertEqual(value['observation'], expected)
        self.assertGreater(memory_fields(Path('/proc/meminfo').read_bytes(), SYSTEM_FIELDS)['reportedKiB']['total'], 0)


if __name__ == "__main__":
    unittest.main()
