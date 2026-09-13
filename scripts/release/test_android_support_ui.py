"""System UI controls must belong to the expected package and expose unambiguous visible bounds."""

import json
import itertools
import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
from xml.etree import ElementTree as ET

from android_support_ui import DOCUMENTS, PACKAGE, SupportUi, matching, point
from android_candidate_device import DeviceCommandError


class AndroidSupportUiTests(unittest.TestCase):
    def test_failed_hierarchy_queries_capture_outcome_before_cleanup_without_retaining_device_text(self):
        for query, command_count in (("remove-observation", 1), ("dump-hierarchy", 2), ("read-hierarchy", 3)):
            with self.subTest(query=query), tempfile.TemporaryDirectory() as directory:
                device = Mock(); ui = SupportUi(device, Path(directory), "a" * 32)
                with patch("android_candidate_device.time.monotonic", return_value=2):
                    failure = DeviceCommandError("fixed query", "timeout", 1, 0.9)
                device.shell.side_effect = ([b"", ui.path.encode()] + [failure])[-command_count:]
                with self.assertRaises(DeviceCommandError):
                    ui.observe()
                failure.observation["outcome"] = "later mutation"
                device.shell.side_effect = None
                ui.close()
                ui.record_failure()
                record = json.loads((Path(directory) / "ui-failure.json").read_bytes())
                self.assertEqual(record["query"], query)
                self.assertEqual(record["observationAttempts"], 1)
                self.assertEqual(record["commandFailure"], {"outcome": "timeout", "exitCode": None,
                                                           "elapsedMilliseconds": 1000, "timeoutMilliseconds": 900})
                self.assertNotIn(ui.path, json.dumps(record))
                self.assertEqual(record["screenshot"], "not-captured")

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

    def test_failure_receipt_retains_only_owned_fixed_export_categories(self):
        cases = [("Diagnostics expired. Export again", "approvalLost"),
                 ("Cannot write to the selected destination. Export again", "saveFailed"),
                 ("Diagnostics unavailable", "preparationFailed")]
        for text, category in cases:
            for package in (PACKAGE, "foreign"):
                with self.subTest(category=category, package=package), tempfile.TemporaryDirectory() as directory:
                    device = Mock(); ui = SupportUi(device, Path(directory), "a" * 32)
                    root = ET.Element("hierarchy")
                    ET.SubElement(root, "node", {"package": PACKAGE, "text": "Export diagnostics"})
                    ET.SubElement(root, "node", {"package": package, "text": text})
                    ET.SubElement(root, "node", {"package": PACKAGE, "text": "private destination or exception"})
                    device.shell.side_effect = [b"", ui.path.encode(), ET.tostring(root)]
                    ui.observe()
                    with patch.object(ui, "screenshot"):
                        ui.record_failure()
                    serialized = (Path(directory) / "ui-failure.json").read_text()
                    record = json.loads(serialized)
                    for _, field in cases:
                        self.assertEqual(record["controls"][field], package == PACKAGE and field == category)
                    self.assertNotIn("private destination", serialized)
                    self.assertNotIn(text, serialized)

    def test_unowned_filename_is_rejected_before_observing_or_clicking(self):
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        for filename in ("../private.json", "dsh-support.json", "x;echo bad.json"):
            with self.assertRaises(ValueError):
                ui.open_picker(filename)
        device.shell.assert_not_called()

    def test_waits_for_filename_and_downloads_in_the_same_fresh_picker_observation(self):
        filename = "dsh-support-" + "a" * 32 + ".json"
        app = ET.fromstring('<hierarchy><node package="' + PACKAGE + '" text="Export diagnostics" enabled="true" bounds="[0,0][10,10]"/>'
                            '<node package="' + PACKAGE + '" text="配对到宿主"/></hierarchy>')
        field = '<node package="' + DOCUMENTS + '" resource-id="android:id/title" class="android.widget.EditText" enabled="true" bounds="[10,10][20,20]"/>'
        breadcrumb = '<node package="' + DOCUMENTS + '" resource-id="' + DOCUMENTS + ':id/breadcrumb_text" text="Downloads"/>'
        filename_only = ET.fromstring('<hierarchy>' + field + '</hierarchy>')
        location_only = ET.fromstring('<hierarchy>' + breadcrumb + '</hierarchy>')
        ready = ET.fromstring('<hierarchy>' + field + breadcrumb + '</hierarchy>')
        confirmed = ET.fromstring('<hierarchy><node package="' + DOCUMENTS + '" resource-id="android:id/title" text="' + filename + '"/></hierarchy>')
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        observations = iter((app, filename_only, location_only, ready, confirmed))
        def observe(_timeout):
            root = next(observations)
            if root in (filename_only, location_only, ready):
                self.assertEqual(device.shell.call_count, 1, "only the export action may be clicked before complete picker readiness")
            return root
        with patch.object(ui, "observe", side_effect=observe), patch("android_support_ui.time.sleep"):
            self.assertIs(ui.open_picker(filename), confirmed)
        self.assertEqual(ui.step, "filename-confirmation")

    def test_incomplete_picker_location_cannot_admit_filename_entry(self):
        filename = "dsh-support-" + "a" * 32 + ".json"
        app = ET.fromstring('<hierarchy><node package="' + PACKAGE + '" text="Export diagnostics" enabled="true" bounds="[0,0][10,10]"/>'
                            '<node package="' + PACKAGE + '" text="配对到宿主"/></hierarchy>')
        wrong = ET.fromstring('<hierarchy><node package="' + DOCUMENTS + '" resource-id="android:id/title" class="android.widget.EditText"/>'
                              '<node package="' + DOCUMENTS + '" resource-id="' + DOCUMENTS + ':id/breadcrumb_text" text="Foreign location"/></hierarchy>')
        device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
        with patch.object(ui, "observe", side_effect=[app, wrong, ValueError("fixture deadline")]), \
                patch("android_support_ui.time.sleep"), self.assertRaises(ValueError):
            ui.open_picker(filename)
        self.assertEqual(device.shell.call_count, 1)

    def test_filename_keyboard_is_dismissed_before_confirming_the_same_picker_and_exact_name(self):
        filename = "dsh-support-" + "a" * 32 + ".json"
        app = ET.Element("hierarchy")
        ET.SubElement(app, "node", {"package": PACKAGE, "text": "Export diagnostics", "enabled": "true", "bounds": "[0,0][10,10]"})
        ET.SubElement(app, "node", {"package": PACKAGE, "text": "配对到宿主"})
        picker = ET.Element("hierarchy")
        ET.SubElement(picker, "node", {"package": DOCUMENTS, "resource-id": "android:id/title", "class": "android.widget.EditText",
                                      "text": "dsh-support.json", "enabled": "true", "bounds": "[10,10][20,20]"})
        ET.SubElement(picker, "node", {"package": DOCUMENTS, "resource-id": DOCUMENTS + ":id/breadcrumb_text", "text": "Downloads"})
        for final_package, final_name, accepted in ((DOCUMENTS, filename, True), (PACKAGE, filename, False),
                                                    (DOCUMENTS, "different.json", False)):
            final = ET.Element("hierarchy")
            ET.SubElement(final, "node", {"package": final_package, "resource-id": "android:id/title", "text": final_name})
            roots = iter((app, picker, final))
            device = Mock(); ui = SupportUi(device, Path("unused"), "a" * 32)
            def wait(predicate, label):
                root = next(roots)
                if root is final:
                    self.assertEqual(device.shell.call_args.args[0], ["input", "keyevent", "KEYCODE_BACK"])
                if not predicate(root):
                    raise ValueError(label)
                return root
            with self.subTest(package=final_package, name=final_name), patch.object(ui, "wait", side_effect=wait):
                if accepted:
                    self.assertIs(ui.open_picker(filename), final)
                else:
                    with self.assertRaises(ValueError):
                        ui.open_picker(filename)
                self.assertEqual(ui.step, "filename-confirmation")
                self.assertEqual([call.args[0] for call in device.shell.call_args_list][-2:],
                                 [["input", "text", filename], ["input", "keyevent", "KEYCODE_BACK"]])

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
