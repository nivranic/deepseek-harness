"""Generate or reverify a byte-bound Android AAB inventory; requires an existing release build."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import quote
from xml.etree import ElementTree as ET
import zipfile

from android_sbom_inventory import InventoryError, maven_inventory, no_links, read_file, regular_file, require, sha_file
from android_sbom_payload import execute, inspect_payload, tool_environment

ROOT = Path(__file__).resolve().parents[2]
SCANNER = {'name': 'dsh-android-aab-inventory', 'version': '1'}
SOURCES = ('android_sbom.py', 'android_sbom_inventory.py', 'android_sbom_payload.py',
           'android-sbom.init.gradle', 'android-sbom-schema.mjs')


def json_bytes(value):
    """Encode deterministic UTF-8 evidence with one trailing newline."""
    return (json.dumps(value, sort_keys=True, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def read_json(path):
    """Reject oversized, duplicate-key or non-finite JSON before comparing evidence."""
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate Android evidence JSON key')
            result[key] = value
        return result
    def constant(_value):
        raise ValueError('Non-finite Android evidence JSON number')
    return json.loads(read_file(path, 32 * 1024 * 1024), object_pairs_hook=pairs, parse_constant=constant)


def collect_inputs(bundle, work):
    """Invoke the checked-in AGP reader directly; externally supplied metadata JSON is not accepted."""
    environment = tool_environment()
    output = work / 'agp-inputs.json'
    environment.update(DSH_ANDROID_SBOM_INPUT=str(bundle), DSH_ANDROID_SBOM_EXPORT=str(output),
                       DSH_ANDROID_SIGNING_MODE='unsigned')
    android = ROOT / 'apps/android'
    wrapper = regular_file(android / ('gradlew.bat' if os.name == 'nt' else 'gradlew'))
    result = subprocess.run([str(wrapper), '--offline', '--no-daemon', '-I',
                             str(ROOT / 'scripts/release/android-sbom.init.gradle'), ':app:exportAndroidSbomInputs'],
                            cwd=android, env=environment, capture_output=True, timeout=600)
    require(result.returncode == 0, 'AGP Android SBOM input collection failed')
    data = read_json(output)
    require(data['inputSha256'] == sha_file(bundle), 'AGP export differs from the requested AAB')
    for project in data['projects']:
        path = Path(project['classes'])
        no_links(path)
        require(path.is_relative_to(android / project['name'] / 'build'), 'Project classes are outside the Android build')
    return data


def bom_document(bundle, data, maven, payload, generator):
    """Project every inspected Maven node, project input, packaged file, and dependency into CycloneDX."""
    target = 'urn:sha256:' + data['inputSha256']
    project_refs = {item['project']: 'urn:dsh:android-project:' + item['project'] for item in payload['projectInputs']}
    components = list(maven['components'])
    dependencies = list(maven['dependencies'])
    for project in payload['projectInputs']:
        ref = project_refs[project['project']]
        components.append({'type': 'library', 'bom-ref': ref, 'name': project['project'],
                           'properties': [{'name': 'dsh:android:class-input-tree-sha256', 'value': project['inputTreeSha256']}]})
        dependencies.append({'ref': ref, 'dependsOn': []})
    native_owners = {item['path']: [item['owner']] for item in payload['native']}
    resource_owners = {item['path']: item['owners'] for item in payload['resources']}
    dex_owners = {}
    for dex in payload['dex']:
        classes = set(dex['classes'])
        owners = set()
        for item in payload['classAttribution']:
            if item['renamed'] in classes:
                owners.update(item['mavenOwners'])
                if item['project']:
                    owners.add(project_refs[item['project']])
        dex_owners[dex['path']] = sorted(owners)
    file_refs = []
    for item in payload['files']:
        ref = target + ':file:' + quote(item['path'], safe='/')
        file_refs.append(ref)
        components.append({'type': 'file', 'bom-ref': ref, 'name': item['path'],
                           'hashes': [{'alg': 'SHA-256', 'content': item['sha256']}],
                           'properties': [{'name': 'dsh:android:uncompressed-size', 'value': str(item['size'])}]})
        owners = native_owners.get(item['path'], dex_owners.get(item['path'], resource_owners.get(item['path'], [])))
        dependencies.append({'ref': ref, 'dependsOn': owners})
    roots = {maven['components'][index]['bom-ref'] for module in data['modules'] for index in module['dependsOn']}
    dependencies.append({'ref': target, 'dependsOn': sorted(roots | set(file_refs) | set(project_refs.values()))})
    return {'bomFormat': 'CycloneDX', 'specVersion': '1.6', 'version': 1,
            'metadata': {'component': {'type': 'application', 'bom-ref': target, 'name': bundle.name,
                                       'hashes': [{'alg': 'SHA-256', 'content': data['inputSha256']}]},
                         'tools': {'components': [{'type': 'application', **SCANNER,
                                                  'hashes': [{'alg': 'SHA-256', 'content': generator['sha256']}]}]}},
            'components': components, 'dependencies': dependencies}


def generator_identity():
    """Bind the scanner identity to all executed repository source files."""
    files = [{'path': 'scripts/release/' + name, 'sha256': sha_file(ROOT / 'scripts/release' / name)} for name in SOURCES]
    return {**SCANNER, 'files': files, 'sha256': hashlib.sha256(json_bytes(files)).hexdigest(),
            'pnpmLockSha256': sha_file(ROOT / 'pnpm-lock.yaml')}


def scan(bundle, mapping, java, sdk, node, work):
    """Produce validated documents from actual AAB, Maven, compiler and class input bytes."""
    generator = generator_identity()
    java_sha, node_sha = sha_file(java), sha_file(node)
    data = collect_inputs(bundle, work)
    maven = maven_inventory(data)
    payload = inspect_payload(bundle, mapping, data, maven, java, sdk, work)
    bom = bom_document(bundle, data, maven, payload, generator)
    bom_path = work / 'sbom.cdx.json'
    with bom_path.open('xb') as stream:
        stream.write(json_bytes(bom))
    validator = json.loads(execute([node, ROOT / 'scripts/release/android-sbom-schema.mjs', bom_path],
                                   'CycloneDX 1.6 schema verification'))
    require(generator_identity() == generator and sha_file(java) == java_sha and sha_file(node) == node_sha,
            'Android scanner tools changed during inspection')
    receipt = {'schemaVersion': 1, 'kind': 'android-aab-inventory', 'status': 'PASS',
               'scope': 'base-module files, embedded Maven graph and declared licenses, R8 classes and native input attribution',
               'bundle': {'name': bundle.name, 'sha256': data['inputSha256']}, 'generator': generator,
               'sbom': {'path': 'sbom.cdx.json', 'sha256': sha_file(bom_path)}, 'metadata': data['metadata'],
               'graph': {key: data[key] for key in ('libraries', 'dependencies', 'modules', 'repositoryKinds')},
               'maven': maven['materials'], 'dependencyEdgeOccurrences': maven['edgeOccurrences'],
               'duplicateDependencyEdges': maven['duplicateEdges'], 'payload': payload,
               'tools': {'agp': {name: {key: item[key] for key in ('version', 'sha256')} for name, item in data['tools'].items()},
                         'java': {'sha256': java_sha}, 'node': {'sha256': node_sha}, 'cycloneDx': validator}}
    return bom, receipt


def publish(output, bom, receipt):
    """Create new evidence only; inventory.json is written last, after the SBOM is complete."""
    no_links(output.parent)
    output.mkdir()
    for name, value in (('sbom.cdx.json', bom), ('inventory.json', receipt)):
        with (output / name).open('xb') as stream:
            stream.write(json_bytes(value))


def verify(output, bom, receipt):
    """Reverify both documents against a fresh scan, rejecting missing or altered inventory detail."""
    no_links(output)
    require(sha_file(output / 'sbom.cdx.json') == receipt['sbom']['sha256'], 'Android SBOM bytes differ from the fresh inventory')
    require(read_json(output / 'sbom.cdx.json') == bom and read_json(output / 'inventory.json') == receipt,
            'Android evidence differs from the fresh inventory')


def main():
    """Run with explicit artifact paths and a new output directory, or verify an existing directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True, type=Path)
    parser.add_argument('--mapping', required=True, type=Path)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--output', type=Path)
    modes.add_argument('--verify', type=Path)
    args = parser.parse_args()
    bundle, mapping = args.bundle.absolute(), args.mapping.absolute()
    regular_file(bundle)
    regular_file(mapping)
    output = (args.output or args.verify).absolute()
    no_links(output.parent)
    require(not args.output or not output.exists(), 'Android SBOM output directory must be new')
    java_home, sdk_home = os.environ.get('JAVA_HOME'), os.environ.get('ANDROID_HOME')
    require(java_home and sdk_home, 'Android SBOM requires JAVA_HOME and ANDROID_HOME')
    java = Path(java_home) / 'bin' / ('java.exe' if os.name == 'nt' else 'java')
    node_path = shutil.which('node')
    require(node_path, 'Android SBOM requires Node and installed repository dependencies')
    # The launcher may be a PATH symlink; pin its resolved regular executable before running it.
    node = Path(node_path).resolve()
    temporary_root = Path(tempfile.gettempdir()).resolve()
    with tempfile.TemporaryDirectory(prefix='dsh-android-inventory-', dir=temporary_root) as directory:
        work = Path(directory)
        require(work.resolve().parent == temporary_root, 'Unexpected Android scanner temporary directory')
        bom, receipt = scan(bundle, mapping, java, Path(sdk_home), node, work)
        if args.output:
            publish(output, bom, receipt)
        else:
            verify(output, bom, receipt)
    print('Android AAB inventory verified')


if __name__ == '__main__':
    try:
        main()
    except InventoryError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, ET.ParseError, zipfile.BadZipFile, subprocess.SubprocessError):
        print('Android AAB inventory failed; require an intact release build, dependency cache and compiler tools', file=sys.stderr)
        sys.exit(1)
