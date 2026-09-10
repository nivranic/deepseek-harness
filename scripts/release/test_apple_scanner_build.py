"""Apple builder rejection paths preserve existing files and never invoke unavailable compilers."""

from contextlib import redirect_stderr
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.apple_scanner_build import BUILD_FILES, build_apple, inspection_target, main, thin_archive
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

    def test_single_architecture_universal_archive_is_thinned_before_inspection(self):
        source = self.root / "framework"; output = self.root / "slice.a"
        archive = b"!<arch>\nfixture members"
        calls = []

        def lipo(arguments):
            calls.append(arguments)
            output.write_bytes(archive)
            return b""

        # A one-slice universal header still needs lipo; architecture count is not the container format.
        source.write_bytes(bytes.fromhex("cafebabe00000001") + b"fixture slice")
        thin_archive(source, "arm64", output, lipo)
        self.assertEqual(calls, [["/usr/bin/xcrun", "lipo", str(source), "-thin", "arm64", "-output", str(output)]])
        self.assertEqual(output.read_bytes(), archive)
        calls.clear(); output.unlink(); source.write_bytes(archive)
        thin_archive(source, "arm64", output, lipo)
        self.assertEqual(calls, [])
        self.assertEqual(output.read_bytes(), archive)

    def test_inspection_links_the_declared_platform_and_deployment_version(self):
        policy = {"minimumIOSVersion": "17.0", "minimumMacOSVersion": "14.0"}
        targets = [("ios", None, "arm64", "iphoneos", "arm64-apple-ios17.0"),
                   ("ios", "simulator", "arm64", "iphonesimulator", "arm64-apple-ios17.0-simulator"),
                   ("ios", "simulator", "x86_64", "iphonesimulator", "x86_64-apple-ios17.0-simulator"),
                   ("macos", None, "arm64", "macosx", "arm64-apple-macosx14.0"),
                   ("macos", None, "x86_64", "macosx", "x86_64-apple-macosx14.0")]
        for platform, variant, arch, sdk, triple in targets:
            with self.subTest(platform=platform, variant=variant, architecture=arch):
                self.assertEqual(inspection_target(platform, variant, arch, policy), (sdk, triple))
        for platform, variant, arch in [("ios", "maccatalyst", "arm64"), ("macos", "simulator", "arm64"),
                                      ("android", None, "arm64"), ("ios", None, "arm64e")]:
            with self.subTest(platform=platform, variant=variant, architecture=arch), self.assertRaises(ValueError):
                inspection_target(platform, variant, arch, policy)

    def test_cli_retains_validation_exception_privately_without_replacing_existing_work(self):
        arguments = ["builder", "--source-sha", self.commit]
        for flag, name in [("go", "go"), ("developer-dir", "developer"), ("cache", "cache"),
                           ("work-dir", "work"), ("output", "output")]:
            arguments.extend(["--" + flag, str(self.arguments[name])])
        work = self.arguments["work"]

        def failed_build(*args, **kwargs):
            work.mkdir(exist_ok=True)
            raise ValueError("fixture private framework validation detail")

        for existing in (False, True):
            if existing:
                (work / "failure.log").write_bytes(b"existing diagnostic")
            public = io.StringIO()
            with patch("sys.argv", arguments), patch("release.apple_scanner_build.build_apple", failed_build), redirect_stderr(public):
                self.assertEqual(main(), 1)
            self.assertEqual(public.getvalue(), "Apple scanner build failed; inspect the private work log\n")
            if existing:
                self.assertEqual((work / "failure.log").read_bytes(), b"existing diagnostic")
            else:
                self.assertIn("ValueError: fixture private framework validation detail", (work / "failure.log").read_text())


if __name__ == "__main__":
    unittest.main()
