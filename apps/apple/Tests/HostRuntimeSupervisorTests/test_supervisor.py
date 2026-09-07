"""Real POSIX lifetime tests for the native helper; no Harness application is installed."""
import json
import os
from pathlib import Path
import signal
import shlex
import subprocess
import sys
import tempfile
import time
import unittest


@unittest.skipUnless(os.name == "posix", "POSIX runtime supervisor")
class SupervisorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory(prefix="dsh-supervisor-build-")
        cls.helper = Path(cls.build.name) / "HostRuntimeSupervisor"
        source = Path(__file__).resolve().parents[2] / "Sources/HostRuntimeSupervisor/main.c"
        compiler = shlex.split(os.environ.get("CC", "cc"))
        subprocess.run([*compiler, "-std=c11", "-Wall", "-Wextra", "-Werror", str(source), "-o", str(cls.helper)], check=True)

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-supervisor-case-")
        self.root = Path(self.temporary.name)
        self.environment = {**os.environ, "DSH_HOME": str(self.root)}
        self.processes = []
        self.runtime_pids = []

    def tearDown(self):
        for process in self.processes:
            if process.stdin and not process.stdin.closed:
                process.stdin.close()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            for stream in (process.stdout, process.stderr):
                if stream:
                    stream.close()
        for pid in self.runtime_pids:
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.temporary.cleanup()

    def fixture(self, behavior):
        executable = self.root / "fixture-dsh"
        executable.write_text(
            f"#!{sys.executable}\n"
            "import json,os,signal,subprocess,sys,time\n"
            "assert sys.argv[1:] == ['--profile','web','--no-open','--host','127.0.0.1','--port','0']\n"
            + behavior + "\n", encoding="utf-8")
        executable.chmod(0o700)
        return executable

    def start(self, behavior, grace="500"):
        executable = self.fixture(behavior)
        process = subprocess.Popen([str(self.helper), str(executable), grace], env=self.environment,
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.processes.append(process)
        return process

    def ready(self, process):
        line = process.stdout.readline()
        self.assertTrue(line, "fixture exited before readiness")
        pid = json.loads(line)["pid"]
        self.runtime_pids.append(pid)
        self.assertEqual(os.getpgid(pid), pid)
        return pid

    def assertGone(self, pid):
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)
        self.runtime_pids.remove(pid)

    def test_parent_pipe_close_reaps_the_runtime(self):
        child = self.start("signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))\nprint(json.dumps({'pid':os.getpid()}),flush=True)\ntime.sleep(30)")
        pid = self.ready(child)
        child.stdin.close()
        self.assertEqual(child.wait(timeout=5), 0)
        self.assertGone(pid)

    def test_a_stuck_runtime_is_killed_and_reported_as_forced(self):
        child = self.start("signal.signal(signal.SIGTERM, signal.SIG_IGN)\nprint(json.dumps({'pid':os.getpid()}),flush=True)\ntime.sleep(30)", "50")
        pid = self.ready(child)
        child.stdin.close()
        self.assertEqual(child.wait(timeout=5), 124)
        self.assertGone(pid)

    def test_runtime_failure_preserves_its_exit_code(self):
        child = self.start("sys.exit(17)")
        self.assertEqual(child.wait(timeout=5), 17)

    def test_invalid_launch_is_rejected_without_echoing_paths(self):
        child = self.start("sys.exit(0)", "not-a-duration")
        self.assertEqual(child.wait(timeout=5), 64)
        self.assertNotIn(str(self.root), child.stderr.read())

    def test_control_bytes_stop_the_runtime_and_fail_the_protocol(self):
        child = self.start("signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))\nprint(json.dumps({'pid':os.getpid()}),flush=True)\ntime.sleep(30)")
        pid = self.ready(child)
        child.stdin.write("unexpected")
        child.stdin.flush()
        self.assertEqual(child.wait(timeout=5), 70)
        self.assertGone(pid)

    def test_app_death_closes_the_pipe_without_a_cleanup_callback(self):
        executable = self.fixture("signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))\nprint(json.dumps({'pid':os.getpid()}),flush=True)\ntime.sleep(30)")
        program = (
            "import json,subprocess,sys,time\n"
            "child=subprocess.Popen(sys.argv[1:],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)\n"
            "print(child.stdout.readline(),end='',flush=True)\n"
            "time.sleep(30)\n"
        )
        parent = subprocess.Popen([sys.executable, "-c", program, str(self.helper), str(executable), "500"],
                                  env=self.environment, stdout=subprocess.PIPE, text=True)
        self.processes.append(parent)
        pid = self.ready(parent)
        parent.kill()
        parent.wait(timeout=5)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                break
            time.sleep(0.02)
        self.assertGone(pid)


if __name__ == "__main__":
    unittest.main()
