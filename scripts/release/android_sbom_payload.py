"""Inspect packaged Android bytes using R8 and the SDK, and bind their classes to compiler inputs."""

from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from xml.etree import ElementTree as ET
import zipfile

from android_sbom_inventory import METADATA_PATH, archive_entries, no_links, portable_name, read_file, read_member, regular_file, require, sha_file


def tool_environment():
    """Keep signing material and agent credentials out of compiler inspection processes."""
    return {name: value for name, value in os.environ.items()
            if not re.search(r'KEY|SECRET|TOKEN|PASSWORD', name, re.I)
            and not name.startswith('DSH_ANDROID_SIGNING_')}


def execute(arguments, label):
    """Run compiler tooling without a shell and report failure without echoing remote input or environment."""
    result = subprocess.run([str(value) for value in arguments], capture_output=True, timeout=120, env=tool_environment())
    require(result.returncode == 0, label + ' failed')
    return result.stdout


def mapping_records(text):
    """Read R8 2.2 class headers and class-level synthesis markers after R8 verifies the complete file hash."""
    def header(name):
        values = re.findall(r'^# ' + re.escape(name) + r': ([^\r\n]+)\r?$', text, re.M)
        require(len(values) == 1, 'R8 mapping header is missing or duplicated')
        return values[0]
    require(header('compiler') == 'R8', 'Android release inventory requires R8 mapping')
    require(re.fullmatch(r'SHA-256 [a-f0-9]{64}', header('pg_map_hash')), 'R8 mapping must carry its full checksum')
    require(re.fullmatch(r'\d+', header('min_api')), 'Invalid R8 minimum API')
    version = header('compiler_version')
    records, originals, schemas = [], set(), []
    for line in text.splitlines():
        match = re.fullmatch(r'(\S+) -> (\S+):', line)
        if match:
            original, renamed = match.groups()
            require(original not in originals, 'Duplicate original class in R8 mapping')
            originals.add(original)
            records.append({'original': original, 'renamed': renamed, 'synthesized': False})
        elif line.startswith('# {'):
            value = json.loads(line[2:])
            if value.get('id') == 'com.android.tools.r8.mapping':
                schemas.append(value.get('version'))
            elif value.get('id') == 'com.android.tools.r8.synthesized':
                require(records, 'R8 class synthesis marker has no class')
                records[-1]['synthesized'] = True
    require(schemas == ['2.2'] and records, 'Unsupported or empty R8 class mapping')
    return records, {'version': version, 'minApi': int(header('min_api')), 'mapId': header('pg_map_id')}


def project_classes(projects):
    """Record every real app/core class input and a reproducible digest of each relative path/hash list."""
    require(isinstance(projects, list) and {item['name'] for item in projects} == {'app', 'core'} and len(projects) == 2,
            'Android class inventory requires app and core compiler inputs')
    owners, materials = {}, []
    for item in projects:
        directory = Path(item['classes'])
        no_links(directory)
        require(directory.is_absolute() and directory.is_dir() and not directory.is_symlink(), 'Invalid Android project class directory')
        entries = []
        def walk_error(error):
            raise error
        for parent, directories, files in os.walk(directory, followlinks=False, onerror=walk_error):
            for name in directories:
                info = (Path(parent) / name).lstat()
                require(not (Path(parent) / name).is_symlink() and not getattr(info, 'st_file_attributes', 0) & 0x400,
                        'Android class directories must not contain links')
            for name in files:
                path = Path(parent) / name
                regular_file(path)
                if path.suffix == '.class':
                    relative = portable_name(path.relative_to(directory).as_posix())
                    clazz = relative[:-6].replace('/', '.')
                    require(clazz not in owners, 'Duplicate Android project class')
                    owners[clazz] = item['name']
                    entries.append({'path': relative, 'sha256': sha_file(path)})
        require(entries, 'Android project class directory is empty')
        entries.sort(key=lambda value: value['path'])
        encoded = json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()
        materials.append({'project': item['name'], 'classes': entries, 'classCount': len(entries),
                          'inputTreeSha256': hashlib.sha256(encoded).hexdigest()})
    return owners, materials


def class_attribution(records, maven, projects):
    """Require an exact input owner or R8's explicit class marker for every original mapping class."""
    result = []
    for record in records:
        owners = sorted(maven.get(record['original'], []))
        project = projects.get(record['original'])
        require(len(owners) <= 1 and not (owners and project), 'Ambiguous Android class input owner')
        require(owners or project or record['synthesized'], 'R8 original class has no inspected input or class synthesis marker')
        result.append({**record, 'mavenOwners': owners, 'project': project})
    return result


def dex_marker(output, expected):
    """Require a single full-release R8 marker with the mapping's compiler, minimum API and map id."""
    values = re.findall(r'~~([A-Za-z0-9]+)(\{[^\r\n]+\})', output)
    require(len(values) == 1 and values[0][0] == 'R8', 'DEX requires one R8 compiler marker')
    marker = json.loads(values[0][1])
    require(marker.get('version') == expected['version'] and type(marker.get('min-api')) is int
            and marker['min-api'] == expected['minApi'] and marker.get('pg-map-id') == expected['mapId']
            and marker.get('backend') == 'dex' and marker.get('compilation-mode') == 'release'
            and marker.get('r8-mode') == 'full', 'DEX compiler marker differs from the verified release mapping')
    return marker


def dexdump_classes(output):
    """Read the SDK's decoded class definitions, rejecting empty or duplicate output."""
    document = ET.fromstring(output)
    require(document.tag == 'api', 'Unexpected dexdump XML root')
    names = [(package.attrib['name'] + '.' if package.attrib['name'] else '') + clazz.attrib['name']
             for package in document.findall('package') for clazz in package.findall('class')]
    require(names and len(names) == len(set(names)), 'Empty or duplicate DEX class definitions')
    return set(names)


def inspect_payload(bundle, mapping, data, maven, java, sdk, work):
    """Inventory every AAB file, verify native bytes, and match actual DEX definitions to an intact R8 mapping."""
    require(sha_file(bundle) == data['inputSha256'], 'AAB differs from the AGP metadata export')
    tools = data['tools']
    require(set(tools) == {'gradle', 'builder'}, 'Require the original AGP decoder and R8 carrier')
    require(tools['gradle']['version'] == tools['builder']['version'], 'AGP tool versions differ')
    for tool in tools.values():
        require(sha_file(Path(tool['path'])) == tool['sha256'], 'AGP tool bytes differ from the resolved artifact')
    builder = Path(tools['builder']['path'])
    mapping_sha = sha_file(mapping)
    execute([java, '-cp', builder, 'com.android.tools.r8.retrace.Retrace', '--verify-mapping-file-hash', mapping],
            'R8 mapping checksum verification')
    mapping_content = read_file(mapping, 64 * 1024 * 1024)
    require(hashlib.sha256(mapping_content).hexdigest() == mapping_sha, 'R8 mapping changed during inspection')
    records, compiler = mapping_records(mapping_content.decode('utf-8'))
    projects, project_materials = project_classes(data['projects'])
    attribution = class_attribution(records, maven['classes'], projects)
    renamed = defaultdict(list)
    for item in attribution:
        renamed[item['renamed']].append(item['original'])
    build_tools = data['buildToolsVersion']
    require(isinstance(build_tools, str) and re.fullmatch(r'\d+\.\d+\.\d+', build_tools), 'Invalid Android build-tools version')
    dexdump = sdk / 'build-tools' / build_tools / ('dexdump.exe' if os.name == 'nt' else 'dexdump')
    dexdump_sha = sha_file(dexdump)
    files, natives, dex, resources = [], [], [], []
    defined = set()
    with zipfile.ZipFile(bundle) as archive:
        entries = archive_entries(archive)
        require('BundleConfig.pb' in entries and 'base/manifest/AndroidManifest.xml' in entries and METADATA_PATH in entries,
                'Android inventory requires the bundle configuration, base manifest and dependency metadata')
        metadata = read_member(archive, entries[METADATA_PATH], 4 * 1024 * 1024)
        require(data['metadata'] == {'path': METADATA_PATH, 'size': len(metadata), 'sha256': hashlib.sha256(metadata).hexdigest()},
                'Embedded dependency metadata differs from the parser input')
        require(len(entries) <= 100000 and sum(info.file_size for info in entries.values()) <= 2 * 1024 * 1024 * 1024,
                'AAB inventory exceeds its file or total byte limit')
        for index, (name, info) in enumerate(sorted(entries.items())):
            if info.is_dir():
                continue
            require(name == 'BundleConfig.pb' or name.split('/')[0] in ('base', 'BUNDLE-METADATA', 'META-INF'),
                    'AAB contains an unsupported module or top-level file')
            content = read_member(archive, info)
            item = {'path': name, 'size': len(content), 'sha256': hashlib.sha256(content).hexdigest()}
            files.append(item)
            if name.endswith('.so') or content.startswith(b'\x7fELF'):
                require(re.fullmatch(r'base/lib/[^/]+/[^/]+\.so', name), 'Unsupported native-code location in AAB')
                owners = [value['ref'] for value in maven['natives'].get(name[len('base/lib/'):], []) if value['sha256'] == item['sha256']]
                require(len(owners) == 1, 'Packaged native library must match one inspected AAR input')
                natives.append({**item, 'owner': owners[0]})
            elif name.endswith('.dex') or content.startswith(b'dex\n'):
                require(re.fullmatch(r'base/dex/classes(?:[2-9]|[1-9][0-9]+)?\.dex', name), 'Unsupported DEX location in AAB')
                temporary = work / f'dex-{index}.dex'
                with temporary.open('xb') as stream:
                    stream.write(content)
                marker = dex_marker(execute([java, '-cp', builder, 'com.android.tools.r8.ExtractMarker', temporary],
                                            'R8 marker extraction').decode('utf-8'), compiler)
                classes = dexdump_classes(execute([dexdump, '-l', 'xml', temporary], 'SDK DEX inspection'))
                require(not classes - renamed.keys(), 'DEX contains classes absent from the R8 mapping')
                require(not classes & defined, 'AAB defines a class in multiple DEX files')
                defined.update(classes)
                dex.append({**item, 'marker': marker, 'classes': sorted(classes)})
            else:
                owners = sorted({value['ref'] for value in maven['resources'].get(name, []) if value['sha256'] == item['sha256']})
                if owners:
                    resources.append({**item, 'owners': owners})
                require(Path(name).suffix.lower() not in ('.jar', '.aar', '.apk', '.aab', '.class', '.wasm', '.dll', '.exe'),
                        'AAB contains an executable container outside the inspected Android code locations')
                require(not content.startswith((b'PK\x03\x04', b'\x00asm', b'MZ')),
                        'AAB contains an uninspected executable or archive payload')
                # Kotlin's DebugProbesKt.bin is a Java class resource, carried verbatim from its input JAR.
                require(not content.startswith(b'\xca\xfe\xba\xbe') or name.startswith('base/root/') and len(owners) == 1,
                        'Packaged Java class resource has no exact Maven input owner')
    require(dex and files, 'AAB inventory has no DEX or files')
    require({module['name'] for module in data['modules']} == {'base'}, 'Only the current base Android module is supported')
    require(sha_file(bundle) == data['inputSha256'] and sha_file(mapping) == mapping_sha, 'Android inputs changed during inspection')
    require(all(sha_file(Path(tool['path'])) == tool['sha256'] for tool in tools.values())
            and sha_file(dexdump) == dexdump_sha, 'Android compiler tooling changed during inspection')
    return {'files': files, 'native': natives, 'dex': dex, 'resources': resources, 'mappingSha256': mapping_sha, 'compiler': compiler,
            'classAttribution': attribution, 'projectInputs': project_materials,
            'dexdump': {'version': build_tools, 'sha256': dexdump_sha}, 'dexClassCount': len(defined)}
