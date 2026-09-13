"""Run the owned Android instrumentation command with private, bounded system exit observations."""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from android_candidate_device import CandidateDevice, require_disposable_host
from android_sbom_inventory import require
from android_support_process import application_exit_records, observe_new_application_exits

ROOT = Path(__file__).resolve().parents[2]


def instrumentation_observation(device, run):
    """The Gradle result owns acceptance; optional system observations cannot turn a failed run into success."""
    baseline = application_exit_records(device)
    result = run()
    exits = observe_new_application_exits(device, baseline)
    return {"commandExitCode": result, "status": "PASS" if result == 0 else "FAIL",
            "applicationExit": {"scope": "main-process-history-delta", **exits}}


def verify_source(source):
    """Bind observations to the actual clean checkout, including a PR's merge-test commit."""
    require(re.fullmatch(r"[a-f0-9]{40}", source), "Android instrumentation requires an immutable source")
    def git(*arguments):
        return subprocess.check_output(["git", "-C", str(ROOT), *arguments], stderr=subprocess.DEVNULL).decode().strip()
    require(git("rev-parse", "HEAD") == source and not git("status", "--porcelain", "--untracked-files=no"),
            "Android instrumentation checkout differs from the source")
    return git("rev-parse", "HEAD^{tree}")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    require_disposable_host(sys.platform, os.environ)
    tree = verify_source(args.source_sha)
    sdk = Path(os.environ.get("ANDROID_HOME", ""))
    require(sdk.is_absolute(), "Android instrumentation requires an absolute SDK directory")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # An exclusive receipt cannot preserve a previous PASS after a failed invocation.
    with args.output.open("x", encoding="utf-8", newline="\n") as output:
        record = {"schemaVersion": 1, "scope": "android-instrumentation-command",
                  "sourceSha": args.source_sha, "treeSha": tree, "status": "FAIL"}
        code = 1
        try:
            device = CandidateDevice(sdk / "platform-tools/adb")
            record["runtime"] = device.runtime()
            def run():
                return subprocess.run(["./gradlew", "--no-daemon",
                                       "-Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true",
                                       ":app:connectedDebugAndroidTest"], cwd=ROOT / "apps/android", check=False).returncode
            record.update(instrumentation_observation(device, run))
            code = record["commandExitCode"]
        except (OSError, ValueError, subprocess.SubprocessError):
            # Device and launcher errors can contain paths or output; no command success was observed.
            record["reason"] = "Android instrumentation command did not complete"
        json.dump(record, output, indent=2)
        output.write("\n")
    print(json.dumps({"status": record["status"], "scope": record["scope"]}))
    return code if 0 <= code <= 255 else 1


if __name__ == "__main__":
    raise SystemExit(main())
