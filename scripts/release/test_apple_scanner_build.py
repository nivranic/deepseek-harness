"""Apple builder rejection paths preserve existing files and never invoke unavailable compilers."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.apple_scanner_build import BUILD_FILES, build_apple
from release.mobile_scanner_source import MODULE


class AppleScannerBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="dsh-apple-builder-"); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name); self.repo = self.root / "repo"; self.repo.mkdir()
        current = Path(__file__).resolve().parents[2]
        for name in BUILD_FILES:
            target = self.repo / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes((current / name).read_bytes())
        source = self.repo / "native/support-scanner"; source.mkdir(parents=True)
        for name, data in {"go.mod": ("module " + MODULE + "\n").encode(), "go.sum": b"fixture", "scanner.go": b"package supportscanner\n",
                           "build.json": (current / "native/support-scanner/build.json").read_bytes(),
                           "apple-build.json": (current / "native/support-scanner/apple-build.json").read_bytes()}.items():
            (source / name).write_bytes(data)
        (self.repo / "LICENSE").write_bytes(b"license")
        self.git("init", "--quiet"); self.git("config", "user.name", "Builder fixture")
        self.git("config", "user.email", "builder@example.invalid"); self.git("config", "core.autocrlf", "false")
        self.git("add", "--", "scripts", "native", "LICENSE"); self.git("commit", "--quiet", "-m", "fixture")
        self.commit = self.git("rev-parse", "HEAD").decode().strip()
        self.arguments = {name: self.root / name for name in ("go", "developer", "cache", "work", "output")}

    def git(self, *args):
        return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-C", str(self.repo), *args], stderr=subprocess.PIPE)

    def test_existing_outputs_and_overlaps_are_rejected_without_replacing_files(self):
        output = self.arguments["output"]; output.mkdir(); (output / "keep").write_bytes(b"existing")
        with self.assertRaisesRegex(ValueError, "must be new"):
            build_apple(self.repo, self.commit, **self.arguments)
        self.assertEqual((output / "keep").read_bytes(), b"existing")
        self.arguments["output"] = self.arguments["work"] / "nested"
        with self.assertRaisesRegex(ValueError, "disjoint"):
            build_apple(self.repo, self.commit, **self.arguments)
        self.arguments["output"] = self.root / "new-output"; self.arguments["cache"] = self.arguments["output"] / "cache"
        with self.assertRaisesRegex(ValueError, "cache must be outside"):
            build_apple(self.repo, self.commit, **self.arguments)
        self.assertFalse(self.arguments["work"].exists())

    def test_edited_builder_and_unpinned_xcode_refuse_before_creating_work(self):
        path = self.repo / BUILD_FILES[0]; original = path.read_bytes(); path.write_bytes(original + b"\n# changed\n")
        with self.assertRaisesRegex(ValueError, "builder files must match"):
            build_apple(self.repo, self.commit, **self.arguments)
        path.write_bytes(original)
        policy = self.repo / "native/support-scanner/apple-build.json"; value = json.loads(policy.read_bytes()); value["xcodeVersion"] = "latest"
        policy.write_text(json.dumps(value)); self.git("add", "--", "native/support-scanner/apple-build.json"); self.git("commit", "--quiet", "-m", "invalid policy")
        with self.assertRaisesRegex(ValueError, "explicit numeric"):
            build_apple(self.repo, self.git("rev-parse", "HEAD").decode().strip(), **self.arguments)
        self.assertFalse(self.arguments["work"].exists())

    def test_non_apple_environment_refuses_without_starting_a_tool(self):
        with patch("release.apple_scanner_build.sys.platform", "linux"), self.assertRaisesRegex(ValueError, "requires macOS"):
            build_apple(self.repo, self.commit, **self.arguments)
        self.assertFalse(self.arguments["work"].exists())


if __name__ == "__main__":
    unittest.main()
