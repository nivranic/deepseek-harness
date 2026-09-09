"""Structural artifact checks reject altered JNI metadata, module identity and archive members."""

import copy
import io
import json
from pathlib import Path
import stat
import struct
import sys
import tempfile
import unittest
import warnings
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.mobile_scanner_artifact import (
    ANDROID_LIBRARIES, JAVA_PACKAGE, android_entries, archive_entries, build_dependencies,
    canonical_archive, inspect_android_elf, license_files, package_android,
)
from release.mobile_scanner_source import MODULE


def elf(abi, *, alignment=16384, kind=3, file_size=256):
    data = bytearray(256)
    data[:6] = b"\x7fELF\x02\x01"
    struct.pack_into("<HHIQQQIHHHHHH", data, 16, kind, ANDROID_LIBRARIES[abi][0], 1, 0, 64, 0, 0, 64, 56, 1, 0, 0, 0)
    struct.pack_into("<IIQQQQQQ", data, 64, 1, 5, 0, 0, 0, file_size, file_size, alignment)
    return bytes(data)


def aar_members():
    prefix = JAVA_PACKAGE.replace(".", "/") + "/supportscanner/"
    classes = {prefix + name + ".class": b"class fixture" for name in ("Supportscanner", "Operation", "Result")}
    classes["go/Seq.class"] = b"sequence fixture"
    return {
        "AndroidManifest.xml": b'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><uses-sdk android:minSdkVersion="33"/></manifest>',
        "classes.jar": canonical_archive(classes),
        "proguard.txt": ("-keep class go.** { *; }\n-keep class " + JAVA_PACKAGE + ".** { *; }\n").encode(),
        **{"jni/" + abi + "/libgojni.so": elf(abi) for abi in ANDROID_LIBRARIES},
    }


class MobileScannerArtifactTests(unittest.TestCase):
    def test_canonical_archive_ignores_insertion_order(self):
        entries = {"z.txt": b"last", "a.txt": b"first"}
        self.assertEqual(canonical_archive(entries), canonical_archive(dict(reversed(list(entries.items())))))
        self.assertEqual(archive_entries(canonical_archive(entries)), entries)

    def test_zip_refuses_duplicates_links_and_path_aliases(self):
        for name in ["../outside", "/absolute", "C:outside", "a\\b", "a/./b", "a//b", "a\0b"]:
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as archive:
                entry = zipfile.ZipInfo("placeholder")
                entry.filename = name
                entry.orig_filename = name
                archive.writestr(entry, b"fixture")
            with self.subTest(name=name), self.assertRaises(ValueError):
                archive_entries(data.getvalue())
        for duplicate in [False, True]:
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as archive:
                entry = zipfile.ZipInfo("entry")
                entry.external_attr = ((stat.S_IFREG if duplicate else stat.S_IFLNK) | 0o644) << 16
                archive.writestr(entry, b"fixture")
                if duplicate:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore", UserWarning)
                        archive.writestr(zipfile.ZipInfo("entry"), b"second")
            with self.assertRaises(ValueError):
                archive_entries(data.getvalue())

    def test_elf_requires_shared_architecture_ranges_and_page_alignment(self):
        for abi in ANDROID_LIBRARIES:
            self.assertEqual(inspect_android_elf(elf(abi), abi)["loadSegments"][0]["alignment"], 16384)
            for malformed in [elf(abi, alignment=4096), elf(abi, alignment=24576), elf(abi, kind=2),
                              elf(abi, file_size=257), elf(abi)[:80]]:
                with self.subTest(abi=abi), self.assertRaises(ValueError):
                    inspect_android_elf(malformed, abi)
        with self.assertRaises(ValueError):
            inspect_android_elf(elf("arm64-v8a"), "x86_64")

    def test_aar_requires_both_libraries_api_classes_and_r8_rules(self):
        entries, libraries = android_entries(canonical_archive(aar_members()), 33)
        self.assertEqual(len(libraries), 2)
        for key in ["proguard.txt", "classes.jar", "jni/arm64-v8a/libgojni.so"]:
            changed = dict(entries)
            del changed[key]
            with self.subTest(missing=key), self.assertRaises(ValueError):
                android_entries(canonical_archive(changed), 33)
        for key, value in [("proguard.txt", b"-dontwarn **\n"), ("classes.jar", canonical_archive({"go/Seq.class": b"fixture"}))]:
            with self.subTest(changed=key), self.assertRaises(ValueError):
                android_entries(canonical_archive({**entries, key: value}), 33)
        with self.assertRaises(ValueError):
            android_entries(canonical_archive(entries), 34)

    def test_build_info_keeps_checksummed_modules_without_local_replacements(self):
        version = "v0.0.0-20260909181324-0c0f7429360b"
        info = {"Path": "gobind/gobind", "Main": {"Path": "gobind"},
                "Settings": [{"Key": key, "Value": value} for key, value in {
                    "GOOS": "android", "GOARCH": "amd64", "CGO_ENABLED": "1", "-buildmode": "c-shared", "-trimpath": "true"}.items()],
                "Deps": [{"Path": MODULE, "Version": version, "Sum": "h1:" + "A" * 43 + "="}]}
        self.assertEqual(build_dependencies(info, version, "x86_64")[0]["version"], version)
        for update in [{"Replace": {"Path": "private directory"}}, {"Version": "v0.0.0"}, {"Sum": ""}]:
            changed = copy.deepcopy(info)
            changed["Deps"][0].update(update)
            with self.subTest(update=update), self.assertRaises(ValueError):
                build_dependencies(changed, version, "x86_64")
        changed = copy.deepcopy(info)
        changed["Deps"].append(changed["Deps"][0])
        with self.assertRaises(ValueError):
            build_dependencies(changed, version, "x86_64")
        with self.assertRaises(ValueError):
            build_dependencies(info, version, "arm64-v8a")
        changed = copy.deepcopy(info)
        changed["Settings"].append({"Key": "vcs.revision", "Value": "b" * 40})
        with self.assertRaisesRegex(ValueError, "VCS identity"):
            build_dependencies(changed, version, "x86_64")

    def test_license_collection_includes_dual_license_and_reuse_material(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                license_files(root)
            (root / "LICENSE-MIT").write_bytes(b"MIT fixture")
            (root / "LICENSE-APACHE").write_bytes(b"Apache fixture")
            (root / "LICENSES").mkdir()
            (root / "LICENSES/BSD-2-Clause.txt").write_bytes(b"BSD fixture")
            self.assertEqual(set(license_files(root)), {"LICENSE-MIT", "LICENSE-APACHE", "LICENSES/BSD-2-Clause.txt"})
            (root / "LICENSE-MIT").write_bytes(b"")
            with self.assertRaises(ValueError):
                license_files(root)

    def test_packaging_adds_manifest_and_notices_without_rewriting_native_bytes(self):
        original, _ = android_entries(canonical_archive(aar_members()), 33)
        manifest = {"schemaVersion": 1, "sourceSha": "a" * 40}
        result = package_android(original, manifest, {"module/LICENSE": b"license fixture"})
        packed = archive_entries(result)
        for name, data in original.items():
            self.assertEqual(packed[name], data)
        self.assertEqual(json.loads(packed["assets/dsh-support-scanner/manifest.json"]), manifest)
        self.assertEqual(packed["assets/dsh-support-scanner/licenses/module/LICENSE"], b"license fixture")
        with self.assertRaises(ValueError):
            package_android(packed, manifest, {})


if __name__ == "__main__":
    unittest.main()
