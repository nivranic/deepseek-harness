"""Support scanner staging refuses incomplete or changed resources before exposing an output directory."""

import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.support_scanner import stage_support_scanner


class SupportScannerStage(unittest.TestCase):
    def fixture(self, executable, *, license_kind="regular"):
        def install(registry, directory):
            binary = directory / "gitleaks"
            binary.write_bytes(executable)
            binary.chmod(0o700)
            with tarfile.open(directory / "scanner.archive", "w:gz") as files:
                if license_kind != "missing":
                    member = tarfile.TarInfo("LICENSE")
                    if license_kind == "linked":
                        member.type = tarfile.SYMTYPE
                        member.linkname = "../outside"
                        files.addfile(member)
                    else:
                        license_bytes = b"MIT license fixture" if license_kind == "regular" else b""
                        member.size = len(license_bytes)
                        files.addfile(member, io.BytesIO(license_bytes))
            return binary, {"version": "8.30.1", "binarySha256": hashlib.sha256(executable).hexdigest(),
                            "archiveSha256": hashlib.sha256((directory / "scanner.archive").read_bytes()).hexdigest()}
        return install

    def test_stages_only_verified_binary_license_and_identity(self):
        with tempfile.TemporaryDirectory() as directory, patch("release.support_scanner.sys.platform", "darwin"), \
                patch("release.support_scanner.install_gitleaks", side_effect=self.fixture(b"native fixture")), \
                patch("release.support_scanner.self_test") as canary:
            output = Path(directory) / "SupportScanner"
            identity = stage_support_scanner({}, output)
            canary.assert_called_once()
            self.assertEqual({p.name for p in output.iterdir()}, {"gitleaks", "LICENSE", "scanner.json"})
            self.assertEqual((output / "gitleaks").read_bytes(), b"native fixture")
            self.assertEqual((output / "LICENSE").read_bytes(), b"MIT license fixture")
            self.assertEqual(json.loads((output / "scanner.json").read_text(encoding="utf-8")), identity)
            self.assertEqual(identity["binarySha256"], identity["originalBinarySha256"])
            self.assertEqual(identity["licenseSha256"], hashlib.sha256(b"MIT license fixture").hexdigest())
            with self.assertRaisesRegex(ValueError, "must be new"):
                stage_support_scanner({}, output)

    def test_failed_canary_or_changed_payload_never_creates_output(self):
        for failure in ("canary", "binary", "archive"):
            def poison(executable, scratch):
                if failure == "canary":
                    raise ValueError("fixture rejection")
                (executable if failure == "binary" else scratch / "scanner.archive").write_bytes(b"changed")
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory, \
                    patch("release.support_scanner.sys.platform", "darwin"), \
                    patch("release.support_scanner.install_gitleaks", side_effect=self.fixture(b"native fixture")), \
                    patch("release.support_scanner.self_test", side_effect=poison):
                output = Path(directory) / "SupportScanner"
                with self.assertRaises(ValueError):
                    stage_support_scanner({}, output)
                self.assertFalse(output.exists())

    def test_absent_linked_or_empty_license_prevents_output(self):
        for kind in ("missing", "linked", "empty"):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory, \
                    patch("release.support_scanner.sys.platform", "darwin"), \
                    patch("release.support_scanner.install_gitleaks", side_effect=self.fixture(b"fixture", license_kind=kind)), \
                    patch("release.support_scanner.self_test"):
                output = Path(directory) / "SupportScanner"
                with self.assertRaisesRegex(ValueError, "license"):
                    stage_support_scanner({}, output)
                self.assertFalse(output.exists())

    def test_foreign_platform_is_rejected_before_acquisition(self):
        with patch("release.support_scanner.sys.platform", "win32"), patch("release.support_scanner.install_gitleaks") as install:
            with self.assertRaisesRegex(ValueError, "native macOS"):
                stage_support_scanner({}, Path("unused"))
            install.assert_not_called()


if __name__ == "__main__":
    unittest.main()
