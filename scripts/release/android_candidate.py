"""Derive, inspect, scan and exercise a release APK from the preserved Android candidate AAB."""
import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile

from android_candidate_device import CandidateDevice, require_disposable_host
from android_candidate_package import certificate_identity, extract_universal_apk, manifest_identity, native_alignment, verify_payload_identity
from android_sbom import read_json
from android_sbom_inventory import InventoryError, no_links, regular_file, require, sha_file
from android_sbom_payload import tool_environment

ROOT = Path(__file__).resolve().parents[2]


def run(arguments, label, environment=None, timeout=120):
    """Run one tool without a shell; expose only stage-authored failures, never signing inputs or device diagnostics."""
    try:
        result = subprocess.run([str(value) for value in arguments], capture_output=True, cwd=ROOT,
                                env=tool_environment() if environment is None else environment, timeout=timeout)
    except (OSError, subprocess.SubprocessError):
        raise InventoryError(label + ' failed') from None
    require(result.returncode == 0, label + ' failed')
    return result.stdout


def tools_from_environment():
    """Resolve explicitly selected SDK/JDK tools before retaining their bytes as producer inputs."""
    values = {name: os.environ.get(name, '') for name in ('JAVA_HOME', 'ANDROID_HOME', 'DSH_ANDROID_BUILD_TOOLS_VERSION')}
    require(Path(values['JAVA_HOME']).is_absolute() and Path(values['ANDROID_HOME']).is_absolute(), 'Android candidate requires absolute Java and SDK roots')
    version = values['DSH_ANDROID_BUILD_TOOLS_VERSION']
    require(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', version), 'Android candidate requires an explicit SDK build-tools version')
    java, sdk = Path(values['JAVA_HOME']), Path(values['ANDROID_HOME'])
    build = sdk / 'build-tools' / version
    readelf = shutil.which('readelf')
    require(readelf, 'Android candidate requires readelf')
    paths = {'java': java / 'bin/java', 'keytool': java / 'bin/keytool', 'aapt2': build / 'aapt2',
             'apksigner': build / 'apksigner', 'zipalign': build / 'zipalign',
             'apkanalyzer': sdk / 'cmdline-tools/latest/bin/apkanalyzer', 'adb': sdk / 'platform-tools/adb',
             'readelf': Path(readelf)}
    return {name: regular_file(path.resolve(strict=True)) for name, path in paths.items()}, version


def validate_request(request, checkout_sha):
    """Reject incomplete process input or a source mismatch before the producer creates signing material."""
    require(isinstance(request, dict) and set(request) == {'sourceSha', 'identity'}, 'Invalid Android candidate request')
    require(isinstance(request['sourceSha'], str) and re.fullmatch(r'[a-f0-9]{40}', request['sourceSha'])
            and request['sourceSha'] == checkout_sha, 'Android candidate checkout differs from requested source')
    identity = request['identity']
    require(isinstance(identity, dict) and isinstance(identity.get('version'), str) and identity['version']
            and type(identity.get('buildNumber')) is int and 1 <= identity['buildNumber'] <= 65535
            and identity.get('channel') in ('dev', 'canary', 'beta', 'stable'), 'Invalid Android candidate product identity')


def produce(output, request, temporary):
    """Produce observations from owned artifacts and one disposable emulator; incomplete stages never write PASS."""
    require_disposable_host(sys.platform, os.environ)
    validate_request(request, run(['git', 'rev-parse', 'HEAD'], 'Candidate source lookup').decode().strip())
    require(not run(['git', 'status', '--porcelain', '--untracked-files=normal'], 'Candidate source check').strip(), 'Android candidate source must be clean')
    require(os.environ.get('DSH_ANDROID_SIGNING_MODE', 'unsigned') == 'unsigned'
            and not any(name.startswith('DSH_ANDROID_SIGNING_') and name != 'DSH_ANDROID_SIGNING_MODE' for name in os.environ),
            'Android candidate producer must not receive signing material')
    no_links(output)
    require(output.is_relative_to(temporary) and output != temporary, 'Android candidate output must be beneath RUNNER_TEMP')
    tools, build_tools_version = tools_from_environment()
    tool_hashes = {name: sha_file(path) for name, path in tools.items()}
    bundle, mapping = output / 'app.aab', output / 'mapping.txt'
    before = {'bundleSha256': sha_file(bundle), 'mappingSha256': sha_file(mapping)}
    identity = request['identity']
    device = CandidateDevice(tools['adb'])
    device.runtime()
    print('Android candidate: derive APK', flush=True)
    with tempfile.TemporaryDirectory(prefix='dsh-android-rc-', dir=temporary) as scratch:
        work = Path(scratch).resolve()
        require(work.parent == temporary, 'Unexpected Android candidate temporary directory')
        with tempfile.TemporaryDirectory(prefix='private-', dir=work) as private:
            private = Path(private)
            store, password_file = private / 'debug.jks', private / 'password.txt'
            password = secrets.token_hex(24)
            password_file.write_text(password + '\n', encoding='utf-8')
            password_file.chmod(0o600)
            environment = {**tool_environment(), 'DSH_RC_TEST_PASSWORD': password}
            common = ['-keystore', store, '-alias', 'androiddebugkey', '-storepass:env', 'DSH_RC_TEST_PASSWORD']
            run([tools['keytool'], '-genkeypair', '-storetype', 'JKS', '-keypass:env', 'DSH_RC_TEST_PASSWORD',
                 '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=Android Debug,O=Android,C=US', '-noprompt', *common],
                'Temporary Android key generation', environment)
            certificate = output / 'debug-certificate.der'
            run([tools['keytool'], '-exportcert', '-file', certificate, *common], 'Android test certificate export', environment)
            apks = work / 'app.apks'
            environment = {**tool_environment(), 'DSH_ANDROID_RC_BUNDLE': str(bundle), 'DSH_ANDROID_RC_APKS': str(apks),
                           'DSH_ANDROID_RC_STORE': str(store), 'DSH_ANDROID_RC_PASSWORD_FILE': str(password_file),
                           'DSH_ANDROID_RC_AAPT2': str(tools['aapt2']), 'DSH_ANDROID_RC_CLASSPATH_RECEIPT': str(output / 'bundletool-classpath.json')}
            run([ROOT / 'apps/android/gradlew', '-p', ROOT / 'apps/android', '--offline', '--no-daemon', '--no-configuration-cache',
                 '-I', ROOT / 'scripts/release/android-candidate.init.gradle', ':app:buildCandidateApks'], 'Android candidate APK generation', environment, 600)
        apk = output / 'app.apk'
        extract_universal_apk(apks, apk)
        payload = verify_payload_identity(bundle, apk)
        signer = run([tools['apksigner'], 'verify', '--verbose', '--print-certs', apk], 'Android candidate signature verification').decode('utf-8')
        certificate_sha = certificate_identity(signer, certificate)
        document = run([tools['apkanalyzer'], 'manifest', 'print', apk], 'Android candidate manifest decoding')
        manifest = manifest_identity(document, identity['version'], identity['buildNumber'], identity['channel'])
        with (output / 'manifest.xml').open('xb') as stream:
            stream.write(document)
        run([tools['zipalign'], '-c', '-P', '16', '-v', '4', apk], 'Android candidate ZIP alignment')
        native = native_alignment(apk, tools['readelf'], work)
        print('Android candidate: scan retained AAB and mapping', flush=True)
        run([sys.executable, '-B', ROOT / 'scripts/release/android_sbom.py', '--bundle', bundle, '--mapping', mapping,
             '--output', output / 'inventory'], 'Android candidate inventory', timeout=1200)
        print('Android candidate: install and inspect release UI', flush=True)
        startup = device.startup(apk, manifest, output)
        require(before == {'bundleSha256': sha_file(bundle), 'mappingSha256': sha_file(mapping)}
                and startup['apkSha256'] == sha_file(apk), 'Android candidate artifacts changed during production')
        require(tool_hashes == {name: sha_file(path) for name, path in tools.items()}, 'Android candidate tools changed during production')
        observations = {'schemaVersion': 1, 'status': 'PASS', 'sourceSha': request['sourceSha'], 'identity': identity,
                        **before, 'payload': payload, 'certificateSha256': certificate_sha, 'manifest': manifest,
                        'native': native, 'zipAlignment': {'pageSizeBytes': 16384, 'status': 'PASS'},
                        'startup': startup, 'tools': {'buildToolsVersion': build_tools_version, 'sha256': tool_hashes}}
        observations['evidenceSha256'] = {name: sha_file(output / name) for name in (
            'manifest.xml', 'startup.xml', 'startup.png', 'installed-base.apk', 'bundletool-classpath.json',
            'inventory/inventory.json', 'inventory/sbom.cdx.json')}
    with (output / 'observations.json').open('x', encoding='utf-8') as stream:
        json.dump(observations, stream, ensure_ascii=False, indent=2)
        stream.write('\n')


def main():
    """Run only inside the hosted candidate job with an independently selected source and output root."""
    require_disposable_host(sys.platform, os.environ)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--request', type=Path, required=True)
    args = parser.parse_args()
    temporary = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
    produce(args.output.absolute(), read_json(args.request.absolute()), temporary)


if __name__ == '__main__':
    try:
        main()
    except InventoryError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception as error:
        print('Android candidate producer failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
