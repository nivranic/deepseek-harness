"""Validate AGP's embedded Maven graph and resolve its exact cached input artifacts and licenses."""

from collections import defaultdict
import hashlib
import io
from pathlib import Path, PurePosixPath
import re
import stat
from urllib.parse import quote
from xml.etree import ElementTree as ET
import zipfile

METADATA_PATH = 'BUNDLE-METADATA/com.android.tools.build.libraries/dependencies.pb'


class InventoryError(ValueError):
    """A scanner-authored diagnostic containing no untrusted input values."""


class PomTreeBuilder(ET.TreeBuilder):
    """Reject DTDs at the XML parser regardless of document encoding."""

    def doctype(self, name, pubid, system):
        raise InventoryError('Unsupported Maven POM document')


def require(condition, message):
    """Reject incomplete or inconsistent scanner inputs without retaining arbitrary payload text."""
    if not condition:
        raise InventoryError(message)


def regular_file(path):
    """Require a real file, including on Windows where reparse points may not be symlinks."""
    no_links(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400,
            'Android SBOM inputs must be regular files')
    return path


def no_links(path):
    """Reject symlinks and Windows reparse points in input paths, including their ancestors."""
    require(path.is_absolute(), 'Android SBOM input paths must be absolute')
    for entry in (path, *path.parents):
        info = entry.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, 'st_file_attributes', 0) & 0x400,
                'Android SBOM input paths must not contain links')


def read_file(path, limit):
    """Bound reads of compiler inputs before parsing or opening nested archives."""
    regular_file(path)
    with path.open('rb') as stream:
        content = stream.read(limit + 1)
    require(len(content) <= limit, 'Android input exceeds its byte limit')
    return content


def sha_file(path):
    """Hash file bytes without loading a large artifact into memory."""
    regular_file(path)
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def portable_name(name):
    """Require a canonical, relative archive name before assigning it an inventory identity."""
    require(isinstance(name, str) and name and '\\' not in name and ':' not in name
            and not re.search(r'[\x00-\x1f\x7f]', name), 'Invalid Android archive member name')
    path = PurePosixPath(name)
    require(not path.is_absolute() and all(part not in ('', '.', '..') for part in name.split('/')),
            'Invalid Android archive member path')
    return name


def archive_entries(archive):
    """Reject duplicate members and links; callers read members without extracting their paths."""
    entries = {}
    for info in archive.infolist():
        require(info.orig_filename == info.filename, 'Android archive member was normalized by the ZIP reader')
        name = portable_name(info.filename.rstrip('/') if info.is_dir() else info.filename)
        require(name not in entries, 'Duplicate Android archive member')
        mode = (info.external_attr >> 16) & 0o170000
        require(mode in (0, stat.S_IFDIR if info.is_dir() else stat.S_IFREG), 'Android archive contains a non-regular member')
        require(not info.flag_bits & 1, 'Encrypted Android archive members are unsupported')
        entries[name] = info
    return entries


def read_member(archive, info, limit=128 * 1024 * 1024):
    """Bound actual decompression and require its length to match the ZIP directory."""
    require(0 <= info.file_size <= limit, 'Android archive member exceeds its byte limit')
    with archive.open(info) as stream:
        content = stream.read(limit + 1)
    require(len(content) <= limit and len(content) == info.file_size, 'Android archive member size differs from its bytes')
    return content


def coordinate(values):
    """Limit Maven cache lookup segments to literal coordinates, without interpolation or traversal."""
    require(all(isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_+.-]+', value)
                and value not in ('.', '..') for value in values), 'Maven coordinates must be literal path segments')
    return tuple(values)


def maven_ref(gav):
    """Build the package URL used by both Maven components and dependency edges."""
    return 'pkg:maven/' + quote(gav[0], safe='.') + '/' + quote(gav[1], safe='') + '@' + quote(gav[2], safe='')


def pom_licenses(cache, gav, seen=frozenset()):
    """Read declared licenses and literal parent inheritance; unresolved or absent declarations fail."""
    require(gav not in seen and len(seen) < 32, 'Maven parent chain is cyclic or too deep')
    directory = cache.joinpath(*gav)
    no_links(directory)
    poms = sorted(directory.glob('*/*.pom'))
    require(len(poms) == 1, 'Require one cached POM for each Maven license declaration')
    content = read_file(poms[0], 4 * 1024 * 1024)
    document = ET.fromstring(content, parser=ET.XMLParser(target=PomTreeBuilder()))
    require(document.tag in ('project', '{http://maven.apache.org/POM/4.0.0}project'), 'Unsupported Maven POM root')
    names = sorted({node.text.strip() for node in document.findall('./{*}licenses/{*}license/{*}name') if node.text})
    require(all(name and '${' not in name for name in names), 'Unresolved Maven license name')
    chain = [{'coordinate': ':'.join(gav), 'sha256': hashlib.sha256(content).hexdigest()}]
    if names:
        return names, chain
    parent = document.find('./{*}parent')
    require(parent is not None, 'Maven dependency has no declared license')
    inherited = coordinate([parent.findtext('./{*}' + key) for key in ('groupId', 'artifactId', 'version')])
    names, parents = pom_licenses(cache, inherited, seen | {gav})
    return names, chain + parents


def validate_graph(data):
    """Preserve parallel dependency edges, while rejecting dangling, duplicate-source or unreachable nodes."""
    require(data.get('schemaVersion') == 1 and type(data['schemaVersion']) is int, 'Unsupported Android input version')
    libraries = data['libraries']
    require(isinstance(libraries, list) and libraries, 'Android Maven graph must not be empty')
    repositories = data['repositoryKinds']
    require(isinstance(repositories, list) and repositories and all(kind == 'MAVEN_REPO' for kind in repositories),
            'Android inventory supports Maven repositories only')
    seen = set()
    for index, item in enumerate(libraries):
        require(type(item['index']) is int and item['index'] == index, 'Android library indexes are inconsistent')
        gav = coordinate([item['group'], item['name'], item['version']])
        require(gav not in seen, 'Duplicate Android Maven coordinate')
        seen.add(gav)
        digest = item['sha256']
        require(isinstance(digest, str) and (digest == '' or re.fullmatch(r'[a-f0-9]{64}', digest)), 'Invalid embedded artifact SHA-256')
        repo = item['repositoryIndex']
        require(repo is None or type(repo) is int and 0 <= repo < len(repositories), 'Invalid Android repository index')
    def indexes(value):
        require(isinstance(value, list) and all(type(index) is int and 0 <= index < len(libraries) for index in value),
                'Android dependency index is outside the embedded library table')
        return value
    edges = {}
    for item in data['dependencies']:
        source = indexes([item['index']])[0]
        require(source not in edges, 'Duplicate Android dependency source')
        edges[source] = indexes(item['dependsOn'])
    pending, names = [], set()
    require(isinstance(data['modules'], list) and data['modules'], 'Android graph requires a module')
    for module in data['modules']:
        name = portable_name(module['name'])
        require('/' not in name and name not in names, 'Duplicate or invalid Android module')
        names.add(name)
        pending.extend(indexes(module['dependsOn']))
    reached = set()
    while pending:
        index = pending.pop()
        if index not in reached:
            reached.add(index)
            pending.extend(edges.get(index, []))
    require(len(reached) == len(libraries), 'Android embedded graph contains unreachable libraries')
    return edges


def jar_inventory(content):
    """List classes and hash resources from a verified JAR input without extracting it."""
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        entries = archive_entries(archive)
        classes, resources = set(), []
        for name, info in entries.items():
            if info.is_dir():
                continue
            if name.endswith('.class'):
                classes.add(name[:-6].replace('/', '.'))
            else:
                resources.append({'path': name, 'sha256': hashlib.sha256(read_member(archive, info)).hexdigest()})
        return classes, resources


def maven_inventory(data):
    """Match every embedded digest to a real JAR/AAR and collect license, class, and native-library evidence."""
    edges = validate_graph(data)
    cache = Path(data['gradleUserHome']) / 'caches/modules-2/files-2.1'
    require(cache.is_dir(), 'Gradle dependency cache is unavailable')
    components, materials = [], []
    classes, natives, resources = defaultdict(set), defaultdict(list), defaultdict(list)
    def collect_jar(content, ref):
        names, files = jar_inventory(content)
        for name in names:
            classes[name].add(ref)
        for item in files:
            resources['base/root/' + item['path']].append({'ref': ref, 'sha256': item['sha256']})
    for item in data['libraries']:
        gav = coordinate([item['group'], item['name'], item['version']])
        ref = maven_ref(gav)
        licenses, poms = pom_licenses(cache, gav)
        component = {'type': 'library', 'bom-ref': ref, 'purl': ref, 'group': gav[0], 'name': gav[1], 'version': gav[2],
                     'licenses': [{'license': {'name': name}} for name in licenses],
                     'properties': [{'name': 'dsh:android:inventory-source', 'value': METADATA_PATH},
                                    {'name': 'dsh:android:embedded-digest', 'value': 'present' if item['sha256'] else 'absent'}]}
        material = {'ref': ref, 'embeddedSha256': item['sha256'], 'pomChain': poms}
        if item['sha256']:
            matches = [path for path in sorted(cache.joinpath(*gav).glob('*/*'))
                       if path.suffix in ('.jar', '.aar') and sha_file(path) == item['sha256']]
            require(len(matches) == 1, 'Embedded Maven digest must match exactly one cached JAR or AAR')
            path = matches[0]
            content = read_file(path, 128 * 1024 * 1024)
            require(hashlib.sha256(content).hexdigest() == item['sha256'], 'Maven artifact changed during inspection')
            component['hashes'] = [{'alg': 'SHA-256', 'content': item['sha256']}]
            material['artifactKind'] = path.suffix[1:]
            if path.suffix == '.jar':
                collect_jar(content, ref)
            else:
                with zipfile.ZipFile(io.BytesIO(content)) as archive:
                    for name, info in archive_entries(archive).items():
                        if name == 'classes.jar' or name.startswith('libs/') and name.endswith('.jar'):
                            collect_jar(read_member(archive, info), ref)
                        if name.startswith('assets/') and not info.is_dir():
                            resources['base/' + name].append({'ref': ref, 'sha256': hashlib.sha256(read_member(archive, info)).hexdigest()})
                        if name.startswith('jni/') and name.endswith('.so'):
                            digest = hashlib.sha256(read_member(archive, info)).hexdigest()
                            natives[name[4:]].append({'ref': ref, 'sha256': digest})
        materials.append(material)
        components.append(component)
    require(any(item['embeddedSha256'] for item in materials), 'Android inventory requires actual artifact digests')
    dependencies = [{'ref': components[index]['bom-ref'], 'dependsOn': sorted({components[target]['bom-ref'] for target in edges.get(index, [])})}
                    for index in range(len(components))]
    return {'components': components, 'materials': materials, 'dependencies': dependencies,
            'classes': classes, 'natives': natives, 'resources': resources,
            'edgeOccurrences': sum(len(targets) for targets in edges.values()),
            'duplicateEdges': sum(len(targets) - len(set(targets)) for targets in edges.values())}
