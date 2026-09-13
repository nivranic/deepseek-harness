"""Invalid builder inputs fail before tool execution or artifact replacement."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.mobile_scanner_build import BUILD_FILES, build_android, json_stream
from release.mobile_scanner_source import MODULE


class MobileScannerBuildTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="dsh-mobile-build-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        current = Path(__file__).resolve().parents[2]
        for name in BUILD_FILES:
            target = self.repo / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((current / name).read_bytes())
        source = self.repo / "native/support-scanner"
        source.mkdir(parents=True)
        for name, text in {"scanner.go": "package supportscanner\n", "go.mod": "module " + MODULE + "\n",
                           "go.sum": "fixture\n", "build.json": (current / "native/support-scanner/build.json").read_text(encoding="utf-8")}.items():
            (source / name).write_text(text, encoding="utf-8", newline="\n")
        (self.repo / "LICENSE").write_bytes(b"fixture license\n")
        self.git("init", "--quiet")
        self.git("config", "user.name", "Build fixture")
        self.git("config", "user.email", "build-fixture@example.invalid")
        self.git("config", "core.autocrlf", "false")
        self.git("add", "--", "scripts", "native", "LICENSE")
        self.git("commit", "--quiet", "-m", "fixture")
        self.commit = self.git("rev-parse", "HEAD").decode().strip()
        self.arguments = {name: self.root / name for name in ("go", "sdk", "ndk", "java", "cache", "work", "output")}

    def git(self, *arguments):
        return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-C", str(self.repo), *arguments], stderr=subprocess.PIPE)

    def test_builder_edits_and_unpinned_policy_refuse_before_creating_work(self):
        path = self.repo / BUILD_FILES[0]
        original = path.read_bytes()
        path.write_bytes(original + b"\n# edited fixture\n")
        with self.assertRaisesRegex(ValueError, "builder files must match"):
            build_android(self.repo, self.commit, **self.arguments)
        self.assertFalse(self.arguments["work"].exists())
        path.write_bytes(original)
        policy = self.repo / "native/support-scanner/build.json"
        value = json.loads(policy.read_bytes())
        value["goVersion"] = "latest"
        policy.write_text(json.dumps(value), encoding="utf-8")
        self.git("add", "--", "native/support-scanner/build.json")
        self.git("commit", "--quiet", "-m", "invalid version")
        with self.assertRaisesRegex(ValueError, "exact versions"):
            build_android(self.repo, self.git("rev-parse", "HEAD").decode().strip(), **self.arguments)
        self.assertFalse(self.arguments["work"].exists())

    def test_existing_output_and_wrong_ndk_are_preserved_without_execution(self):
        output = self.arguments["output"]
        output.mkdir()
        sentinel = output / "existing.txt"
        sentinel.write_bytes(b"preserve")
        with self.assertRaisesRegex(ValueError, "must be new"):
            build_android(self.repo, self.commit, **self.arguments)
        self.assertEqual(sentinel.read_bytes(), b"preserve")
        self.arguments["output"] = self.root / "new-output"
        self.arguments["ndk"].mkdir()
        (self.arguments["ndk"] / "source.properties").write_text("Pkg.Revision = 0.0.0\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "NDK differs"):
            build_android(self.repo, self.commit, **self.arguments)
        self.assertFalse(self.arguments["work"].exists())

    def test_nested_artifact_cache_is_refused(self):
        self.arguments["cache"] = self.arguments["output"] / "cache"
        with self.assertRaisesRegex(ValueError, "cache must be outside"):
            build_android(self.repo, self.commit, **self.arguments)
        self.assertFalse(self.arguments["output"].exists())

    @unittest.skipIf(sys.platform == "win32", "Unprivileged Windows fixtures cannot create directory symlinks")
    def test_dangling_output_link_is_not_followed(self):
        target = self.root / "outside"
        self.arguments["output"].symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "must be new"):
            build_android(self.repo, self.commit, **self.arguments)
        self.assertFalse(target.exists())

    def test_go_json_stream_requires_complete_objects(self):
        self.assertEqual(json_stream(b' {"Path":"a"}\n{"Path":"b"}\n'), [{"Path": "a"}, {"Path": "b"}])
        for data in [b"[]", b'{"Path":', b'null']:
            with self.subTest(data=data), self.assertRaises(ValueError):
                json_stream(data)


if __name__ == "__main__":
    unittest.main()
