"""Exercise one build-marked crash only on the candidate's disposable Android emulator."""

import os
import re
import sys
import time

from android_candidate_device import require_disposable_host
from android_sbom_inventory import require
from android_support_process import application_exit_records
from android_support_ui import PACKAGE


def exercise_build_crash(device):
    """Match the killed main process in system history and assert its build marker through the installed native test."""
    require_disposable_host(sys.platform, os.environ)
    baseline = application_exit_records(device)
    require(baseline is not None, "Controlled crash requires readable system history")
    current = device.shell(["pidof", PACKAGE], timeout=5).strip()
    require(re.fullmatch(rb"[1-9][0-9]{0,9}", current) is not None, "Controlled crash requires one candidate main process")
    pid = int(current)
    # run-as limits signalling to the installed debug application's UID even if the observed PID is reused.
    device.shell(["run-as", PACKAGE, "kill", "-11", str(pid)], timeout=10)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        after = application_exit_records(device)
        require(after is not None, "Controlled crash system history became unavailable")
        stopped = not device.shell(["pidof", PACKAGE], timeout=5, empty_exit=True).strip()
        # Android 16 ApplicationExitInfo.REASON_CRASH_NATIVE is 5; correlation keys remain private.
        observed = any(key not in baseline and key[1] == pid and row[0] == 5 for key, row in after.items())
        if stopped and observed:
            break
        time.sleep(0.1)
    else:
        raise ValueError("Controlled candidate crash was not observed")
    probe = device.shell(["am", "instrument", "-w", "-e", "class",
                          "ai.deepseek.dsh.companion.ProcessExitHistoryNativeTest#applicationRegistersItsBuildAndQueriesBoundedSystemHistory",
                          "-e", "dshExitProbePid", str(pid), PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner"], timeout=120)
    require(re.search(rb"(?m)^OK \(1 test\)\r?$", probe) is not None
            and b"FAILURES!!!" not in probe and b"INSTRUMENTATION_FAILED" not in probe,
            "Controlled crash build-marker native assertion failed")
    return {"status": "PASS", "trigger": "run-as-sigsegv", "systemReason": "native-crash", "processStopped": True,
            "nativeMarkerAssertion": "PASS"}
