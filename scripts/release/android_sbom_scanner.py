"""Attribute a committed mobile scanner AAR and its Go license material inside an Android inventory."""

from collections import defaultdict
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import quote
import zipfile

from android_sbom_inventory import archive_entries, jar_inventory, read_file, read_member, require, sha_file
from mobile_scanner_source import read_source, write_proxy


def scanner_inventory(value, repository, work):
    """Verify the selected AAR against its receipt and Git files; binary build provenance remains CI-owned."""
    require(isinstance(value, dict) and set(value) == {'aar', 'receipt', 'sourceSha', 'generatedResourceJar', 'generatedResourceJarSha256'},
            'Scanner input declaration is incomplete')
    aar, receipt_path = Path(value['aar']), Path(value['receipt'])
    require(aar.parent == receipt_path.parent and aar.name == 'support-scanner.aar' and receipt_path.name == 'scanner.json',
            'Scanner inputs must be the declared resource pair')
    source = read_source(repository, value['sourceSha'])
    current = subprocess.check_output(['git', '-C', str(repository), 'rev-parse', 'HEAD']).decode().strip()
    require(source.commit == current, 'Scanner input must match the application checkout')
    receipt_bytes = read_file(receipt_path, 4 * 1024 * 1024)
    receipt = json.loads(receipt_bytes)
    require(type(receipt.get('schemaVersion')) is int and receipt['schemaVersion'] == 1, 'Unsupported scanner receipt version')
    content = read_file(aar, 32 * 1024 * 1024)
    digest = hashlib.sha256(content).hexdigest()
    require(receipt['sourceSha'] == source.commit and receipt['treeSha'] == source.tree and receipt['status'] == 'BUILT'
            and receipt['staticVerification'] == 'PASS' and receipt['sha256'] == digest and receipt['bytes'] == len(content),
            'Scanner receipt does not cover the selected AAR')
    manifest = receipt['manifest']
    require(type(manifest.get('schemaVersion')) is int and manifest['schemaVersion'] == 1, 'Unsupported scanner manifest version')
    policy = json.loads(next(item.data for item in source.files if item.module_path == 'build.json'))
    require(manifest['toolchain'] == policy, 'Scanner toolchain declaration differs from Git')
    require(manifest['source'] == write_proxy(source, work / 'scanner-source-proxy'), 'Scanner source inventory differs from Git')
    expected_builders = {'scripts/build-mobile-support-scanner.py', 'scripts/release/mobile_scanner_build.py',
                         'scripts/release/mobile_scanner_source.py', 'scripts/release/mobile_scanner_artifact.py'}
    require(len(manifest['builderFiles']) == len(expected_builders)
            and {item['path'] for item in manifest['builderFiles']} == expected_builders, 'Scanner builder inventory is incomplete')
    for item in manifest['builderFiles']:
        blob = subprocess.check_output(['git', '-C', str(repository), 'show', source.commit + ':' + item['path']])
        require(hashlib.sha256(blob).hexdigest() == item['sha256'], 'Scanner builder differs from Git')
    ref = 'urn:dsh:android-scanner:' + digest
    classes, natives, resources = defaultdict(set), defaultdict(list), defaultdict(list)
    components, dependencies = [], []
    generated_jar = Path(value['generatedResourceJar'])
    generated_bytes = read_file(generated_jar, 32 * 1024 * 1024)
    require(hashlib.sha256(generated_bytes).hexdigest() == value['generatedResourceJarSha256'], 'Scanner resource compiler input changed')
    with zipfile.ZipFile(io.BytesIO(generated_bytes)) as archive:
        generated_entries = archive_entries(archive)
        generated_class = read_member(archive, generated_entries['go/supportscanner/gojni/R.class'])
    generated = {'go.supportscanner.gojni.R': hashlib.sha256(generated_class).hexdigest()}
    classes['go.supportscanner.gojni.R'].add(ref)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        entries = archive_entries(archive)
        require(len(entries) < 1000 and sum(item.file_size for item in entries.values()) < 128 * 1024 * 1024,
                'Scanner AAR exceeds inventory limits')
        embedded = json.loads(read_member(archive, entries['assets/dsh-support-scanner/manifest.json'], 4 * 1024 * 1024))
        require(embedded == manifest, 'Scanner embedded manifest differs from its receipt')
        names, jar_resources = jar_inventory(read_member(archive, entries['classes.jar']))
        for name in names:
            classes[name].add(ref)
        for item in jar_resources:
            resources['base/root/' + item['path']].append({'ref': ref, 'sha256': item['sha256']})
        libraries = manifest['libraries']
        require(len(libraries) == 2 and {item['abi'] for item in libraries} == {'arm64-v8a', 'x86_64'},
                'Scanner must declare both supported Android ABIs')
        require({name for name in entries if name.endswith('.so')} == {'jni/' + item['abi'] + '/libgojni.so' for item in libraries},
                'Scanner native library inventory differs')
        for library in libraries:
            name = library['abi'] + '/libgojni.so'
            binary = read_member(archive, entries['jni/' + name])
            require(len(binary) == library['bytes'] and hashlib.sha256(binary).hexdigest() == library['sha256'],
                    'Scanner native bytes differ from the manifest')
            natives[name].append({'ref': ref, 'sha256': library['sha256']})
        seen_notices = set()

        def licenses(notices):
            require(isinstance(notices, list) and notices, 'Scanner component has no license material')
            result = []
            for notice in notices:
                name = 'assets/dsh-support-scanner/licenses/' + notice['path']
                require(name not in seen_notices, 'Duplicate scanner license identity')
                seen_notices.add(name)
                text = read_member(archive, entries[name], 8 * 1024 * 1024)
                require(text.strip() and hashlib.sha256(text).hexdigest() == notice['sha256'], 'Scanner license bytes differ')
                result.append({'license': {'name': 'Declared license file ' + Path(notice['path']).name,
                                          'text': {'contentType': 'text/plain', 'encoding': 'base64', 'content': base64.b64encode(text).decode()}}})
            return result

        modules = manifest['modules']
        require(isinstance(modules, list) and modules, 'Scanner module inventory is empty')
        for module in modules:
            require(isinstance(module['module'], str) and module['module'] and isinstance(module['version'], str) and module['version']
                    and re.fullmatch(r'h1:[A-Za-z0-9+/]{43}=', module['sum']), 'Invalid scanner module identity')
            module_ref = 'pkg:golang/' + quote(module['module'], safe='/') + '@' + quote(module['version'], safe='')
            components.append({'type': 'library', 'bom-ref': module_ref, 'purl': module_ref, 'name': module['module'],
                               'version': module['version'], 'licenses': licenses(module['licenses']),
                               'properties': [{'name': 'dsh:go:module-sum', 'value': module['sum']}]})
            dependencies.append({'ref': module_ref, 'dependsOn': []})
        require(len({item['bom-ref'] for item in components}) == len(components), 'Duplicate scanner module identity')
        require(any(item['module'] == source.receipt()['module'] and item['version'] == source.version for item in modules),
                'Scanner source module is absent from the compiled module inventory')
        toolchain = manifest['toolchainLicenses']
        require(set(toolchain) == {'go', 'androidNdk'}, 'Scanner toolchain license inventory is incomplete')
        root_licenses = licenses(toolchain['go']) + licenses(toolchain['androidNdk'])
        require({name for name in entries if name.startswith('assets/dsh-support-scanner/licenses/')} == seen_notices,
                'Scanner archive contains unlisted license material')
        for name, item in entries.items():
            if name.startswith('assets/') and not item.is_dir():
                resources['base/' + name].append({'ref': ref, 'sha256': hashlib.sha256(read_member(archive, item)).hexdigest()})
    dependencies.append({'ref': ref, 'dependsOn': sorted(item['bom-ref'] for item in components)})
    components.append({'type': 'library', 'bom-ref': ref, 'name': 'DSH Android support scanner', 'version': source.version,
                       'hashes': [{'alg': 'SHA-256', 'content': digest}], 'licenses': root_licenses,
                       'properties': [{'name': 'dsh:source-commit', 'value': source.commit}]})
    require(sha_file(aar) == digest and sha_file(receipt_path) == hashlib.sha256(receipt_bytes).hexdigest(),
            'Scanner input changed during inspection')
    require(sha_file(generated_jar) == value['generatedResourceJarSha256'], 'Scanner resource compiler input changed during inspection')
    return {'root': ref, 'components': components, 'dependencies': dependencies, 'classes': classes, 'natives': natives,
            'resources': resources, 'generatedResourceClasses': generated,
            'material': {'sourceSha': source.commit, 'treeSha': source.tree, 'aarSha256': digest, 'manifest': manifest,
                         'generatedResourceJarSha256': value['generatedResourceJarSha256'], 'generatedResourceClasses': generated}}
