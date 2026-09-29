"""Real filesystem staging rejects substituted inputs; synthetic archives do not prove native execution."""

import copy
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.apple_scanner_artifact import MAC_LINKS, framework_entries, package_apple
from release.apple_scanner_build import BUILD_FILES
from release.apple_scanner_stage import stage_apple
from release.mobile_scanner_source import read_source, write_proxy


@unittest.skipIf(sys.platform == "win32", "Xcode staging preserves POSIX framework version links")
class AppleScannerStageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-apple-stage-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repository = Path(__file__).resolve().parents[2]
        self.commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=self.repository).decode().strip()
        source = read_source(self.repository, self.commit)
        self.directory = self.root / "artifact"; self.directory.mkdir()
        self.framework = self.root / "framework"; self.framework.mkdir()
        index = plistlib.loads((Path(__file__).parent / "fixtures/apple-scanner/Info.plist").read_bytes())
        (self.framework / "Info.plist").write_bytes(plistlib.dumps(index))
        for row in index["AvailableLibraries"]:
            folder = self.framework / row["LibraryIdentifier"] / "SupportScanner.framework"
            base = folder / "Versions/A" if row["SupportedPlatform"] == "macos" else folder
            (base / "Headers").mkdir(parents=True); (base / "Modules").mkdir()
            (base / "SupportScanner").write_bytes(b"!<arch>\nstructural fixture")
            metadata = base / "Resources" if row["SupportedPlatform"] == "macos" else base
            metadata.mkdir(exist_ok=True)
            (metadata / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "SupportScanner"}))
            for name in ("DSHSupportscanner.objc.h", "SupportScanner.h", "Universe.objc.h", "ref.h"):
                (base / "Headers" / name).write_text("DSHSupportscannerNewOperation DSHSupportscannerRulesDigest DSHSupportscannerOperation DSHSupportscannerResult")
            (base / "Modules/module.modulemap").write_text('framework module "SupportScanner" {}')
            if row["SupportedPlatform"] == "macos":
                for name, target in MAC_LINKS.items():
                    (folder / name).symlink_to(target)
        files, links, libraries = framework_entries(self.framework)
        builders = [{"path": name, "sha256": hashlib.sha256(subprocess.check_output(
            ["git", "show", self.commit + ":" + name], cwd=self.repository)).hexdigest()} for name in BUILD_FILES]
        manifest = {"source": write_proxy(source, self.root / "proxy"), "builderFiles": builders,
                    "files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())],
                    "links": links, "libraries": [{**row, "bytes": len(files[row["binary"]]), "sha256": hashlib.sha256(files[row["binary"]]).hexdigest()} for row in libraries],
                    "modules": [{"licenses": [{"path": "fixture/LICENSE", "sha256": hashlib.sha256(b"module license").hexdigest()}]}],
                    "goLicenseSha256": hashlib.sha256(b"go license").hexdigest()}
        archive = package_apple(files, links, manifest, {"go/LICENSE": b"go license", "fixture/LICENSE": b"module license"})
        (self.directory / "support-scanner-apple.zip").write_bytes(archive)
        self.receipt = {"schemaVersion": 1, "status": "BUILT", "staticVerification": "PASS", "sourceSha": self.commit, "treeSha": source.tree,
                        "artifact": "support-scanner-apple.zip", "bytes": len(archive), "sha256": hashlib.sha256(archive).hexdigest(), "manifest": manifest}
        self.proof = {"schemaVersion": 1, "status": "PASS", "sourceSha": self.commit, "treeSha": source.tree,
                      "scannerArchiveSha256": self.receipt["sha256"], "simulatorDeleted": True,
                      "binaries": [{"platform": platform, "path": platform, "sha256": "a" * 64} for platform in ("macos", "ios-simulator")],
                      "observations": [{"schemaVersion": 1, "status": "PASS", "platform": platform, "architecture": "arm64",
                                        "assertions": 23, "scannerVersion": "8.30.1", "rulesDigest": "a" * 64}
                                       for platform in ("macos", "ios-simulator")]}
        self.verification = self.root / "verification.json"
        self.output = self.root / "staged"

    def stage(self):
        (self.directory / "scanner.json").write_text(json.dumps(self.receipt))
        self.verification.write_text(json.dumps(self.proof))
        return stage_apple(self.repository, self.commit, directory=self.directory, framework=self.framework,
                           verification=self.verification, output=self.output)

    def test_preserves_framework_identity_provenance_and_all_license_bytes(self):
        result = self.stage()
        self.assertEqual(result["status"], "STAGED")
        self.assertEqual(result["applicationExecution"], "NOT_EXECUTED")
        self.assertEqual(framework_entries(self.framework), framework_entries(self.output / "SupportScanner.xcframework"))
        resources = self.output / "SupportScannerResources"
        self.assertEqual((resources / "licenses/fixture/LICENSE").read_bytes(), b"module license")
        self.assertEqual((resources / "licenses/go/LICENSE").read_bytes(), b"go license")
        self.assertEqual(json.loads((resources / "identity.json").read_bytes())["rulesDigest"], "a" * 64)
        self.assertEqual((resources / "scanner.json").read_bytes(), (self.directory / "scanner.json").read_bytes())
        self.assertEqual((resources / "verification.json").read_bytes(), self.verification.read_bytes())
        with self.assertRaisesRegex(ValueError, "must be new"):
            self.stage()

    def test_refuses_changed_source_builders_and_compiler_inputs_before_staging(self):
        mutations = [lambda value: value.update(sourceSha="b" * 40), lambda value: value.update(schemaVersion=True),
                     lambda value: value["manifest"]["source"].update(sourceArchiveSha256="b" * 64),
                     lambda value: value["manifest"]["builderFiles"][0].update(sha256="b" * 64),
                     lambda value: value["manifest"]["files"][0].update(sha256="b" * 64),
                     lambda value: value["manifest"]["libraries"].pop()]
        original = copy.deepcopy(self.receipt)
        for mutate in mutations:
            self.receipt = copy.deepcopy(original); mutate(self.receipt)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.stage()
            self.assertFalse(self.output.exists())

    def test_refuses_incomplete_native_proof_and_mismatched_rules_before_staging(self):
        mutations = [lambda value: value.update(sourceSha="b" * 40), lambda value: value.update(scannerArchiveSha256="b" * 64),
                     lambda value: value.update(schemaVersion=True), lambda value: value["binaries"].pop(),
                     lambda value: value["binaries"][0].update(sha256="invalid"),
                     lambda value: value["binaries"][1].update(path="private/location"),
                     lambda value: value.update(simulatorDeleted=False), lambda value: value["observations"].pop(),
                     lambda value: value["observations"][0].update(assertions=22),
                     lambda value: value["observations"][1].update(rulesDigest="b" * 64)]
        original = copy.deepcopy(self.proof)
        for mutate in mutations:
            self.proof = copy.deepcopy(original); mutate(self.proof)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                self.stage()
            self.assertFalse(self.output.exists())

    def test_refuses_tampered_archive_and_native_framework(self):
        archive = self.directory / "support-scanner-apple.zip"
        original = archive.read_bytes(); archive.write_bytes(original + b"tamper")
        with self.assertRaisesRegex(ValueError, "digest"):
            self.stage()
        archive.write_bytes(original)
        (self.framework / "ios-arm64/SupportScanner.framework/SupportScanner").write_bytes(b"!<arch>\nchanged")
        with self.assertRaisesRegex(ValueError, "compiler inputs"):
            self.stage()
        self.assertFalse(self.output.exists())

    def test_refuses_output_inside_an_input_or_an_existing_link(self):
        self.output = self.framework / "nested"
        with self.assertRaisesRegex(ValueError, "disjoint"):
            self.stage()
        self.output = self.root / "link"; self.output.symlink_to(self.root / "absent")
        with self.assertRaisesRegex(ValueError, "must be new"):
            self.stage()


if __name__ == "__main__":
    unittest.main()
