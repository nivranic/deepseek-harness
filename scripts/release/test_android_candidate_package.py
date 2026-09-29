"""Reject altered Android candidate payloads, incorrect release identities, and insufficient ELF alignment."""
import hashlib
import tempfile
import unittest
from pathlib import Path
import zipfile

from android_candidate_package import certificate_identity, elf_load_alignment, extract_universal_apk, manifest_identity, verify_payload_identity
from android_sbom_inventory import InventoryError

MANIFEST = b'''<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.deepseek.harness.companion"
android:versionCode="1" android:versionName="0.1.2-alpha.1"><uses-sdk android:minSdkVersion="33" android:targetSdkVersion="36"/>
<application><meta-data android:name="ai.deepseek.dsh.distributionChannel" android:value="dev"/>
<activity android:name=".MainActivity"><intent-filter><action android:name="android.intent.action.MAIN"/>
<category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity></application></manifest>'''


class AndroidCandidatePackageTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='dsh-android-candidate-package-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()

    def archive(self, name, members):
        output = self.work / name
        with zipfile.ZipFile(output, 'w') as archive:
            for path, content in members.items():
                archive.writestr(path, content)
        return output

    def test_extracts_only_the_universal_apk_and_does_not_overwrite(self):
        apks = self.archive('app.apks', {'universal.apk': b'actual APK bytes', 'toc.pb': b'table'})
        apk = self.work / 'app.apk'
        extract_universal_apk(apks, apk)
        self.assertEqual(apk.read_bytes(), b'actual APK bytes')
        with self.assertRaises(FileExistsError):
            extract_universal_apk(apks, apk)
        for members in [{'splits/base.apk': b'data'}, {'universal.apk': b'data', 'feature.apk': b'extra'}, {'../universal.apk': b'escape'}]:
            with self.subTest(members=list(members)), self.assertRaises(InventoryError):
                extract_universal_apk(self.archive('invalid.apks', members), self.work / 'other.apk')

    def test_binds_all_dex_and_native_bytes_to_the_preserved_unsigned_bundle(self):
        bundle = self.archive('app.aab', {'base/dex/classes.dex': b'dex', 'base/dex/classes2.dex': b'more', 'base/lib/x86_64/native.so': b'elf'})
        entries = {'classes.dex': b'dex', 'classes2.dex': b'more', 'lib/x86_64/native.so': b'elf'}
        apk = self.archive('app.apk', entries)
        receipt = verify_payload_identity(bundle, apk)
        self.assertEqual(len(receipt['dex']), 2)
        self.assertEqual(len(receipt['native']), 1)
        for changed in [{**entries, 'classes2.dex': b'changed'}, {**entries, 'lib/x86_64/native.so': b'changed'},
                        {'classes.dex': b'dex'}, {**entries, 'classes3.dex': b'extra'}]:
            with self.subTest(changed=list(changed)), self.assertRaises(InventoryError):
                verify_payload_identity(bundle, self.archive('changed.apk', changed))
        signed = self.archive('signed.aab', {'base/dex/classes.dex': b'dex', 'META-INF/SIGNER.RSA': b'signature'})
        with self.assertRaisesRegex(InventoryError, 'unsigned'):
            verify_payload_identity(signed, apk)

    def test_verifies_the_release_launcher_and_product_identity(self):
        receipt = manifest_identity(MANIFEST, '0.1.2-alpha.1', 1, 'dev')
        self.assertEqual(receipt['launcher'], 'com.deepseek.harness.companion/com.deepseek.harness.companion.MainActivity')
        for old, new in [(b'versionCode="1"', b'versionCode="2"'), (b'android:value="dev"', b'android:value="beta"'),
                         (b'targetSdkVersion="36"', b'targetSdkVersion="35"'),
                         (b'<application>', b'<application android:debuggable="true">'),
                         (b'<application>', b'<application android:testOnly="true">'),
                         (b'android.intent.category.LAUNCHER', b'not.a.launcher')]:
            with self.subTest(change=new), self.assertRaises(InventoryError):
                manifest_identity(MANIFEST.replace(old, new), '0.1.2-alpha.1', 1, 'dev')

    def test_accepts_only_the_generated_certificate_with_exactly_one_signer(self):
        certificate = self.work / 'certificate.der'
        certificate.write_bytes(b'controlled certificate')
        digest = hashlib.sha256(certificate.read_bytes()).hexdigest()
        for prefix in ['Signer #1 ', 'Signer (minSdkVersion=33, maxSdkVersion=2147483647): ']:
            valid = 'Number of signers: 1\n' + prefix + 'certificate SHA-256 digest: ' + digest + '\n'
            self.assertEqual(certificate_identity(valid, certificate), digest)
            for changed in [valid.replace(digest, '0' * 64), valid.replace('signers: 1', 'signers: 2'), valid + valid]:
                with self.assertRaises(InventoryError):
                    certificate_identity(changed, certificate)

    def test_checks_every_64_bit_load_alignment_and_offset_congruence(self):
        valid = '  Class: ELF64\n  LOAD 0x000000 0x000000 0x000000 0x010 0x010 R E 0x4000\n'
        self.assertEqual(elf_load_alignment(valid)['loadAlignments'], [16384])
        for changed in [valid.replace('0x4000', '0x1000'), valid.replace('0x4000', '0x6000'),
                        valid.replace('LOAD 0x000000', 'LOAD 0x001000'), valid + '  LOAD broken\n', 'Class: ELF64\n']:
            with self.subTest(changed=changed), self.assertRaises(InventoryError):
                elf_load_alignment(changed)
        self.assertEqual(elf_load_alignment(valid.replace('ELF64', 'ELF32').replace('0x4000', '0x1000'))['elfClass'], 'ELF32')


if __name__ == '__main__':
    unittest.main()
