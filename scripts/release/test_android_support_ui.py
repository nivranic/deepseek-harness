"""System UI controls must belong to the expected package and expose unambiguous visible bounds."""

import json
import itertools
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from xml.etree import ElementTree as ET

from android_support_ui import DOCUMENTS, PACKAGE, SupportUi, matching, point


class AndroidSupportUiTests(unittest.TestCase):
    def test_rejects_ambiguous_disabled_and_nonvisible_controls(self):
        for attributes in ({"bounds": "[0,0][0,0]", "enabled": "true"}, {"bounds": "bad", "enabled": "true"},
                           {"bounds": "[0,0][20,40]", "enabled": "false"}):
            with self.assertRaises(ValueError):
                point(ET.Element("node", attributes))
        self.assertEqual(point(ET.Element("node", {"bounds": "[10,20][30,60]", "enabled": "true"})), ("20", "40"))
        root = ET.fromstring('<hierarchy><node package="foreign" text="SAVE"/></hierarchy>')
        self.assertEqual(matching(root, DOCUMENTS, text="SAVE"), [])
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        with self.assertRaises(ValueError):
            ui.click(root, DOCUMENTS, text="SAVE")
        root.extend([ET.Element("node", {"package": DOCUMENTS, "text": "SAVE"}) for _ in range(2)])
        with self.assertRaises(ValueError):
            ui.click(root, DOCUMENTS, text="SAVE")
        device.shell.assert_not_called()

    def test_cancel_returns_when_app_recovers_and_handles_keyboard_first(self):
        picker = ET.fromstring('<hierarchy><node package="' + DOCUMENTS + '" resource-id="android:id/button1"/></hierarchy>')
        cancelled = ET.fromstring('<hierarchy><node package="' + PACKAGE + '" text="Export cancelled"/><node package="' + PACKAGE + '" text="Export diagnostics"/></hierarchy>')
        for roots, count in (([cancelled], 1), ([picker, cancelled], 2)):
            device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
            with patch.object(ui, "wait", side_effect=roots):
                ui.cancel()
            self.assertEqual(device.shell.call_count, count)
        with patch.object(ui, "wait", return_value=picker), self.assertRaises(ValueError):
            ui.cancel()

    def test_unowned_filename_is_rejected_before_observing_or_clicking(self):
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        for filename in ("../private.json", "dsh-support.json", "x;echo bad.json"):
            with self.assertRaises(ValueError):
                ui.open_picker(filename)
        device.shell.assert_not_called()

    def test_observation_rejects_oversized_hierarchy_and_foreign_root(self):
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        for data in (b"x" * (2 * 1024 * 1024 + 1), b"<foreign/>"):
            device.shell.side_effect = [b"", ui.path.encode(), data]
            with self.assertRaises(ValueError):
                ui.observe()

    def test_screenshots_require_png_and_cannot_overwrite_existing_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            device = Mock(); ui = SupportUi(device, Path(directory), "a" * 32)
            device.command.return_value = b"not PNG"
            with self.assertRaises(ValueError):
                ui.screenshot("saved")
            device.command.return_value = b"\x89PNG\r\n\x1a\nfixture"
            ui.screenshot("saved")
            with self.assertRaises(FileExistsError):
                ui.screenshot("saved")

    def test_failure_metadata_projects_controls_without_retaining_ui_text_or_attributes(self):
        with tempfile.TemporaryDirectory() as directory:
            device = Mock(); ui = SupportUi(device, Path(directory), "a" * 32)
            root = ET.Element("hierarchy")
            ET.SubElement(root, "node", {"package": DOCUMENTS, "resource-id": "android:id/title",
                                         "class": "android.widget.EditText", "text": "private-document-name",
                                         "content-desc": "private-description"})
            ET.SubElement(root, "node", {"package": DOCUMENTS, "resource-id": DOCUMENTS + ":id/breadcrumb_text", "text": "Downloads"})
            device.shell.side_effect = [b"", ui.path.encode(), ET.tostring(root)]
            ui.step = "local-location"
            ui.observe()
            device.command.return_value = b"\x89PNG\r\n\x1a\nfixture"
            ui.record_failure()
            text = (Path(directory) / "ui-failure.json").read_text(encoding="utf-8")
            self.assertNotIn("private", text)
            value = json.loads(text)
            self.assertEqual(value["step"], "local-location")
            self.assertEqual(value["query"], "observed")
            self.assertEqual(value["screenshot"], "captured")
            self.assertEqual(value["controls"]["filenameFields"], 1)
            self.assertTrue(value["controls"]["downloadsBreadcrumb"])
            self.assertFalse(value["controls"]["expectedFilename"])
            self.assertTrue((Path(directory) / "failed.png").exists())

    def test_unknown_app_is_not_captured_and_screenshot_errors_do_not_expose_device_output(self):
        for package in ("unknown.application", PACKAGE):
            with self.subTest(package=package), tempfile.TemporaryDirectory() as directory:
                device = Mock(); ui = SupportUi(device, Path(directory), "a" * 32)
                device.shell.side_effect = [b"", ui.path.encode(), ('<hierarchy><node package="' + package + '"/></hierarchy>').encode()]
                ui.observe()
                device.command.side_effect = ValueError("private-device-output")
                ui.record_failure()
                text = (Path(directory) / "ui-failure.json").read_text(encoding="utf-8")
                self.assertNotIn("private", text)
                self.assertEqual(json.loads(text)["screenshot"], "not-captured" if package == "unknown.application" else "failed")
                self.assertEqual(device.command.call_count, 0 if package == "unknown.application" else 1)

    def test_waits_for_a_fresh_dump_after_a_transition_without_reading_stale_xml(self):
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        data = ('<hierarchy><node package="' + PACKAGE + '" text="Export diagnostics"/></hierarchy>').encode()
        device.shell.side_effect = [b"", b"", b"", ui.path.encode(), data]
        with patch("android_support_ui.time.sleep"):
            root = ui.wait(lambda tree: matching(tree, PACKAGE, text="Export diagnostics"), "Export action")
        self.assertTrue(matching(root, PACKAGE, text="Export diagnostics"))
        self.assertEqual([call.args[0][0] for call in device.shell.call_args_list], ["rm", "uiautomator", "rm", "uiautomator", "cat"])

    def test_missing_dumps_keep_the_deadline_and_device_errors_remain_terminal(self):
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        device.shell.return_value = b""
        predicate = Mock()
        with patch("android_support_ui.time.monotonic", side_effect=itertools.count(0, 0.05)), \
                patch("android_support_ui.time.sleep"), self.assertRaises(ValueError):
            ui.wait(predicate, "Export action", timeout=0.3)
        predicate.assert_not_called()
        self.assertFalse(any(call.args[0][0] == "cat" for call in device.shell.call_args_list))
        device.shell.reset_mock(); device.shell.side_effect = ValueError("device unavailable")
        with self.assertRaises(ValueError):
            ui.wait(predicate, "Export action")
        self.assertEqual(device.shell.call_count, 1)
