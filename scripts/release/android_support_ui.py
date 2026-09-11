"""Drive only the unpaired Companion and Android's local DocumentsUI on an owned emulator."""

import json
import re
import time
from xml.etree import ElementTree as ET

from android_sbom_inventory import require

PACKAGE = "com.deepseek.harness.companion"
DOCUMENTS = "com.google.android.documentsui"


def matching(document, package, **attributes):
    """Select controls by their owning package and exact observable attributes."""
    return [node for node in document.iter("node") if node.get("package") == package
            and all(node.get(key) == value for key, value in attributes.items())]


def point(node):
    """Reject disabled or empty controls instead of clicking an unrelated screen coordinate."""
    bounds = re.fullmatch(r"\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]", node.get("bounds", ""))
    require(bounds is not None and node.get("enabled") == "true", "Android support control is unavailable")
    x1, y1, x2, y2 = map(int, bounds.groups())
    require(x2 > x1 and y2 > y1, "Android support control has no visible bounds")
    return str((x1 + x2) // 2), str((y1 + y2) // 2)


class SupportUi:
    """Bounded observations use a private device XML path and retain scenario-owned screenshots."""
    def __init__(self, device, output, nonce):
        require(re.fullmatch(r"[a-f0-9]{32}", nonce) is not None, "Invalid Android support observation id")
        self.device, self.output = device, output
        self.path = "/data/local/tmp/dsh-support-ui-" + nonce + ".xml"
        self.step = "not-started"
        self.query = "not-started"
        self.expected_filename = None
        self.controls = None

    def observe(self, timeout=30):
        """Read a fresh hierarchy; a dump without a published target is a pending UI observation."""
        deadline = time.monotonic() + timeout
        self.query = "remove-observation"
        self.device.shell(["rm", "-f", self.path], max(0.1, deadline - time.monotonic()))
        self.query = "dump-hierarchy"
        dumped = self.device.shell(["uiautomator", "dump", self.path], max(0.1, deadline - time.monotonic()))
        if self.path.encode("utf-8") not in dumped:
            return None
        self.query = "read-hierarchy"
        data = self.device.shell(["cat", self.path], max(0.1, deadline - time.monotonic()))
        self.query = "parse-hierarchy"
        require(0 < len(data) <= 2 * 1024 * 1024, "Android support hierarchy exceeds its byte limit")
        root = ET.fromstring(data)
        require(root.tag == "hierarchy", "Unexpected Android support hierarchy")
        self.controls = {
            "companionVisible": bool(matching(root, PACKAGE)),
            "googleDocumentsVisible": bool(matching(root, DOCUMENTS)),
            "aospDocumentsVisible": bool(matching(root, "com.android.documentsui")),
            "exportAction": bool(matching(root, PACKAGE, text="Export diagnostics")),
            "pairingTitle": bool(matching(root, PACKAGE, text="配对到宿主")),
            "filenameFields": min(2, len(matching(root, DOCUMENTS, **{"resource-id": "android:id/title", "class": "android.widget.EditText"}))),
            "downloadsBreadcrumb": bool(matching(root, DOCUMENTS, **{"resource-id": DOCUMENTS + ":id/breadcrumb_text", "text": "Downloads"})),
            "expectedFilename": self.expected_filename is not None and bool(matching(root, DOCUMENTS, **{"resource-id": "android:id/title", "text": self.expected_filename})),
            "saveButtons": min(2, len(matching(root, DOCUMENTS, **{"resource-id": "android:id/button1", "text": "SAVE"}))),
            "approvalLost": bool(matching(root, PACKAGE, text="Diagnostics expired. Export again")),
            "saveFailed": bool(matching(root, PACKAGE, text="Cannot write to the selected destination. Export again")),
            "preparationFailed": bool(matching(root, PACKAGE, text="Diagnostics unavailable")),
        }
        self.query = "observed"
        return root

    def wait(self, predicate, label, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            root = self.observe(max(0.1, deadline - time.monotonic()))
            if root is not None and predicate(root):
                return root
            time.sleep(min(0.2, max(0, deadline - time.monotonic())))
        raise ValueError(label + " did not become visible")

    def click(self, root, package, **attributes):
        nodes = matching(root, package, **attributes)
        require(len(nodes) == 1, "Android support control selection is ambiguous")
        self.device.shell(["input", "tap", *point(nodes[0])])

    def open_picker(self, filename):
        require(re.fullmatch(r"dsh-support-[a-f0-9]{32}\.json", filename) is not None,
                "Android support filename must be test-owned")
        self.expected_filename = filename
        self.step = "export-action"
        root = self.wait(lambda tree: matching(tree, PACKAGE, text="Export diagnostics")
                         and matching(tree, PACKAGE, text="配对到宿主"), "Unpaired export action")
        self.click(root, PACKAGE, text="Export diagnostics")
        self.step = "local-picker"
        root = self.wait(lambda tree: matching(tree, DOCUMENTS, **{"resource-id": "android:id/title", "class": "android.widget.EditText"}),
                         "Local document picker")
        self.step = "local-location"
        require(matching(root, DOCUMENTS, **{"resource-id": DOCUMENTS + ":id/breadcrumb_text", "text": "Downloads"}),
                "Android support picker must select local Downloads")
        self.step = "filename-entry"
        self.click(root, DOCUMENTS, **{"resource-id": "android:id/title", "class": "android.widget.EditText"})
        self.device.shell(["input", "keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_A"])
        self.device.shell(["input", "text", filename])
        self.step = "filename-confirmation"
        return self.wait(lambda tree: matching(tree, DOCUMENTS, **{"resource-id": "android:id/title", "text": filename}),
                         "Owned document filename")

    def cancel(self):
        self.step = "cancel"
        # Back can first dismiss the input method; a second Back is allowed only while the picker remains.
        for _ in range(2):
            self.device.shell(["input", "keyevent", "KEYCODE_BACK"])
            root = self.wait(lambda tree: matching(tree, PACKAGE, text="Export cancelled")
                             or matching(tree, DOCUMENTS, **{"resource-id": "android:id/button1"}), "Picker cancellation")
            if matching(root, PACKAGE, text="Export cancelled"):
                require(matching(root, PACKAGE, text="Export diagnostics"), "Export action did not recover after cancellation")
                return
        raise ValueError("Android document picker did not cancel")

    def save(self, root):
        self.step = "save"
        self.click(root, DOCUMENTS, **{"resource-id": "android:id/button1", "text": "SAVE"})
        self.wait(lambda tree: matching(tree, PACKAGE, text="Diagnostics saved")
                  and matching(tree, PACKAGE, text="Export diagnostics"), "Saved export")

    def screenshot(self, name):
        require(name in ("cancelled", "saved", "failed"), "Unexpected Android support screenshot phase")
        data = self.device.command(["exec-out", "screencap", "-p"], "Android support screenshot")
        require(data.startswith(b"\x89PNG\r\n\x1a\n"), "Android support screenshot is not PNG")
        with (self.output / (name + ".png")).open("xb") as file:
            file.write(data)

    def close(self):
        self.device.shell(["rm", "-f", self.path])

    def record_failure(self):
        """Retain fixed control observations and a screenshot after observing the Companion or system picker."""
        record = {"schemaVersion": 1, "step": self.step, "query": self.query,
                  "observation": "last-successful-hierarchy", "controls": self.controls, "screenshot": "not-captured"}
        if self.controls and any(self.controls[key] for key in ("companionVisible", "googleDocumentsVisible", "aospDocumentsVisible")):
            try:
                self.screenshot("failed")
            except Exception:
                # Failed screenshot commands may include device diagnostics; only the fixed outcome is retained.
                record["screenshot"] = "failed"
            else:
                record["screenshot"] = "captured"
        with (self.output / "ui-failure.json").open("x", encoding="utf-8") as target:
            target.write(json.dumps(record, indent=2) + "\n")
