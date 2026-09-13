"""Scanner inventories bind actual archive bytes, compiler resource bytes and committed source declarations."""

import copy
import hashlib
import io
import json
import unittest
import zipfile

import test_mobile_scanner_source as source_fixtures
from android_sbom_scanner import scanner_inventory
from mobile_scanner_source import MODULE, read_source, write_proxy


def archive_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


class ScannerInventory(unittest.TestCase):
    def setUp(self):
        self.fixture = source_fixtures.MobileScannerSourceTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.root, self.repo = self.fixture.root, self.fixture.repo
        builders = ['scripts/build-mobile-support-scanner.py', 'scripts/release/mobile_scanner_build.py',
                    'scripts/release/mobile_scanner_source.py', 'scripts/release/mobile_scanner_artifact.py']
        policy = {'schemaVersion': 1, 'goVersion': '1.27.1'}
        for name in builders:
            path = self.repo / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_text('fixture builder\n')
        (self.repo / 'native/support-scanner/build.json').write_text(json.dumps(policy))
        self.fixture.git('add', '--', 'scripts', 'native/support-scanner/build.json')
        self.fixture.git('commit', '--quiet', '-m', 'builder fixture')
        commit = self.fixture.git('rev-parse', 'HEAD').decode().strip()
        source = read_source(self.repo, commit)
        self.files = {'classes.jar': archive_bytes({'go/Seq.class': b'fixture input class'}),
                      'jni/arm64-v8a/libgojni.so': b'fixture arm64 library', 'jni/x86_64/libgojni.so': b'fixture x64 library'}
        def notice(name):
            value = b'declared license material\n'
            self.files['assets/dsh-support-scanner/licenses/' + name] = value
            return {'path': name, 'sha256': hashlib.sha256(value).hexdigest()}
        self.manifest = {'schemaVersion': 1, 'source': write_proxy(source, self.root / 'source-proxy'), 'toolchain': policy,
                         'builderFiles': [{'path': name, 'sha256': hashlib.sha256((self.repo / name).read_bytes()).hexdigest()} for name in builders],
                         'libraries': [{'abi': abi, 'bytes': len(self.files['jni/' + abi + '/libgojni.so']),
                                        'sha256': hashlib.sha256(self.files['jni/' + abi + '/libgojni.so']).hexdigest()} for abi in ['arm64-v8a', 'x86_64']],
                         'modules': [{'module': MODULE, 'version': source.version, 'sum': 'h1:' + 'A' * 43 + '=', 'licenses': [notice('module/LICENSE')]}],
                         'toolchainLicenses': {'go': [notice('go/LICENSE')], 'androidNdk': [notice('ndk/NOTICE')]}}
        self.generated = self.root / 'R.jar'
        self.generated.write_bytes(archive_bytes({'go/supportscanner/gojni/R.class': b'fixture generated resource class'}))
        self.input = {'aar': str(self.root / 'support-scanner.aar'), 'receipt': str(self.root / 'scanner.json'), 'sourceSha': commit,
                      'generatedResourceJar': str(self.generated), 'generatedResourceJarSha256': hashlib.sha256(self.generated.read_bytes()).hexdigest()}
        self.receipt = {'schemaVersion': 1, 'sourceSha': commit, 'treeSha': source.tree, 'status': 'BUILT', 'staticVerification': 'PASS', 'manifest': self.manifest}
        self.publish()

    def publish(self):
        self.files['assets/dsh-support-scanner/manifest.json'] = json.dumps(self.manifest).encode()
        content = archive_bytes(self.files)
        (self.root / 'support-scanner.aar').write_bytes(content)
        self.receipt.update(bytes=len(content), sha256=hashlib.sha256(content).hexdigest())
        (self.root / 'scanner.json').write_text(json.dumps(self.receipt))

    def inspect(self):
        work = self.root / ('work-' + str(len(list(self.root.glob('work-*')))))
        work.mkdir()
        return scanner_inventory(self.input, self.repo, work)

    def test_attributes_jni_classes_generated_resources_and_go_license_material(self):
        result = self.inspect()
        self.assertEqual(result['natives']['x86_64/libgojni.so'][0]['ref'], result['root'])
        self.assertEqual(result['classes']['go.Seq'], {result['root']})
        self.assertEqual(set(result['generatedResourceClasses']), {'go.supportscanner.gojni.R'})
        self.assertEqual(result['material']['manifest'], self.manifest)
        self.assertEqual(len(result['components']), 2)
        self.assertTrue(result['components'][0]['licenses'][0]['license']['text']['content'])

    def test_refuses_outer_digest_change_and_generated_resource_change(self):
        with (self.root / 'support-scanner.aar').open('ab') as output: output.write(b'changed')
        with self.assertRaisesRegex(ValueError, 'receipt'):
            self.inspect()
        self.publish()
        self.generated.write_bytes(b'changed resource compiler output')
        with self.assertRaisesRegex(ValueError, 'resource compiler input changed'):
            self.inspect()

    def test_refuses_resealed_native_or_license_tampering(self):
        for name in ['jni/x86_64/libgojni.so', 'assets/dsh-support-scanner/licenses/module/LICENSE']:
            original = self.files[name]
            self.files[name] = b'changed'
            self.publish()
            with self.subTest(name=name), self.assertRaises(ValueError): self.inspect()
            self.files[name] = original
        self.publish()

    def test_refuses_resealed_source_builder_policy_and_module_forgery(self):
        original = copy.deepcopy(self.manifest)
        for mutate in [lambda m: m['source']['files'].pop(), lambda m: m['builderFiles'][0].update(sha256='0' * 64),
                       lambda m: m['toolchain'].update(goVersion='0.0.0'), lambda m: m['modules'].append(m['modules'][0]),
                       lambda m: m.update(schemaVersion=True)]:
            self.manifest = copy.deepcopy(original); self.receipt['manifest'] = self.manifest
            mutate(self.manifest); self.publish()
            with self.assertRaises(ValueError): self.inspect()
