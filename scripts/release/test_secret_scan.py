"""Secret-scan acceptance rejects changed fixture lines and unverified metadata."""

import hashlib
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from secret_scan import classify, findings, git, install_gitleaks, main, materialize, parse_exceptions, scan


class SourceFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-scan-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        isolation = patch.dict("os.environ", {"GIT_CONFIG_GLOBAL": str(self.root / "no-global"), "GIT_CONFIG_NOSYSTEM": "1"})
        isolation.start()
        self.addCleanup(isolation.stop)
        git(self.root, "init", "--quiet")
        git(self.root, "config", "user.name", "Scanner Fixture")
        git(self.root, "config", "user.email", "scanner@example.test")
        git(self.root, "config", "core.autocrlf", "false")
        (self.root / "docs").mkdir()
        self.owner = b"# Fixture\n"
        (self.root / "docs/guide.md").write_bytes(self.owner)
        blob = hashlib.sha1(f"blob {len(self.owner)}\0".encode() + self.owner).hexdigest()
        self.metadata = f"guide.md: {blob}"
        (self.root / "docs/guide.i18n.yaml").write_text(self.metadata + "\n", encoding="utf-8")
        self.literal = 'const FIXTURE_SECRET = "privacy-canary"'
        (self.root / "fixture.ts").write_text(self.literal + "\n", encoding="utf-8")
        self.commit = self.commit_source()
        self.exceptions = [{"path": "fixture.ts", "lineSha256": hashlib.sha256(self.literal.encode()).hexdigest(),
                            "rule": "generic-api-key", "reason": "Explicit privacy test canary."}]

    def commit_source(self):
        git(self.root, "add", ".")
        git(self.root, "commit", "--quiet", "-m", "fixture")
        return git(self.root, "rev-parse", "HEAD").decode().strip()

    def test_proves_the_hash_belongs_to_the_recorded_owner_at_that_commit(self):
        self.assertEqual(classify(self.root, self.commit, "docs/guide.i18n.yaml", self.metadata, "generic-api-key", []), "verified-git-blob")
        (self.root / "docs/guide.md").write_text("# Different owner\n", encoding="utf-8")
        newer = self.commit_source()
        self.assertEqual(classify(self.root, newer, "docs/guide.i18n.yaml", self.metadata, "generic-api-key", []), "unreviewed")

    def test_the_same_file_cannot_exempt_a_new_credential_or_rule(self):
        self.assertEqual(classify(self.root, self.commit, "fixture.ts", self.literal, "generic-api-key", self.exceptions), "reviewed-non-secret-line")
        for line, rule in [(self.literal + '; token = "new-sensitive-value"', "generic-api-key"), (self.literal, "github-pat")]:
            self.assertEqual(classify(self.root, self.commit, "fixture.ts", line, rule, self.exceptions), "unreviewed")

    def test_refuses_multiline_matches_and_projects_no_raw_content(self):
        row = {"File": "fixture.ts", "Commit": self.commit, "StartLine": 1, "EndLine": 2, "RuleID": "generic-api-key",
               "Secret": "private-report-value", "Match": "raw-code", "Author": "private-identity"}
        projected = findings(self.root, self.commit, [row], self.exceptions)
        self.assertEqual(projected[0]["classification"], "unreviewed")
        self.assertNotIn("private", json.dumps(projected))
        self.assertNotIn("raw-code", json.dumps(projected))

    def test_rejects_source_path_escape_and_unrelated_commit(self):
        row = {"File": "../fixture.ts", "Commit": self.commit, "StartLine": 1, "EndLine": 1, "RuleID": "generic-api-key"}
        with self.assertRaises(ValueError):
            findings(self.root, self.commit, [row], [])
        row.update(File="fixture.ts", Commit="a" * 40)
        with self.assertRaises(subprocess.CalledProcessError):
            findings(self.root, self.commit, [row], [])

    def test_scans_only_candidate_blobs_and_materializes_link_text(self):
        # update-index records a symlink portably without requiring Windows symlink privileges.
        link = subprocess.run(["git", "-C", str(self.root), "hash-object", "-w", "--stdin"], input=b"fixture.ts", capture_output=True, check=True).stdout.decode().strip()
        git(self.root, "update-index", "--add", "--cacheinfo", f"120000,{link},link")
        git(self.root, "commit", "--quiet", "-m", "link")
        commit = git(self.root, "rev-parse", "HEAD").decode().strip()
        (self.root / "untracked.env").write_text("untracked fixture", encoding="utf-8")
        with tempfile.TemporaryDirectory(prefix="dsh-scan-export-") as output:
            directory = Path(output) / "tree"
            directory.mkdir()
            self.assertEqual(materialize(self.root, commit, directory), 4)
            self.assertEqual((directory / "link").read_bytes(), b"fixture.ts")
            self.assertFalse((directory / "link").is_symlink())
            self.assertFalse((directory / "untracked.env").exists())

    def test_rejects_git_archive_attributes_that_change_the_scanned_corpus(self):
        for attribute in ("export-ignore", "export-subst"):
            with self.subTest(attribute=attribute):
                (self.root / ".gitattributes").write_text(f"fixture.ts {attribute}\n", encoding="utf-8")
                (self.root / "fixture.ts").write_text("$Format:%H$\n", encoding="utf-8")
                commit = self.commit_source()
                with tempfile.TemporaryDirectory(prefix="dsh-scan-export-") as output:
                    with self.assertRaisesRegex(ValueError, "candidate blob"):
                        materialize(self.root, commit, Path(output))

    def test_rejects_invalid_finding_coordinates_and_rules(self):
        row = {"File": "fixture.ts", "Commit": self.commit, "StartLine": 1, "EndLine": 1, "RuleID": "generic-api-key"}
        for changed in ({"StartLine": True}, {"EndLine": True}, {"EndLine": 0}, {"StartLine": 99, "EndLine": 99}, {"RuleID": "raw source text"}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                findings(self.root, self.commit, [{**row, **changed}], self.exceptions)


class ScannerBoundary(unittest.TestCase):
    def test_rejects_broad_or_malformed_exception_records(self):
        good = {"path": "fixture.ts", "lineSha256": "a" * 64, "rule": "generic-api-key", "reason": "Fixture."}
        self.assertEqual(parse_exceptions({"schemaVersion": 1, "lines": [good]}), [good])
        for value in [None, [], {"schemaVersion": True, "lines": []}, {"schemaVersion": 1, "lines": [], "allowAll": True},
                      {"schemaVersion": 2, "lines": [good]}, {"schemaVersion": 1, "lines": [{**good, "path": "tests/**"}]},
                      {"schemaVersion": 1, "lines": [{**good, "path": "../fixture.ts"}]},
                      {"schemaVersion": 1, "lines": [{**good, "lineSha256": "short"}]}, {"schemaVersion": 1, "lines": [good, good]}]:
            with self.assertRaises(ValueError):
                parse_exceptions(value)

    def test_a_bad_archive_digest_is_rejected_before_execution(self):
        registry = {"schemaVersion": 1, "gitleaks": {"version": "8.30.1", "archives": {"linux-x64": {
            "url": "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz",
            "sha256": "a" * 64, "binary": "gitleaks"}}}}
        with tempfile.TemporaryDirectory(prefix="dsh-scan-tool-") as directory, patch("secret_scan.sys.platform", "linux"), \
                patch("secret_scan.platform.machine", return_value="x86_64"), \
                patch("secret_scan.urllib.request.urlopen", return_value=io.BytesIO(b"wrong archive")), patch("secret_scan.subprocess.run") as execute:
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                install_gitleaks(registry, Path(directory))
            execute.assert_not_called()

    def test_scanner_errors_cannot_look_like_a_clean_scan(self):
        with tempfile.TemporaryDirectory(prefix="dsh-scan-report-") as directory:
            root = Path(directory)
            (root / "scan.json").write_text("[]", encoding="utf-8")
            with patch("secret_scan.subprocess.run", return_value=subprocess.CompletedProcess([], 0)):
                with self.assertRaisesRegex(ValueError, "did not complete"):
                    scan(Path("unused"), ["dir", "fixture"], root, "scan")

    def test_rejects_scanner_status_report_disagreement(self):
        with tempfile.TemporaryDirectory(prefix="dsh-scan-report-") as directory:
            root = Path(directory)
            for code, rows in ((1, []), (0, [{"RuleID": "github-pat"}]), (2, []), (0, {})):
                def scanner(*args, **kwargs):
                    (root / "scan.json").write_text(json.dumps(rows), encoding="utf-8")
                    return subprocess.CompletedProcess([], code)
                with self.subTest(code=code, rows=rows), patch("secret_scan.subprocess.run", side_effect=scanner):
                    with self.assertRaises(ValueError):
                        scan(Path("unused"), ["dir", "fixture"], root, "scan")

    def test_failure_overwrites_stale_pass_without_copying_exception_text(self):
        with tempfile.TemporaryDirectory(prefix="dsh-scan-fail-") as directory:
            report = Path(directory) / "evidence.json"
            report.write_text('{"status":"PASS"}', encoding="utf-8")
            with patch("sys.argv", ["scan-secrets.py", "--candidate", "invalid", "--base", "b" * 40, "--output", str(report)]):
                self.assertEqual(main(), 1)
            value = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(value["status"], "FAIL")
            self.assertNotIn("invalid", report.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
