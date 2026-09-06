"""Exercise Gradle signing after unsigned bundle validation has populated the offline build cache."""

import os
import hashlib
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
ANDROID = ROOT / "apps" / "android"
PREFIX = "DSH_ANDROID_SIGNING_"
SENTINEL = "signing-input-must-not-appear-in-diagnostics"


class AndroidSigningConfiguration(unittest.TestCase):
    def configure(self, values, tasks=(":app:help",)):
        environment = {name: value for name, value in os.environ.items() if not name.startswith(PREFIX)}
        environment.update({PREFIX + name: value for name, value in values.items()})
        wrapper = str(ANDROID / ("gradlew.bat" if os.name == "nt" else "gradlew"))
        result = subprocess.run(
            [wrapper, "--offline", "--no-daemon", *tasks], cwd=ANDROID, env=environment,
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600,
        )
        output = result.stdout + result.stderr
        self.assertNotIn(SENTINEL, output)
        return result.returncode, output

    def test_keystore_signs_release_apk_without_changing_the_validated_bundle(self):
        bundle = ANDROID / "app/build/outputs/bundle/release/app-release.aab"
        before = hashlib.sha256(bundle.read_bytes()).hexdigest()
        suffix = ".exe" if os.name == "nt" else ""
        keytool = Path(os.environ["JAVA_HOME"]) / "bin" / ("keytool" + suffix)
        build_tools = Path(os.environ["ANDROID_HOME"]) / "build-tools"
        versions = sorted((path for path in build_tools.iterdir() if re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", path.name)),
                          key=lambda path: tuple(int(part) for part in path.name.split(".")), reverse=True)
        apksigner = next(path / ("apksigner.bat" if os.name == "nt" else "apksigner") for path in versions
                         if (path / ("apksigner.bat" if os.name == "nt" else "apksigner")).is_file())
        with tempfile.TemporaryDirectory(prefix="dsh-signing-key-") as temporary:
            store = Path(temporary) / "candidate.keystore"
            certificate = Path(temporary) / "certificate.der"
            key_environment = {**os.environ, "DSH_SIGNING_TEST_PASSWORD": SENTINEL}
            for arguments in (
                ["-genkeypair", "-storetype", "JKS", "-keypass:env", "DSH_SIGNING_TEST_PASSWORD", "-keyalg", "RSA",
                 "-keysize", "2048", "-validity", "2", "-dname", "CN=Android Debug,O=Android,C=US", "-noprompt"],
                ["-exportcert", "-file", str(certificate)],
            ):
                generated = subprocess.run(
                    [str(keytool), *arguments, "-keystore", str(store), "-alias", "androiddebugkey",
                     "-storepass:env", "DSH_SIGNING_TEST_PASSWORD"], env=key_environment,
                    capture_output=True, text=True, timeout=60,
                )
                self.assertEqual(generated.returncode, 0, "temporary debug keystore operation failed")
            code, output = self.configure({
                "MODE": "keystore", "STORE_FILE": str(store), "STORE_PASSWORD": SENTINEL,
                "KEY_ALIAS": "androiddebugkey", "KEY_PASSWORD": SENTINEL,
            }, ("--no-configuration-cache", ":app:assembleRelease"))
            self.assertEqual(code, 0, output)
            verified = subprocess.run(
                [str(apksigner), "verify", "--verbose", "--print-certs",
                 str(ANDROID / "app/build/outputs/apk/release/app-release.apk")], capture_output=True, text=True, timeout=60,
            )
            self.assertEqual(verified.returncode, 0, verified.stdout + verified.stderr)
            self.assertIn("Number of signers: 1", verified.stdout)
            digests = re.findall(r"(?m)^[^\n]*: certificate SHA-256 digest: ([0-9a-f]{64})\s*$", verified.stdout)
            self.assertEqual(set(digests), {hashlib.sha256(certificate.read_bytes()).hexdigest()})
        self.assertEqual(hashlib.sha256(bundle.read_bytes()).hexdigest(), before)

    def test_unsigned_default_and_explicit_mode(self):
        for values in ({}, {"MODE": "unsigned"}):
            with self.subTest(values=values):
                code, output = self.configure(values)
                self.assertEqual(code, 0, output)

    def test_rejects_unknown_mode_without_echoing_it(self):
        code, output = self.configure({"MODE": SENTINEL})
        self.assertNotEqual(code, 0)
        self.assertIn("DSH_ANDROID_SIGNING_MODE must be unsigned or keystore", output)

    def test_unsigned_rejects_supplied_signing_material(self):
        code, output = self.configure({"STORE_PASSWORD": SENTINEL})
        self.assertNotEqual(code, 0)
        self.assertIn("Unsigned Android builds must not receive", output)

    def test_keystore_requires_every_field_without_echoing_material(self):
        names = ("STORE_FILE", "STORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD")
        for absent in names:
            with self.subTest(absent=absent):
                code, output = self.configure({
                    "MODE": "keystore", **{name: SENTINEL for name in names if name != absent},
                })
                self.assertNotEqual(code, 0)
                self.assertIn("Keystore mode requires DSH_ANDROID_SIGNING_" + absent, output)

    def test_keystore_rejects_relative_missing_and_directory_paths(self):
        with tempfile.TemporaryDirectory(prefix="dsh-signing-admission-") as temporary:
            for path in ("relative.keystore", str(Path(temporary) / "missing.keystore"), temporary):
                with self.subTest(path=path):
                    code, output = self.configure({
                        "MODE": "keystore", "STORE_FILE": path, "STORE_PASSWORD": SENTINEL,
                        "KEY_ALIAS": SENTINEL, "KEY_PASSWORD": SENTINEL,
                    })
                    self.assertNotEqual(code, 0)
                    self.assertIn("DSH_ANDROID_SIGNING_STORE_FILE must name an absolute readable keystore file", output)


if __name__ == "__main__":
    unittest.main()
