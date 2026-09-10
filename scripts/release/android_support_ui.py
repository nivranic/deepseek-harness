"""Drive only the unpaired Companion and Android's local DocumentsUI on an owned emulator."""

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

    def observe(self, timeout=30):
        deadline = time.monotonic() + timeout
        self.device.shell(["rm", "-f", self.path], max(0.1, deadline - time.monotonic()))
        self.device.shell(["uiautomator", "dump", self.path], max(0.1, deadline - time.monotonic()))
        data = self.device.shell(["cat", self.path], max(0.1, deadline - time.monotonic()))
        require(0 < len(data) <= 2 * 1024 * 1024, "Android support hierarchy exceeds its byte limit")
        root = ET.fromstring(data)
        require(root.tag == "hierarchy", "Unexpected Android support hierarchy")
        return root

    def wait(self, predicate, label, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            root = self.observe(max(0.1, deadline - time.monotonic()))
            if predicate(root):
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
        root = self.wait(lambda tree: matching(tree, PACKAGE, text="Export diagnostics")
                         and matching(tree, PACKAGE, text="配对到宿主"), "Unpaired export action")
        self.click(root, PACKAGE, text="Export diagnostics")
        root = self.wait(lambda tree: matching(tree, DOCUMENTS, **{"resource-id": "android:id/title", "class": "android.widget.EditText"}),
                         "Local document picker")
        require(matching(root, DOCUMENTS, **{"resource-id": DOCUMENTS + ":id/breadcrumb_text", "text": "Downloads"}),
                "Android support picker must select local Downloads")
        self.click(root, DOCUMENTS, **{"resource-id": "android:id/title", "class": "android.widget.EditText"})
        self.device.shell(["input", "keycombination", "KEYCODE_CTRL_LEFT", "KEYCODE_A"])
        self.device.shell(["input", "text", filename])
        return self.wait(lambda tree: matching(tree, DOCUMENTS, **{"resource-id": "android:id/title", "text": filename}),
                         "Owned document filename")

    def cancel(self):
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
        self.click(root, DOCUMENTS, **{"resource-id": "android:id/button1", "text": "SAVE"})
        self.wait(lambda tree: matching(tree, PACKAGE, text="Diagnostics saved")
                  and matching(tree, PACKAGE, text="Export diagnostics"), "Saved export")

    def screenshot(self, name):
        require(name in ("cancelled", "saved"), "Unexpected Android support screenshot phase")
        data = self.device.command(["exec-out", "screencap", "-p"], "Android support screenshot")
        require(data.startswith(b"\x89PNG\r\n\x1a\n"), "Android support screenshot is not PNG")
        with (self.output / (name + ".png")).open("xb") as file:
            file.write(data)

    def close(self):
        self.device.shell(["rm", "-f", self.path])
