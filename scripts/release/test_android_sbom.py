"""Exercise inventory rejection with small inputs and compiler-output fixtures; no Gradle build required."""

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from android_sbom import bom_document, json_bytes, publish, read_json, verify
from android_sbom_inventory import METADATA_PATH, archive_entries, maven_inventory, pom_licenses, read_file, sha_file, validate_graph
from android_sbom_payload import class_attribution, dexdump_classes, inspect_payload, mapping_records


def zip_bytes(files):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo()
            info.filename = name
            archive.writestr(info, content)
    return output.getvalue()


class AndroidInventory(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='dsh-android-inventory-test-', dir=Path(tempfile.gettempdir()).resolve())
        self.root = Path(self.temporary.name)
        self.assertEqual(self.root.resolve().parent, Path(tempfile.gettempdir()).resolve())
        self.addCleanup(self.temporary.cleanup)
        self.cache = self.root / 'caches/modules-2/files-2.1'
        self.native = b'\x7fELF controlled native bytes'
        self.artifact = zip_bytes({'classes.jar': zip_bytes({'lib/Owned.class': b'class'}), 'jni/x86_64/libsample.so': self.native})
        self.gav = ('org.example', 'sample', '1')
        for name in ('sample', 'bom'):
            directory = self.cache / 'org.example' / name / '1' / 'hash'
            directory.mkdir(parents=True)
            (directory / f'{name}.pom').write_text('<project><licenses><license><name>Apache-2.0</name></license></licenses></project>')
        self.aar = self.cache.joinpath(*self.gav, 'hash/sample.aar')
        self.aar.write_bytes(self.artifact)
        self.data = {'schemaVersion': 1, 'gradleUserHome': str(self.root), 'repositoryKinds': ['MAVEN_REPO'],
                     'libraries': [{'index': 0, 'group': 'org.example', 'name': 'sample', 'version': '1',
                                    'sha256': sha_file(self.aar), 'repositoryIndex': 0},
                                   {'index': 1, 'group': 'org.example', 'name': 'bom', 'version': '1',
                                    'sha256': '', 'repositoryIndex': None}],
                     'dependencies': [{'index': 0, 'dependsOn': [1, 1]}], 'modules': [{'name': 'base', 'dependsOn': [0]}]}
        self.mapping = self.root / 'mapping.txt'
        self.mapping_text = ('# compiler: R8\n# compiler_version: 8.10.24\n# min_api: 33\n# pg_map_id: example\n'
                             '# pg_map_hash: SHA-256 ' + '0' * 64 + '\n'
                             '# {"id":"com.android.tools.r8.mapping","version":"2.2"}\n'
                             'lib.Owned -> a:\napp.Main -> b:\ncore.Core -> c:\ngenerated.Synthetic -> d:\n'
                             '# {"id":"com.android.tools.r8.synthesized"}\n')
        self.mapping.write_text(self.mapping_text)
        self.data['projects'] = []
        for project, clazz in (('app', 'Main'), ('core', 'Core')):
            directory = self.root / project
            (directory / project).mkdir(parents=True)
            (directory / project / (clazz + '.class')).write_bytes(b'compiler output')
            self.data['projects'].append({'name': project, 'classes': str(directory)})
        self.sdk = self.root / 'sdk'
        dex_directory = self.sdk / 'build-tools/35.0.0'
        dex_directory.mkdir(parents=True)
        (dex_directory / ('dexdump.exe' if os.name == 'nt' else 'dexdump')).write_bytes(b'sdk executable')
        self.data['buildToolsVersion'] = '35.0.0'
        self.data['tools'] = {name: {'path': str(self.aar), 'version': '8.10.1', 'sha256': sha_file(self.aar)}
                              for name in ('gradle', 'builder')}
        self.files = {'BundleConfig.pb': b'config', METADATA_PATH: b'metadata',
                      'base/manifest/AndroidManifest.xml': b'manifest', 'base/dex/classes.dex': b'dex\ncontrolled dex',
                      'base/lib/x86_64/libsample.so': self.native, 'base/res/raw/data.bin': b'data'}
        self.bundle = self.root / 'app.aab'
        self.marker = {'version': '8.10.24', 'min-api': 33, 'pg-map-id': 'example',
                       'backend': 'dex', 'compilation-mode': 'release', 'r8-mode': 'full'}

    def compiler(self, arguments, label):
        if label == 'R8 mapping checksum verification':
            return b''
        if label == 'R8 marker extraction':
            return ('~~R8' + json.dumps(self.marker)).encode()
        if label == 'SDK DEX inspection':
            return b'<api><package name=""><class name="a"/><class name="b"/><class name="c"/><class name="d"/></package></api>'
        self.fail('Unexpected compiler invocation')

    def payload(self):
        self.bundle.write_bytes(zip_bytes(self.files))
        self.data['inputSha256'] = sha_file(self.bundle)
        content = self.files[METADATA_PATH]
        self.data['metadata'] = {'path': METADATA_PATH, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
        work = self.root / f'work-{len(list(self.root.glob("work-*")))}'
        work.mkdir()
        maven = maven_inventory(self.data)
        with patch('android_sbom_payload.execute', side_effect=self.compiler):
            payload = inspect_payload(self.bundle, self.mapping, self.data, maven, self.root / 'java', self.sdk, work)
        return maven, payload

    def test_real_cache_bytes_and_inherited_license_preserve_digest_absence_and_parallel_edges(self):
        result = maven_inventory(self.data)
        self.assertEqual(result['edgeOccurrences'], 2)
        self.assertEqual(result['duplicateEdges'], 1)
        self.assertEqual(result['dependencies'][0]['dependsOn'], ['pkg:maven/org.example/bom@1'])
        self.assertNotIn('hashes', result['components'][1])
        self.assertEqual(result['classes']['lib.Owned'], {'pkg:maven/org.example/sample@1'})
        pom = self.aar.with_suffix('.pom')
        pom.write_text('<project><parent><groupId>org.example</groupId><artifactId>bom</artifactId><version>1</version></parent></project>')
        names, chain = pom_licenses(self.cache, self.gav)
        self.assertEqual(names, ['Apache-2.0'])
        self.assertEqual([item['coordinate'] for item in chain], ['org.example:sample:1', 'org.example:bom:1'])

    def test_rejects_dangling_unreachable_duplicate_and_noninteger_graph_nodes(self):
        mutations = [lambda d: d['dependencies'][0].update(dependsOn=[2]),
                     lambda d: d['dependencies'][0].update(dependsOn=[]),
                     lambda d: d['dependencies'].append(d['dependencies'][0]),
                     lambda d: d['libraries'][0].update(index=False),
                     lambda d: d['libraries'][1].update(repositoryIndex=2),
                     lambda d: d['libraries'][0].update(group='..'),
                     lambda d: d.update(schemaVersion=True)]
        for mutate in mutations:
            data = copy.deepcopy(self.data)
            mutate(data)
            with self.subTest(data=data), self.assertRaises(ValueError):
                validate_graph(data)

    def test_rejects_absent_or_ambiguous_artifact_bytes(self):
        self.aar.write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            maven_inventory(self.data)
        self.aar.write_bytes(self.artifact)
        self.aar.with_name('duplicate.aar').write_bytes(self.artifact)
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            maven_inventory(self.data)

    def test_rejects_unresolved_absent_cyclic_and_external_entity_licenses(self):
        for content in ('<project/>', '<project><licenses><license><name>${license}</name></license></licenses></project>',
                        '<!DOCTYPE project [<!ENTITY x SYSTEM "file:///missing">]><project/>',
                        '<project><parent><groupId>org.example</groupId><artifactId>sample</artifactId><version>1</version></parent></project>'):
            self.aar.with_suffix('.pom').write_text(content)
            with self.subTest(content=content), self.assertRaises(ValueError):
                pom_licenses(self.cache, self.gav)

    def test_limits_file_reads_and_rejects_archive_traversal(self):
        with self.assertRaisesRegex(ValueError, 'byte limit'):
            read_file(self.aar, 3)
        for name in ('../escape', '/absolute', 'base/./file', 'base\\file', 'base//file'):
            with self.subTest(name=name), zipfile.ZipFile(io.BytesIO(zip_bytes({name: b'x'}))) as archive:
                with self.assertRaises(ValueError):
                    archive_entries(archive)

    def test_rejects_utf16_dtd_before_license_entity_expansion(self):
        document = ('<?xml version="1.0" encoding="UTF-16"?>'
                    '<!DOCTYPE project [<!ENTITY license "Synthetic-License">]>'
                    '<project><licenses><license><name>&license;</name></license></licenses></project>')
        self.aar.with_suffix('.pom').write_bytes(document.encode('utf-16'))
        with self.assertRaisesRegex(ValueError, 'Unsupported Maven POM document'):
            pom_licenses(self.cache, self.gav)

    def test_rejects_linked_ancestor(self):
        link = self.root / 'alias'
        try:
            link.symlink_to(self.cache, target_is_directory=True)
        except OSError:
            self.skipTest('Creating symbolic links requires host privileges')
        with self.assertRaisesRegex(ValueError, 'links'):
            sha_file(link.joinpath(*self.gav, 'hash/sample.aar'))

    def test_class_level_synthesis_does_not_accept_indented_method_markers(self):
        records, _ = mapping_records(self.mapping_text.replace('\n# {"id":"com.android.tools.r8.synthesized"}',
                                                               '\n    # {"id":"com.android.tools.r8.synthesized"}'))
        with self.assertRaisesRegex(ValueError, 'no inspected input'):
            class_attribution(records, {'lib.Owned': ['maven']}, {'app.Main': 'app', 'core.Core': 'core'})
        self.assertEqual(dexdump_classes(b'<api><package name=""><class name="a"/></package></api>'), {'a'})

    def test_payload_attributes_native_and_every_class_and_hashes_resource_bytes(self):
        maven, payload = self.payload()
        self.assertEqual(len(payload['files']), 6)
        self.assertEqual(payload['dexClassCount'], 4)
        self.assertEqual(payload['native'][0]['owner'], 'pkg:maven/org.example/sample@1')
        self.assertTrue(payload['classAttribution'][-1]['synthesized'])
        self.assertEqual(sum(len(item['classes']) for item in payload['projectInputs']), 2)
        bom = bom_document(self.bundle, self.data, maven, payload, {'sha256': 'a' * 64})
        self.assertEqual(len(bom['components']), 10)
        self.assertEqual(len(bom['dependencies']), 11)
        dex_ref = next(item['bom-ref'] for item in bom['components'] if item['name'] == 'base/dex/classes.dex')
        self.assertEqual(next(item['dependsOn'] for item in bom['dependencies'] if item['ref'] == dex_ref),
                         ['pkg:maven/org.example/sample@1', 'urn:dsh:android-project:app', 'urn:dsh:android-project:core'])

    def test_accepts_dex_numbers_ten_and_twenty_but_rejects_leading_zero(self):
        dex = self.files.pop('base/dex/classes.dex')
        for name in ('classes10.dex', 'classes20.dex', 'classes01.dex'):
            self.files['base/dex/' + name] = dex
            if name == 'classes01.dex':
                with self.assertRaisesRegex(ValueError, 'DEX location'):
                    self.payload()
            else:
                self.payload()
            del self.files['base/dex/' + name]

    def test_rejects_native_mismatch_uninspected_containers_and_unknown_dex_classes(self):
        for name, content in (('base/lib/x86_64/libsample.so', b'\x7fELF changed'),
                              ('base/assets/plugin.jar', b'jar'), ('base/assets/hidden.bin', b'PK\x03\x04hidden')):
            original = self.files.get(name)
            self.files[name] = content
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.payload()
            if original is None:
                del self.files[name]
            else:
                self.files[name] = original
        self.mapping.write_text(self.mapping_text.replace(' -> d:', ' -> e:'))
        with self.assertRaisesRegex(ValueError, 'absent from the R8 mapping'):
            self.payload()

    def test_rejects_changed_mapping_marker_and_ambiguous_class_ownership(self):
        self.marker['pg-map-id'] = 'different'
        with self.assertRaisesRegex(ValueError, 'compiler marker differs'):
            self.payload()
        with self.assertRaisesRegex(ValueError, 'Ambiguous'):
            class_attribution([{'original': 'A', 'renamed': 'a', 'synthesized': False}], {'A': ['first', 'second']}, {})

    def test_java_class_resources_require_verbatim_maven_resource_bytes(self):
        probe = b'\xca\xfe\xba\xbe controlled Kotlin class resource'
        self.aar.write_bytes(zip_bytes({'classes.jar': zip_bytes({'lib/Owned.class': b'class', 'DebugProbesKt.bin': probe}),
                                        'jni/x86_64/libsample.so': self.native}))
        self.data['libraries'][0]['sha256'] = sha_file(self.aar)
        for tool in self.data['tools'].values():
            tool['sha256'] = sha_file(self.aar)
        self.files['base/root/DebugProbesKt.bin'] = probe
        _, payload = self.payload()
        self.assertEqual(payload['resources'][0]['owners'], ['pkg:maven/org.example/sample@1'])
        self.files['base/root/DebugProbesKt.bin'] = probe + b'changed'
        with self.assertRaisesRegex(ValueError, 'Java class resource'):
            self.payload()

    def test_new_only_output_and_fresh_verification_reject_inventory_omissions(self):
        maven, payload = self.payload()
        bom = bom_document(self.bundle, self.data, maven, payload, {'sha256': 'a' * 64})
        receipt = {'sbom': {'sha256': hashlib.sha256(json_bytes(bom)).hexdigest()}, 'payload': payload}
        output = self.root / 'output'
        publish(output, bom, receipt)
        verify(output, bom, receipt)
        with self.assertRaises(FileExistsError):
            publish(output, bom, receipt)
        for field in ('files', 'native', 'dex', 'classAttribution', 'projectInputs'):
            altered = copy.deepcopy(receipt)
            altered['payload'][field].pop()
            (output / 'inventory.json').write_bytes(json_bytes(altered))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'differs'):
                verify(output, bom, receipt)
        (output / 'sbom.cdx.json').write_bytes(json_bytes({**bom, 'components': []}))
        with self.assertRaisesRegex(ValueError, 'SBOM bytes differ'):
            verify(output, bom, receipt)

    def test_rejects_duplicate_evidence_keys_and_nonfinite_numbers(self):
        target = self.root / 'evidence.json'
        for content in ('{"status":"FAIL","status":"PASS"}', '{"count":NaN}'):
            target.write_text(content)
            with self.subTest(content=content), self.assertRaises(ValueError):
                read_json(target)


if __name__ == '__main__':
    unittest.main()
