"""Pinned scanner and packaged npm inventory acceptance, without substituting fixtures for actual scans."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from sbom import audit_npm_inventory, install_syft, scan_directory, scanner_environment, syft_archive


def registry(digest="a" * 64):
    return {"schemaVersion": 1, "syft": {"version": "1.51.1", "archives": {"win32-x64": {
        "url": "https://github.com/anchore/syft/releases/download/v1.51.1/syft_1.51.1_windows_amd64.zip",
        "sha256": digest, "binary": "syft.exe",
    }}}}


class SbomTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="dsh-sbom-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)

    def test_rejects_unrecorded_platform_owner_and_identity(self):
        self.assertEqual(syft_archive(registry(), "win32", "AMD64")[0], "1.51.1")
        for system, machine in [("darwin", "amd64"), ("win32", "arm64")]:
            with self.assertRaisesRegex(ValueError, "recorded"):
                syft_archive(registry(), system, machine)
        for field, value in [("url", "https://example.invalid/syft.zip"), ("sha256", "bad"), ("binary", "../syft.exe")]:
            data = registry()
            data["syft"]["archives"]["win32-x64"][field] = value
            with self.assertRaisesRegex(ValueError, "unrecorded"):
                syft_archive(data, "win32", "amd64")
        for value in [True, 2, "1"]:
            data = registry()
            data["schemaVersion"] = value
            with self.assertRaisesRegex(ValueError, "schema|registry"):
                syft_archive(data, "win32", "amd64")

    def test_checks_download_before_extracting_or_executing(self):
        with patch("sbom.sys.platform", "win32"), patch("sbom.platform.machine", return_value="AMD64"), \
                patch("sbom.urllib.request.urlopen", return_value=io.BytesIO(b"wrong bytes")), patch("sbom.subprocess.run") as execute:
            with self.assertRaisesRegex(ValueError, "digest mismatch"):
                install_syft(registry(), self.root)
            execute.assert_not_called()
            self.assertFalse((self.root / "syft.exe").exists())

    def test_extracts_only_verified_executable_and_checks_version(self):
        content = io.BytesIO()
        with zipfile.ZipFile(content, "w") as archive:
            archive.writestr("syft.exe", b"synthetic executable")
            archive.writestr("../must-not-extract", b"unrelated")
        digest = hashlib.sha256(content.getvalue()).hexdigest()
        with patch("sbom.sys.platform", "win32"), patch("sbom.platform.machine", return_value="AMD64"), \
                patch("sbom.urllib.request.urlopen", return_value=io.BytesIO(content.getvalue())), \
                patch("sbom.subprocess.run", return_value=subprocess.CompletedProcess([], 0, '{"version":"wrong"}')):
            with self.assertRaisesRegex(ValueError, "version mismatch"):
                install_syft(registry(digest), self.root)
        self.assertEqual((self.root / "syft.exe").read_bytes(), b"synthetic executable")
        self.assertFalse((self.root.parent / "must-not-extract").exists())

    def test_uses_installed_catalogers_and_explicit_configuration(self):
        package = self.root / "package"
        package.mkdir()
        output = self.root / "sbom.json"
        def produced(*args, **kwargs):
            output.write_text('{}', encoding="utf-8")
            return subprocess.CompletedProcess(args, 0)
        with patch.dict("os.environ", {"SYFT_EXCLUDE": "**", "SYFT_DEFAULT_CATALOGERS": "none"}), \
                patch("sbom.subprocess.run", side_effect=produced) as execute:
            scan_directory(self.root / "syft", package, output, self.root)
            args = execute.call_args.args[0]
            self.assertIn("image", args)
            self.assertIn("--override-default-catalogers", args)
            self.assertIn("--config", args)
            self.assertNotIn("SYFT_EXCLUDE", execute.call_args.kwargs["env"])
            self.assertEqual(scanner_environment()["SYFT_CHECK_FOR_APP_UPDATE"], "false")

    def test_rejects_operational_failure_and_missing_output(self):
        with patch("sbom.subprocess.run", side_effect=subprocess.CalledProcessError(1, "syft")):
            with self.assertRaises(subprocess.CalledProcessError):
                scan_directory(self.root / "syft", self.root, self.root / "missing.json", self.root)
        with patch("sbom.subprocess.run", return_value=subprocess.CompletedProcess([], 0)):
            with self.assertRaisesRegex(ValueError, "no SBOM"):
                scan_directory(self.root / "syft", self.root, self.root / "missing.json", self.root)

    def test_inventory_requires_all_named_versioned_packages(self):
        package = self.root / "app"
        (package / "node_modules/dep").mkdir(parents=True)
        (package / "package.json").write_text('{"name":"@scope/app","version":"1.0.0"}', encoding="utf-8")
        (package / "node_modules/dep/package.json").write_text('{"name":"dep","version":"2.0.0"}', encoding="utf-8")
        sbom = self.root / "bom.json"
        components = [{"group":"@scope","name":"app","version":"1.0.0","purl":"pkg:npm/%40scope/app@1.0.0"},
                      {"name":"dep","version":"2.0.0","purl":"pkg:npm/dep@2.0.0"}]
        sbom.write_text(json.dumps({"components": components}), encoding="utf-8")
        self.assertEqual(audit_npm_inventory(package, sbom)["versionedPackages"], 2)
        sbom.write_text(json.dumps({"components": components[:1]}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "omits 1"):
            audit_npm_inventory(package, sbom)

    def test_inventory_cannot_pass_with_only_metadata_manifests(self):
        (self.root / "package.json").write_text('{"type":"module"}', encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "must not be empty"):
            audit_npm_inventory(self.root, self.root / "unused.json")

    def test_inventory_rejects_omitted_unversioned_named_packages(self):
        (self.root / "package.json").write_text('{"name":"app","version":"1.0.0"}', encoding="utf-8")
        package = self.root / "node_modules/unversioned"
        package.mkdir(parents=True)
        (package / "package.json").write_text('{"name":"unversioned"}', encoding="utf-8")
        sbom = self.root / "bom.json"
        sbom.write_text(json.dumps({"components":[{"name":"app","version":"1.0.0","purl":"pkg:npm/app@1.0.0"}]}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "1 named packages"):
            audit_npm_inventory(self.root, sbom)

    def test_walk_errors_cannot_silently_narrow_inventory(self):
        def failed_walk(*args, **kwargs):
            kwargs["onerror"](PermissionError("synthetic unreadable directory"))
            return iter(())
        with patch("sbom.os.walk", side_effect=failed_walk):
            with self.assertRaises(PermissionError):
                audit_npm_inventory(self.root, self.root / "unused.json")

    def test_linked_inventory_root_is_rejected(self):
        target = self.root / "target"
        target.mkdir()
        link = self.root / "link"
        if os.name == "nt":
            environment = dict(os.environ, DSH_TEST_LINK_PATH=str(link), DSH_TEST_LINK_TARGET=str(target))
            subprocess.run(["pwsh", "-NoProfile", "-Command",
                            "New-Item -ItemType Junction -Path $env:DSH_TEST_LINK_PATH -Target $env:DSH_TEST_LINK_TARGET | Out-Null"],
                           env=environment, check=True, capture_output=True)
        else:
            link.symlink_to(target, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "real directory"):
            audit_npm_inventory(link, self.root / "unused.json")


if __name__ == "__main__":
    unittest.main()
