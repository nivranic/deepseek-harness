"""Committed module snapshots exclude dirty files and reject changed compiler inputs."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.mobile_scanner_source import MODULE, read_source, verify_materialized_source, write_proxy


class MobileScannerSourceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-mobile-source-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repository"
        self.repo.mkdir()
        self.git("init", "--quiet")
        self.git("config", "user.name", "Source fixture")
        self.git("config", "user.email", "source-fixture@example.invalid")
        self.git("config", "core.autocrlf", "false")
        module = self.repo / "native/support-scanner"
        module.mkdir(parents=True)
        for name, data in {"go.mod": "module " + MODULE + "\n\ngo 1.26.0\n", "go.sum": "fixture sums\n",
                           "scanner.go": "package supportscanner\n", "nested/resource.txt": "committed resource\n"}.items():
            path = module / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(data, encoding="utf-8", newline="\n")
        (self.repo / "LICENSE").write_text("fixture repository license\n", encoding="utf-8", newline="\n")
        self.git("add", "--", "native/support-scanner", "LICENSE")
        self.git("commit", "--quiet", "-m", "fixture")
        self.commit = self.git("rev-parse", "HEAD").decode().strip()

    def git(self, *arguments, input_bytes=None):
        return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-C", str(self.repo), *arguments],
                                       input=input_bytes, stderr=subprocess.PIPE)

    def test_proxy_keeps_exact_committed_files_and_repeats_identically(self):
        (self.repo / "native/support-scanner/scanner.go").write_text("dirty source\n", encoding="utf-8")
        (self.repo / "native/support-scanner/untracked.go").write_text("untracked source\n", encoding="utf-8")
        source = read_source(self.repo, self.commit)
        left, right = self.root / "left", self.root / "right"
        first = write_proxy(source, left)
        self.assertEqual(first, write_proxy(source, right))
        archive = left / MODULE / "@v" / (source.version + ".zip")
        self.assertEqual(archive.read_bytes(), (right / MODULE / "@v" / archive.name).read_bytes())
        with zipfile.ZipFile(archive) as files:
            prefix = MODULE + "@" + source.version + "/"
            self.assertEqual(files.read(prefix + "scanner.go"), b"package supportscanner\n")
            self.assertEqual(files.read(prefix + "LICENSE"), b"fixture repository license\n")
            self.assertNotIn(prefix + "untracked.go", files.namelist())
            self.assertTrue(all(item.date_time == (1980, 1, 1, 0, 0, 0) for item in files.infolist()))
        info = json.loads((archive.parent / (source.version + ".info")).read_bytes())
        self.assertEqual(info["Version"], source.version)
        self.assertNotIn(str(self.repo), json.dumps(first))
        with self.assertRaisesRegex(ValueError, "must be new"):
            write_proxy(source, left)

    def test_source_ref_requires_a_full_commit(self):
        for value in ["HEAD", self.commit[:12], "-c", self.commit.upper(), "0" * 39]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                read_source(self.repo, value)

    def test_git_links_are_rejected_without_following_working_files(self):
        object_id = self.git("hash-object", "-w", "--stdin", input_bytes=b"../../outside").decode().strip()
        self.git("update-index", "--add", "--cacheinfo", "120000," + object_id + ",native/support-scanner/link")
        self.git("commit", "--quiet", "-m", "linked source")
        with self.assertRaisesRegex(ValueError, "regular Git files"):
            read_source(self.repo, self.git("rev-parse", "HEAD").decode().strip())

    def test_missing_module_or_empty_license_cannot_create_a_snapshot(self):
        self.git("rm", "--quiet", "native/support-scanner/go.mod")
        self.git("commit", "--quiet", "-m", "missing module")
        with self.assertRaisesRegex(ValueError, "missing required"):
            read_source(self.repo, self.git("rev-parse", "HEAD").decode().strip())
        (self.repo / "LICENSE").write_bytes(b"")
        (self.repo / "native/support-scanner/go.mod").write_bytes(
            self.git("show", self.commit + ":native/support-scanner/go.mod"))
        self.git("add", "--", "LICENSE", "native/support-scanner/go.mod")
        self.git("commit", "--quiet", "-m", "empty license")
        with self.assertRaisesRegex(ValueError, "must not be empty"):
            read_source(self.repo, self.git("rev-parse", "HEAD").decode().strip())

    def test_materialized_cache_requires_exact_inventory_and_bytes(self):
        source = read_source(self.repo, self.commit)
        cache = self.root / "cache"
        cache.mkdir()
        for item in source.files:
            target = cache / item.module_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(item.data)
        verify_materialized_source(source, cache)
        (cache / "scanner.go").write_bytes(b"changed\n")
        with self.assertRaisesRegex(ValueError, "bytes differ"):
            verify_materialized_source(source, cache)
        (cache / "scanner.go").write_bytes(next(item.data for item in source.files if item.module_path == "scanner.go"))
        (cache / "extra.go").write_bytes(b"extra\n")
        with self.assertRaisesRegex(ValueError, "inventory differs"):
            verify_materialized_source(source, cache)

    def test_repository_license_accepts_regular_modes_and_refuses_links(self):
        self.git("update-index", "--chmod=+x", "LICENSE")
        self.git("commit", "--quiet", "-m", "regular executable mode")
        source = read_source(self.repo, self.git("rev-parse", "HEAD").decode().strip())
        self.assertEqual(next(item.data for item in source.files if item.module_path == "LICENSE"), b"fixture repository license\n")
        object_id = self.git("hash-object", "-w", "--stdin", input_bytes=b"outside").decode().strip()
        self.git("update-index", "--cacheinfo", "120000," + object_id + ",LICENSE")
        self.git("commit", "--quiet", "-m", "linked license")
        with self.assertRaisesRegex(ValueError, "regular repository license"):
            read_source(self.repo, self.git("rev-parse", "HEAD").decode().strip())


if __name__ == "__main__":
    unittest.main()
