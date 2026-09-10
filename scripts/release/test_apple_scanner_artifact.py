"""Structural rejection fixtures do not substitute for an Apple compiler or native execution."""

import copy
import hashlib
import io
import json
from pathlib import Path
import plistlib
import stat
import sys
import tempfile
import unittest
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.apple_scanner_artifact import apple_dependencies, apple_policy, framework_entries, framework_libraries, native_observation, package_apple, verify_archived_framework
from release.mobile_scanner_source import MODULE


def index():
    """An independently declared device, simulator and Mac framework index."""
    return {"XCFrameworkFormatVersion": "1.0", "CFBundlePackageType": "XFWK", "AvailableLibraries": [
        {"LibraryIdentifier": "ios-arm64", "LibraryPath": "SupportScanner.framework", "SupportedArchitectures": ["arm64"], "SupportedPlatform": "ios"},
        {"LibraryIdentifier": "ios-arm64_x86_64-simulator", "LibraryPath": "SupportScanner.framework", "SupportedArchitectures": ["arm64", "x86_64"], "SupportedPlatform": "ios", "SupportedPlatformVariant": "simulator"},
        {"LibraryIdentifier": "macos-arm64_x86_64", "LibraryPath": "SupportScanner.framework", "SupportedArchitectures": ["arm64", "x86_64"], "SupportedPlatform": "macos"},
    ]}


class AppleScannerArtifactTests(unittest.TestCase):
    def test_distributable_archive_must_match_bytes_and_link_semantics(self):
        files = {"ios-arm64/SupportScanner.framework/SupportScanner": b"native fixture"}
        links = {"macos-arm64_x86_64/SupportScanner.framework/Versions/Current": "A"}
        manifest = {"modules": [], "goLicenseSha256": hashlib.sha256(b"license").hexdigest()}
        data = package_apple(files, links, manifest, {"go/LICENSE": b"license"})
        verify_archived_framework(data, files, links, manifest)
        for failure in ("bytes", "link-type", "license", "extra"):
            output = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(data)) as source, zipfile.ZipFile(output, "w") as destination:
                for entry in source.infolist():
                    content = source.read(entry)
                    if failure == "link-type" and stat.S_IFMT(entry.external_attr >> 16) == stat.S_IFLNK:
                        entry.external_attr = (stat.S_IFREG | 0o644) << 16
                    if failure == "bytes" and entry.filename.endswith("/SupportScanner") or failure == "license" and entry.filename.endswith("/LICENSE"):
                        content = b"changed"
                    destination.writestr(entry, content)
                if failure == "extra": destination.writestr("../unexpected", b"extra")
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                verify_archived_framework(output.getvalue(), files, links, manifest)

    def test_native_observation_refuses_incomplete_counts_identity_and_private_fields(self):
        value = {"schemaVersion": 1, "status": "PASS", "platform": "ios-simulator", "architecture": "arm64", "assertions": 23,
                 "scannerVersion": "8.30.1", "rulesDigest": "a" * 64}
        self.assertEqual(native_observation(value, "ios-simulator", "arm64"), value)
        for key, entry in [("assertions", 22), ("assertions", True), ("platform", "macos"), ("architecture", "x86_64"),
                           ("status", "SKIP"), ("rulesDigest", "private output"), ("scannerVersion", "8.30.2"), ("extra", "private")]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                native_observation({**value, key: entry}, "ios-simulator", "arm64")

    def test_framework_matrix_refuses_missing_extra_repeated_and_mislabeled_slices(self):
        self.assertEqual(len(framework_libraries(index())), 3)
        mutations = [lambda v: v["AvailableLibraries"].pop(),
                     lambda v: v["AvailableLibraries"].append(copy.deepcopy(v["AvailableLibraries"][0])),
                     lambda v: v["AvailableLibraries"][1].update(SupportedPlatformVariant="maccatalyst"),
                     lambda v: v["AvailableLibraries"][0].update(LibraryIdentifier="../outside"),
                     lambda v: v["AvailableLibraries"][0].update(LibraryPath="Other.framework"),
                     lambda v: v["AvailableLibraries"][0].update(SupportedArchitectures=["arm64", "arm64"]),
                     lambda v: v["AvailableLibraries"][0].update(SupportedArchitectures=[False]),
                     lambda v: v["AvailableLibraries"][2].update(SupportedPlatform="ios"),
                     lambda v: v.update(XCFrameworkFormatVersion="2.0")]
        for mutate in mutations:
            value = index(); mutate(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                framework_libraries(value)

    def test_policy_requires_explicit_xcode_and_deployment_versions(self):
        policy = json.loads((Path(__file__).resolve().parents[2] / "native/support-scanner/apple-build.json").read_bytes())
        self.assertEqual(apple_policy(policy), policy)
        for key, value in [("schemaVersion", True), ("xcodeVersion", "latest"), ("xcodeBuild", "16F6 or newer"),
                           ("minimumIOSVersion", 17), ("minimumMacOSVersion", "14.*"), ("extra", False)]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                apple_policy({**policy, key: value})

    def test_native_metadata_cannot_claim_a_different_platform_or_source(self):
        version = "v0.0.0-20260910000000-" + "a" * 12
        info = {"Path": "gobind/gobind", "Main": {"Path": "gobind"},
                "Settings": [{"Key": key, "Value": value} for key, value in {
                    "GOOS": "ios", "GOARCH": "arm64", "CGO_ENABLED": "1", "-buildmode": "c-archive", "-trimpath": "true"}.items()],
                "Deps": [{"Path": MODULE, "Version": version, "Sum": "h1:" + "a" * 43 + "="}]}
        self.assertEqual(apple_dependencies(info, version, "ios", "arm64")[0]["module"], MODULE)
        for platform, arch in [("macos", "arm64"), ("ios", "x86_64"), ("watchos", "arm64")]:
            with self.subTest(platform=platform, arch=arch), self.assertRaises(ValueError):
                apple_dependencies(info, version, platform, arch)
        for update in [{"Version": "v0.0.1"}, {"Sum": ""}, {"Replace": {"Path": "local"}}]:
            changed = copy.deepcopy(info); changed["Deps"][0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                apple_dependencies(changed, version, "ios", "arm64")

    @unittest.skipIf(sys.platform == "win32", "The framework fixture requires POSIX symlink creation")
    def test_framework_inventory_preserves_only_the_exact_version_links(self):
        with tempfile.TemporaryDirectory(prefix="dsh-apple-framework-") as temporary:
            root = Path(temporary) / "SupportScanner.xcframework"; root.mkdir()
            (root / "Info.plist").write_bytes(plistlib.dumps(index()))
            for row in index()["AvailableLibraries"]:
                folder = root / row["LibraryIdentifier"] / "SupportScanner.framework"
                base = folder / "Versions/A" if row["SupportedPlatform"] == "macos" else folder
                (base / "Headers").mkdir(parents=True); (base / "Modules").mkdir()
                (base / "SupportScanner").write_bytes(b"!<arch>\nstructural fixture")
                info_dir = base / "Resources" if row["SupportedPlatform"] == "macos" else base
                info_dir.mkdir(exist_ok=True); (info_dir / "Info.plist").write_bytes(plistlib.dumps({"CFBundleExecutable": "SupportScanner"}))
                for name in ["DSHSupportscanner.objc.h", "SupportScanner.h", "Universe.objc.h", "ref.h"]:
                    (base / "Headers" / name).write_text("DSHSupportscannerNewOperation DSHSupportscannerRulesDigest DSHSupportscannerOperation DSHSupportscannerResult")
                (base / "Modules/module.modulemap").write_text('framework module "SupportScanner" {}')
                if row["SupportedPlatform"] == "macos":
                    for name, target in {"Versions/Current": "A", "Headers": "Versions/Current/Headers", "Modules": "Versions/Current/Modules",
                                         "Resources": "Versions/Current/Resources", "SupportScanner": "Versions/Current/SupportScanner"}.items():
                        (folder / name).symlink_to(target)
            files, links, libraries = framework_entries(root)
            first = package_apple(files, links, {"sourceSha": "a" * 40}, {"go/LICENSE": b"license"})
            self.assertEqual(first, package_apple(dict(reversed(list(files.items()))), links, {"sourceSha": "a" * 40}, {"go/LICENSE": b"license"}))
            with zipfile.ZipFile(io.BytesIO(first)) as zipped:
                for name, target in links.items():
                    entry = zipped.getinfo("SupportScanner.xcframework/" + name)
                    self.assertEqual(stat.S_IFMT(entry.external_attr >> 16), stat.S_IFLNK)
                    self.assertEqual(zipped.read(entry).decode(), target)
            link = root / "macos-arm64_x86_64/SupportScanner.framework/Headers"
            link.unlink(); link.symlink_to(Path(temporary))
            with self.assertRaisesRegex(ValueError, "unapproved"):
                framework_entries(root)
            link.unlink(); link.symlink_to("Versions/Current/Headers")
            unexpected = root / libraries[0]["headers"] / "unexpected.h"; unexpected.write_text("extra")
            with self.assertRaisesRegex(ValueError, "undeclared native"):
                framework_entries(root)
            unexpected.unlink()
            (root / libraries[0]["headers"] / "ref.h").unlink()
            with self.assertRaisesRegex(ValueError, "missing native"):
                framework_entries(root)


if __name__ == "__main__":
    unittest.main()
