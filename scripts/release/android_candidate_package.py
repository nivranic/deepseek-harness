"""Verify a release APK derived from the candidate AAB, its manifest, and packaged ELF alignment."""
import hashlib
import re
from pathlib import Path
from xml.etree import ElementTree as ET
import zipfile

from android_sbom_inventory import archive_entries, read_member, require, sha_file
from android_sbom_payload import execute

ANDROID = '{http://schemas.android.com/apk/res/android}'


def extract_universal_apk(apks: Path, output: Path) -> None:
    """Extract the sole universal APK without trusting archive paths or overwriting a previous artifact."""
    with zipfile.ZipFile(apks) as archive:
        entries = archive_entries(archive)
        require({name for name in entries if name.endswith('.apk')} == {'universal.apk'},
                'Candidate APK set requires exactly one universal APK')
        payload = read_member(archive, entries['universal.apk'])
    with output.open('xb') as destination:
        destination.write(payload)


def verify_payload_identity(bundle: Path, apk: Path) -> dict:
    """Require every derived DEX and native library to retain the preserved base AAB's exact bytes."""
    def payload(path, bundled):
        with zipfile.ZipFile(path) as archive:
            entries = archive_entries(archive)
            if bundled:
                require(not any(re.fullmatch(r'META-INF/[^/]+\.(RSA|DSA|EC|SF)', name, re.I) for name in entries),
                        'Android candidate AAB must be unsigned')
            result = {'dex': {}, 'native': {}}
            for name, info in entries.items():
                canonical = name.removeprefix('base/dex/') if bundled else name
                if re.fullmatch(r'classes[0-9]*\.dex', canonical):
                    result['dex'][canonical] = hashlib.sha256(read_member(archive, info)).hexdigest()
                canonical = name.removeprefix('base/') if bundled else name
                if re.fullmatch(r'lib/[^/]+/[^/]+\.so', canonical):
                    result['native'][canonical] = hashlib.sha256(read_member(archive, info)).hexdigest()
            require(result['dex'], 'Android candidate has no base DEX payload')
            return result
    source, derived = payload(bundle, True), payload(apk, False)
    require(source == derived, 'Derived APK DEX or native bytes differ from the preserved AAB')
    return {'bundleSha256': sha_file(bundle), 'apkSha256': sha_file(apk), **derived}


def manifest_identity(document: bytes, version: str, build_number: int, channel: str) -> dict:
    """Verify the decoded release manifest against the independently selected product identity."""
    root = ET.fromstring(document)
    require(root.tag == 'manifest' and root.get('package') == 'com.deepseek.harness.companion',
            'Unexpected Android candidate application id')
    require(root.get(ANDROID + 'versionName') == version and root.get(ANDROID + 'versionCode') == str(build_number),
            'Android candidate manifest version differs from product identity')
    sdk, application = root.find('uses-sdk'), root.find('application')
    require(sdk is not None and sdk.get(ANDROID + 'minSdkVersion') == '33'
            and sdk.get(ANDROID + 'targetSdkVersion') == '36', 'Android candidate SDK levels differ')
    require(application is not None, 'Android candidate has no application')
    for flag in ('debuggable', 'testOnly'):
        require(application.get(ANDROID + flag, 'false') == 'false', 'Android candidate must be a release application')
    channels = [node.get(ANDROID + 'value') for node in application.findall('meta-data')
                if node.get(ANDROID + 'name') == 'ai.deepseek.dsh.distributionChannel']
    require(channels == [channel], 'Android candidate distribution channel differs')
    launchers = []
    for activity in application.findall('activity') + application.findall('activity-alias'):
        for intent in activity.findall('intent-filter'):
            actions = {node.get(ANDROID + 'name') for node in intent.findall('action')}
            categories = {node.get(ANDROID + 'name') for node in intent.findall('category')}
            if 'android.intent.action.MAIN' in actions and 'android.intent.category.LAUNCHER' in categories:
                name = activity.get(ANDROID + 'name', '')
                require(re.fullmatch(r'\.?[A-Za-z_$][A-Za-z0-9_.$]*', name), 'Invalid Android launcher name')
                package = root.get('package')
                name = package + name if name.startswith('.') else package + '.' + name if '.' not in name else name
                launchers.append(package + '/' + name)
    require(len(launchers) == 1, 'Android candidate requires one launcher')
    return {'package': root.get('package'), 'version': version, 'buildNumber': build_number, 'channel': channel,
            'minSdk': 33, 'targetSdk': 36, 'debuggable': False, 'testOnly': False, 'launcher': launchers[0]}


def certificate_identity(output: str, certificate: Path) -> str:
    """Require apksigner's successful single signer to match the generated test certificate."""
    require(re.findall(r'(?m)^Number of signers: ([0-9]+)\s*$', output) == ['1'], 'Android candidate requires one signer')
    digests = re.findall(r'(?m)^Signer [^\r\n]*certificate SHA-256 digest: ([0-9a-f]{64})\s*$', output)
    digest = sha_file(certificate)
    require(digests == [digest], 'Android candidate signer differs from the temporary debug certificate')
    return digest


def elf_load_alignment(output: str) -> dict:
    """Parse readelf's complete LOAD alignment list; 64-bit libraries require at least 16 KiB alignment."""
    classes = re.findall(r'(?m)^\s*Class:\s+(ELF32|ELF64)\s*$', output)
    require(len(classes) == 1, 'Cannot determine packaged ELF class')
    loads = [line.split() for line in output.splitlines() if line.lstrip().startswith('LOAD ')]
    require(loads, 'Packaged ELF has no LOAD segment')
    alignments = []
    for fields in loads:
        require(len(fields) >= 8 and all(re.fullmatch(r'0x[0-9a-fA-F]+', value) for value in (fields[1], fields[2], fields[-1])),
                'Invalid ELF LOAD alignment')
        alignment = int(fields[-1], 16)
        require(alignment > 0 and alignment & (alignment - 1) == 0, 'Invalid ELF LOAD alignment')
        if classes[0] == 'ELF64':
            require((int(fields[1], 16) - int(fields[2], 16)) % 16384 == 0, 'Packaged ELF LOAD offsets differ at 16 KiB pages')
        alignments.append(alignment)
    if classes[0] == 'ELF64':
        require(all(alignment >= 16384 for alignment in alignments), 'Packaged 64-bit ELF is not aligned for 16 KiB pages')
    return {'elfClass': classes[0], 'loadAlignments': alignments}


def native_alignment(apk: Path, readelf: Path, work: Path) -> list[dict]:
    """Inspect each packaged native library with readelf while preserving its exact archive digest."""
    records = []
    with zipfile.ZipFile(apk) as archive:
        for name, info in sorted(archive_entries(archive).items()):
            if not re.fullmatch(r'lib/[^/]+/[^/]+\.so', name):
                continue
            content = read_member(archive, info)
            library = work / f'library-{len(records)}.so'
            with library.open('xb') as output:
                output.write(content)
            parsed = elf_load_alignment(execute([readelf, '-hlW', library], 'Packaged ELF inspection').decode('utf-8'))
            expected_class = {'arm64-v8a': 'ELF64', 'x86_64': 'ELF64', 'armeabi-v7a': 'ELF32', 'x86': 'ELF32'}.get(name.split('/')[1])
            require(expected_class is not None and parsed['elfClass'] == expected_class, 'Packaged ELF class differs from its ABI directory')
            records.append({'path': name, 'sha256': hashlib.sha256(content).hexdigest(), **parsed})
    return records
