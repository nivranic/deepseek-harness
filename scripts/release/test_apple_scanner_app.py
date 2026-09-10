"""Final application inspection rejects missing notices and substituted native module graphs."""

import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from release.apple_scanner_app import application_paths, linked_modules, packaged_resources
from release.mobile_scanner_source import MODULE


class AppleScannerAppTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="dsh-apple-app-scanner-")
        self.addCleanup(self.temporary.cleanup)
        self.resources = Path(self.temporary.name) / "resources"
        self.resources.mkdir()
        self.source = "a" * 40
        self.identity = {"sourceSha": self.source, "treeSha": "b" * 40, "archiveSha256": "c" * 64}
        self.receipt = {"sourceSha": self.source, "treeSha": "b" * 40, "sha256": "c" * 64}
        files = {"identity.json": json.dumps(self.identity).encode(), "scanner.json": json.dumps(self.receipt).encode(),
                 "verification.json": b'{"status":"PASS"}', "licenses/go/LICENSE": b"Go license", "licenses/module/LICENSE": b"module license"}
        self.stage = {"schemaVersion": 1, "status": "STAGED", "sourceSha": self.source, "treeSha": "b" * 40,
                      "scannerArchiveSha256": "c" * 64, "identity": self.identity, "resources": []}
        for name, data in sorted(files.items()):
            path = self.resources / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            self.stage["resources"].append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})

    def test_requires_all_packaged_provenance_and_notices_without_extra_files(self):
        self.assertEqual(packaged_resources(self.resources, self.stage, self.source), self.receipt)
        notice = self.resources / "licenses/module/LICENSE"
        notice.write_bytes(b"changed value")
        with self.assertRaisesRegex(ValueError, "inventory"):
            packaged_resources(self.resources, self.stage, self.source)
        notice.write_bytes(b"module licensE")
        with self.assertRaisesRegex(ValueError, "digest"):
            packaged_resources(self.resources, self.stage, self.source)
        notice.unlink()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            packaged_resources(self.resources, self.stage, self.source)
        notice.write_bytes(b"module license")
        (self.resources / "unexpected").write_bytes(b"extra")
        with self.assertRaisesRegex(ValueError, "inventory"):
            packaged_resources(self.resources, self.stage, self.source)

    def test_refuses_stale_identity_and_unsafe_resource_records(self):
        mutations = [lambda value: value.update(schemaVersion=True), lambda value: value.update(sourceSha="d" * 40),
                     lambda value: value["resources"][0].update(path="../outside"),
                     lambda value: value["resources"][0].update(path="/outside"),
                     lambda value: value["resources"][0].update(path="C:/outside"),
                     lambda value: value["resources"][0].update(bytes=True),
                     lambda value: value["resources"][0].update(bytes=16 * 1024 * 1024 + 1),
                     lambda value: value["resources"][0].update(sha256="invalid"),
                     lambda value: value["resources"].append(copy.deepcopy(value["resources"][0])),
                     lambda value: value.update(treeSha="d" * 40),
                     lambda value: value.update(scannerArchiveSha256="d" * 64)]
        for mutate in mutations:
            stage = copy.deepcopy(self.stage); mutate(stage)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                packaged_resources(self.resources, stage, self.source)

    @unittest.skipIf(sys.platform == "win32", "POSIX resource-link rejection fixture")
    def test_refuses_linked_resources_even_when_the_target_has_expected_bytes(self):
        notice = self.resources / "licenses/module/LICENSE"
        target = Path(self.temporary.name) / "notice"; target.write_bytes(notice.read_bytes())
        notice.unlink(); notice.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "links"):
            packaged_resources(self.resources, self.stage, self.source)

    @unittest.skipIf(sys.platform == "win32", "POSIX application parent-link rejection fixture")
    def test_application_paths_reject_linked_roots_and_external_parent_directories(self):
        root = Path(self.temporary.name)
        app = root / "app"; app.mkdir()
        (app / "DSH Companion").write_bytes(b"executable")
        self.assertEqual(application_paths(app, "ios"), (app, app, app / "DSH Companion"))
        alias = root / "alias"; alias.symlink_to(app)
        with self.assertRaisesRegex(ValueError, "regular directory"):
            application_paths(alias, "ios")
        (app / "DSH Companion").unlink(); (app / "DSH Companion").symlink_to(self.resources / "scanner.json")
        with self.assertRaisesRegex(ValueError, "regular file"):
            application_paths(app, "ios")
        outside = root / "outside"; outside.mkdir()
        (outside / "Resources").mkdir(); (outside / "MacOS").mkdir()
        (outside / "MacOS/DSH Companion").write_bytes(b"executable")
        (app / "Contents").symlink_to(outside)
        with self.assertRaisesRegex(ValueError, "leave the application"):
            application_paths(app, "macos")

    def test_final_go_graph_requires_source_version_compiler_platform_and_module_checksums(self):
        version = "v0.0.0-20260910000000-" + "a" * 12
        checksum = "h1:" + "a" * 43 + "="
        info = {"GoVersion": "go1.27.1", "Path": "gobind/gobind", "Main": {"Path": "gobind"},
                "Settings": [{"Key": key, "Value": value} for key, value in {
                    "GOOS": "ios", "GOARCH": "arm64", "CGO_ENABLED": "1", "-buildmode": "c-archive", "-trimpath": "true"}.items()],
                "Deps": [{"Path": MODULE, "Version": version, "Sum": checksum}]}
        manifest = {"toolchain": {"goVersion": "1.27.1"}, "source": {"moduleVersion": version},
                    "modules": [{"module": MODULE, "version": version, "sum": checksum, "licenses": []}]}
        self.assertEqual(linked_modules(info, manifest, "ios", "arm64"), [{"module": MODULE, "version": version, "sum": checksum}])
        for platform, architecture in [("macos", "arm64"), ("ios", "x86_64")]:
            with self.subTest(platform=platform), self.assertRaises(ValueError):
                linked_modules(info, manifest, platform, architecture)
        mutations = [lambda value: value.update(GoVersion="go1.27.2"), lambda value: value["Deps"][0].update(Version="v0.0.1"),
                     lambda value: value["Deps"][0].update(Sum="h1:" + "b" * 43 + "="),
                     lambda value: value["Deps"][0].update(Replace={"Path": "local"})]
        for mutate in mutations:
            changed = copy.deepcopy(info); mutate(changed)
            with self.subTest(mutate=mutate), self.assertRaises(ValueError):
                linked_modules(changed, manifest, "ios", "arm64")


if __name__ == "__main__":
    unittest.main()
