"""Install and inspect a release APK only on the single disposable candidate emulator."""
import re
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path
from xml.etree import ElementTree as ET

from android_sbom_inventory import InventoryError, require, sha_file
from android_sbom_payload import tool_environment


def require_disposable_host(platform: str, environment: dict) -> None:
    """Require the producer's disposable hosted Linux context before interacting with any device."""
    require(platform == 'linux' and environment.get('GITHUB_ACTIONS') == 'true'
            and environment.get('RUNNER_ENVIRONMENT') == 'github-hosted' and environment.get('RUNNER_OS') == 'Linux',
            'Android candidate device operations require disposable GitHub-hosted Linux')


class CandidateDevice:
    """Bind every command to one booted emulator; physical or ambiguous devices are rejected."""
    def __init__(self, adb: Path):
        require_disposable_host(sys.platform, os.environ)
        self.adb = adb
        self.serial = None
        listing = self.command(['devices'], 'Android device selection').decode('utf-8').strip().splitlines()
        require(listing and listing[0].strip() == 'List of devices attached', 'Cannot enumerate Android devices')
        devices = [line.split() for line in listing[1:] if line.strip()]
        require(len(devices) == 1 and len(devices[0]) == 2 and devices[0][1] == 'device'
                and re.fullmatch(r'emulator-[0-9]+', devices[0][0]), 'Android candidate requires one online emulator')
        self.serial = devices[0][0]
        require(self.shell(['getprop', 'ro.kernel.qemu']).strip() == b'1'
                and self.shell(['getprop', 'sys.boot_completed']).strip() == b'1', 'Android candidate emulator is not booted')

    def command(self, arguments: list[str], label: str, timeout: float = 30, empty_exit: bool = False) -> bytes:
        """Run a selected adb command without a host shell or untrusted diagnostics in errors."""
        selector = ['-s', self.serial] if self.serial is not None else []
        try:
            result = subprocess.run([str(self.adb), *selector, *arguments], capture_output=True,
                                    timeout=timeout, env=tool_environment())
        except (OSError, subprocess.SubprocessError):
            raise InventoryError(label + ' failed') from None
        accepted = result.returncode == 0 or (empty_exit and result.returncode == 1
                                               and not result.stdout.strip() and not result.stderr.strip())
        require(accepted, label + ' failed')
        return result.stdout

    def shell(self, arguments: list[str], timeout: float = 30, empty_exit: bool = False) -> bytes:
        """Quote Android shell arguments separately, including legal dollar signs in Activity names."""
        return self.command(['shell', shlex.join(arguments)], 'Android shell operation', timeout, empty_exit)

    def runtime(self) -> dict:
        """Require the running device to expose API 36 and 16 KiB kernel pages before installing."""
        api = self.shell(['getprop', 'ro.build.version.sdk']).strip()
        pages = self.shell(['getconf', 'PAGE_SIZE']).strip()
        require(api == b'36' and pages == b'16384', 'Android candidate requires actual API 36 and 16 KiB pages')
        return {'apiLevel': 36, 'pageSizeBytes': 16384}

    def startup(self, apk: Path, manifest: dict, output: Path) -> dict:
        """Check the fresh release pairing screen and installed bytes, then stop and remove the test app."""
        runtime = self.runtime()
        package, launcher = manifest['package'], manifest['launcher']
        require(not self.shell(['pm', 'path', package], empty_exit=True).strip(), 'Android candidate application is already installed')
        apk_sha = sha_file(apk)
        installation_attempted = False
        primary = None
        observation = None
        try:
            installation_attempted = True
            self.command(['install', '--no-incremental', '-g', str(apk)], 'Android candidate installation', 120)
            launch = self.shell(['am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c',
                                 'android.intent.category.LAUNCHER', '-n', launcher])
            require(re.search(rb'(?m)^Status: ok\r?$', launch), 'Android did not accept the candidate Activity launch')
            deadline = time.monotonic() + 10
            hierarchy = None
            while time.monotonic() < deadline:
                remaining = max(0.1, deadline - time.monotonic())
                self.shell(['uiautomator', 'dump', '/data/local/tmp/dsh-candidate-ui.xml'], remaining)
                remaining = max(0.1, deadline - time.monotonic())
                current = self.shell(['cat', '/data/local/tmp/dsh-candidate-ui.xml'], remaining)
                if pairing_visible(current, package):
                    hierarchy = current
                    break
                time.sleep(min(0.1, max(0, deadline - time.monotonic())))
            require(hierarchy is not None, 'Android candidate pairing screen did not become visible')
            with (output / 'startup.xml').open('xb') as target:
                target.write(hierarchy)
            screenshot = self.command(['exec-out', 'screencap', '-p'], 'Android screenshot')
            require(screenshot.startswith(b'\x89PNG\r\n\x1a\n'), 'Android screenshot is not PNG')
            with (output / 'startup.png').open('xb') as target:
                target.write(screenshot)
            paths = self.shell(['pm', 'path', package]).decode('utf-8').strip().splitlines()
            require(len(paths) == 1 and re.fullmatch(r'package:/data/app/[^\r\n]+/base\.apk', paths[0]),
                    'Unexpected installed Android APK paths')
            local = output / 'installed-base.apk'
            self.command(['pull', paths[0].removeprefix('package:'), str(local)], 'Installed Android APK retrieval', 120)
            require(sha_file(local) == apk_sha, 'Installed Android APK differs from the candidate bytes')
            observation = {'runtime': runtime, 'apkSha256': apk_sha, 'installedApkSha256': apk_sha,
                           'pairingScreenVisible': True}
        except BaseException as failure:
            primary = failure
        try:
            if installation_attempted:
                if self.shell(['pm', 'path', package], empty_exit=True).strip():
                    self.shell(['am', 'force-stop', package])
                    self.command(['uninstall', package], 'Android candidate removal')
                require(not self.shell(['pidof', package], empty_exit=True).strip(), 'Android candidate process remains after stop')
                require(not self.shell(['pm', 'path', package], empty_exit=True).strip(), 'Android candidate remains after removal')
        except BaseException:
            if primary is not None:
                raise InventoryError('Android candidate operation and cleanup both failed') from primary
            raise
        if primary is not None:
            raise primary
        return {**observation, 'cleanup': {'processAbsent': True, 'packageAbsent': True}}


def pairing_visible(document: bytes, package: str) -> bool:
    """Require the real app's pairing title in a nonempty visible rectangle of the UI hierarchy."""
    root = ET.fromstring(document)
    require(root.tag == 'hierarchy', 'Unexpected Android UI hierarchy')
    for node in root.iter('node'):
        if node.get('package') != package or node.get('text') != '配对到宿主':
            continue
        bounds = re.fullmatch(r'\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]', node.get('bounds', ''))
        if bounds:
            x1, y1, x2, y2 = map(int, bounds.groups())
            if x2 > x1 and y2 > y1:
                return True
    return False
