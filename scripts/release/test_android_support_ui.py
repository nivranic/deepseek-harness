"""System UI controls must belong to the expected package and expose unambiguous visible bounds."""

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
            device.shell.side_effect = [b"", b"", data]
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
