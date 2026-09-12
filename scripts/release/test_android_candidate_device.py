"""Exercise release-device admission, byte identity, and cleanup through a controlled adb process."""
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from android_candidate_device import CandidateDevice, pairing_visible, require_disposable_host
from android_sbom_inventory import InventoryError

PACKAGE = 'com.deepseek.harness.companion'
UI = ('<hierarchy><node package="' + PACKAGE + '" text="配对到宿主" bounds="[10,10][200,70]"/></hierarchy>').encode()


class AdbProcess:
    def __init__(self):
        self.installed = False
        self.apk = b''
        self.api, self.pages = b'36', b'16384'
        self.listing = b'List of devices attached\nemulator-5554\tdevice\n'
        self.corrupt_pull = self.partial_install = self.fail_cleanup = False
        self.commands = []

    def __call__(self, arguments, **_options):
        command = arguments[1:] if arguments[1] != '-s' else arguments[3:]
        self.commands.append(command)
        code, output = 0, b''
        if command == ['devices']:
            output = self.listing
        elif command[0] == 'install':
            self.apk = Path(command[-1]).read_bytes()
            self.installed = True
            code = 1 if self.partial_install else 0
        elif command[0] == 'uninstall':
            code = 1 if self.fail_cleanup else 0
            self.installed = self.fail_cleanup
        elif command[0] == 'pull':
            Path(command[-1]).write_bytes(b'changed' if self.corrupt_pull else self.apk)
        elif command == ['exec-out', 'screencap', '-p']:
            output = b'\x89PNG\r\n\x1a\ncontrolled screenshot'
        elif command[0] == 'shell':
            shell = shlex.split(command[1])
            if shell[:1] == ['getprop']:
                output = self.api if shell[-1] == 'ro.build.version.sdk' else b'1'
            elif shell == ['getconf', 'PAGE_SIZE']:
                output = self.pages
            elif shell[:2] == ['pm', 'path']:
                output = b'package:/data/app/owned/base.apk\n' if self.installed else b''
            elif shell[:2] == ['am', 'start']:
                output = b'Status: ok\n'
            elif shell[:2] == ['am', 'force-stop'] or shell[0] == 'uiautomator':
                output = b''
            elif shell[0] == 'cat':
                output = UI
            elif shell[0] == 'pidof':
                code = 1
            else:
                raise AssertionError('Unexpected shell command in fixture')
        else:
            raise AssertionError('Unexpected adb command in fixture')
        diagnostics = b'private device diagnostics' if code == 1 and command[0] in ('install', 'uninstall') else b''
        return subprocess.CompletedProcess(arguments, code, output, diagnostics)


class AndroidCandidateDeviceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='dsh-android-device-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name).resolve()
        self.apk = self.work / 'app.apk'
        self.apk.write_bytes(b'controlled release APK')
        self.manifest = {'package': PACKAGE, 'launcher': PACKAGE + '/Nested$Activity'}
        self.process = AdbProcess()
        self.subprocess = patch('android_candidate_device.subprocess.run', side_effect=self.process)
        self.subprocess.start()
        self.addCleanup(self.subprocess.stop)
        self.host = patch('android_candidate_device.require_disposable_host')
        self.host.start()
        self.addCleanup(self.host.stop)

    def test_requires_disposable_host_before_any_device_command(self):
        self.host.stop()
        with patch('android_candidate_device.sys.platform', 'darwin'), self.assertRaises(InventoryError):
            CandidateDevice(Path('adb'))
        self.assertEqual(self.process.commands, [])
        valid = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux'}
        require_disposable_host('linux', valid)
        for platform, environment in [('win32', valid), ('linux', {}), ('linux', {**valid, 'RUNNER_ENVIRONMENT': 'self-hosted'})]:
            with self.assertRaises(InventoryError):
                require_disposable_host(platform, environment)

    def test_rejects_physical_ambiguous_and_offline_devices(self):
        for listing in [b'physical-device\tdevice', b'emulator-5554\tdevice\nemulator-5556\tdevice', b'emulator-5554\toffline']:
            self.process.listing = b'List of devices attached\n' + listing + b'\n'
            with self.assertRaises(InventoryError):
                CandidateDevice(Path('adb'))

    def test_distinguishes_absent_process_from_failed_device_query(self):
        device = CandidateDevice(Path('adb'))
        for code, output, diagnostics in [(1, b'', b'device unavailable'), (2, b'', b''), (1, b'123', b'')]:
            with self.subTest(code=code, output=output, diagnostics=diagnostics), \
                    patch('android_candidate_device.subprocess.run', return_value=subprocess.CompletedProcess([], code, output, diagnostics)):
                with self.assertRaisesRegex(InventoryError, '^Android shell operation failed$'):
                    device.shell(['pidof', PACKAGE], empty_exit=True)

    def test_checks_installed_bytes_and_pairing_then_removes_the_owned_app(self):
        result = CandidateDevice(Path('adb')).startup(self.apk, self.manifest, self.work)
        self.assertEqual(result['runtime'], {'apiLevel': 36, 'pageSizeBytes': 16384})
        self.assertEqual(result['apkSha256'], result['installedApkSha256'])
        self.assertTrue(result['pairingScreenVisible'])
        self.assertEqual(result['cleanup'], {'processAbsent': True, 'packageAbsent': True})
        self.assertFalse(self.process.installed)
        command = next(command[1] for command in self.process.commands if command[0] == 'shell' and command[1].startswith('am start'))
        self.assertEqual(shlex.split(command)[-1], self.manifest['launcher'])
        self.assertIn("'" + self.manifest['launcher'] + "'", command)

    def test_rejects_wrong_runtime_and_existing_apps_before_installation(self):
        for api, pages, installed in [(b'35', b'16384', False), (b'36', b'4096', False), (b'36', b'16384', True)]:
            self.process.api, self.process.pages, self.process.installed = api, pages, installed
            with self.assertRaises(InventoryError):
                CandidateDevice(Path('adb')).startup(self.apk, self.manifest, self.work)
        self.assertFalse(any(command[0] == 'install' for command in self.process.commands))

    def test_removes_a_partially_installed_app_after_adb_reports_failure(self):
        self.process.partial_install = True
        with self.assertRaisesRegex(InventoryError, 'installation'):
            CandidateDevice(Path('adb')).startup(self.apk, self.manifest, self.work)
        self.assertFalse(self.process.installed)
        self.assertIn(['uninstall', PACKAGE], self.process.commands)

    def test_rejects_different_installed_bytes_and_cleans_up(self):
        self.process.corrupt_pull = True
        with self.assertRaisesRegex(InventoryError, 'differs'):
            CandidateDevice(Path('adb')).startup(self.apk, self.manifest, self.work)
        self.assertFalse(self.process.installed)

    def test_retains_operation_failure_when_cleanup_also_fails(self):
        self.process.partial_install = self.process.fail_cleanup = True
        with self.assertRaisesRegex(InventoryError, 'operation and cleanup') as caught:
            CandidateDevice(Path('adb')).startup(self.apk, self.manifest, self.work)
        self.assertIn('installation', str(caught.exception.__cause__))

    def test_requires_the_app_title_in_a_nonempty_rectangle(self):
        self.assertTrue(pairing_visible(UI, PACKAGE))
        self.assertFalse(pairing_visible(UI.replace(PACKAGE.encode(), b'another.package'), PACKAGE))
        self.assertFalse(pairing_visible(UI.replace(b'[10,10][200,70]', b'[0,0][0,0]'), PACKAGE))


if __name__ == '__main__':
    unittest.main()
