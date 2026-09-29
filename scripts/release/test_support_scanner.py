"""Support scanner staging refuses incomplete or changed resources before exposing an output directory."""

import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.support_scanner import stage_support_scanner


class SupportScannerStage(unittest.TestCase):
    def fixture(self, executable, *, target="darwin", license_kind="regular"):
        def install(registry, directory):
            binary = directory / ("gitleaks.exe" if target == "win32" else "gitleaks")
            binary.write_bytes(executable)
            binary.chmod(0o700)
            license_bytes = b"MIT license fixture" if license_kind != "empty" else b""
            if target == "win32":
                with zipfile.ZipFile(directory / "scanner.archive", "w") as files:
                    if license_kind != "missing":
                        member = zipfile.ZipInfo("LICENSE")
                        kind = {"linked": stat.S_IFLNK, "directory": stat.S_IFDIR}.get(license_kind, stat.S_IFREG)
                        member.external_attr = (kind | 0o644) << 16
                        files.writestr(member, license_bytes)
                        if license_kind == "duplicate":
                            with warnings.catch_warnings():
                                warnings.simplefilter("ignore", UserWarning)
                                files.writestr(member, license_bytes)
            else:
                with tarfile.open(directory / "scanner.archive", "w:gz") as files:
                    if license_kind != "missing":
                        member = tarfile.TarInfo("LICENSE")
                        if license_kind == "linked":
                            member.type = tarfile.SYMTYPE
                            member.linkname = "../outside"
                            files.addfile(member)
                        elif license_kind == "directory":
                            member.type = tarfile.DIRTYPE
                            files.addfile(member)
                        else:
                            member.size = len(license_bytes)
                            files.addfile(member, io.BytesIO(license_bytes))
                            if license_kind == "duplicate":
                                files.addfile(member, io.BytesIO(license_bytes))
            return binary, {"version": "8.30.1", "binarySha256": hashlib.sha256(executable).hexdigest(),
                            "archiveSha256": hashlib.sha256((directory / "scanner.archive").read_bytes()).hexdigest()}
        return install

    def test_stages_only_verified_binary_license_and_identity(self):
        for target in ("darwin", "win32"):
            with self.subTest(target=target), tempfile.TemporaryDirectory() as directory, patch("release.support_scanner.sys.platform", target), \
                    patch("release.support_scanner.install_gitleaks", side_effect=self.fixture(b"native fixture", target=target)), \
                    patch("release.support_scanner.self_test") as canary:
                output = Path(directory) / "SupportScanner"
                identity = stage_support_scanner({}, output)
                canary.assert_called_once()
                binary = "gitleaks.exe" if target == "win32" else "gitleaks"
                self.assertEqual({p.name for p in output.iterdir()}, {binary, "LICENSE", "scanner.json"})
                self.assertEqual((output / binary).read_bytes(), b"native fixture")
                self.assertEqual((output / "LICENSE").read_bytes(), b"MIT license fixture")
                self.assertEqual(json.loads((output / "scanner.json").read_text(encoding="utf-8")), identity)
                self.assertEqual(identity["binarySha256"], identity["originalBinarySha256"])
                self.assertEqual(identity["licenseSha256"], hashlib.sha256(b"MIT license fixture").hexdigest())
                with self.assertRaisesRegex(ValueError, "must be new"):
                    stage_support_scanner({}, output)

    def test_failed_canary_or_changed_payload_never_creates_output(self):
        for target, failure in ((target, failure) for target in ("darwin", "win32") for failure in ("canary", "binary", "archive")):
            def poison(executable, scratch):
                if failure == "canary":
                    raise ValueError("fixture rejection")
                (executable if failure == "binary" else scratch / "scanner.archive").write_bytes(b"changed")
            with self.subTest(target=target, failure=failure), tempfile.TemporaryDirectory() as directory, \
                    patch("release.support_scanner.sys.platform", target), \
                    patch("release.support_scanner.install_gitleaks", side_effect=self.fixture(b"native fixture", target=target)), \
                    patch("release.support_scanner.self_test", side_effect=poison):
                output = Path(directory) / "SupportScanner"
                with self.assertRaises(ValueError):
                    stage_support_scanner({}, output)
                self.assertFalse(output.exists())

    def test_absent_linked_duplicate_directory_or_empty_license_prevents_output(self):
        for target, kind in ((target, kind) for target in ("darwin", "win32") for kind in ("missing", "linked", "empty", "duplicate", "directory")):
            with self.subTest(target=target, kind=kind), tempfile.TemporaryDirectory() as directory, \
                    patch("release.support_scanner.sys.platform", target), \
                    patch("release.support_scanner.install_gitleaks", side_effect=self.fixture(b"fixture", target=target, license_kind=kind)), \
                    patch("release.support_scanner.self_test"):
                output = Path(directory) / "SupportScanner"
                with self.assertRaisesRegex(ValueError, "license"):
                    stage_support_scanner({}, output)
                self.assertFalse(output.exists())

    def test_foreign_platform_is_rejected_before_acquisition(self):
        with patch("release.support_scanner.sys.platform", "linux"), patch("release.support_scanner.install_gitleaks") as install:
            with self.assertRaisesRegex(ValueError, "native macOS or Windows"):
                stage_support_scanner({}, Path("unused"))
            install.assert_not_called()


if __name__ == "__main__":
    unittest.main()
