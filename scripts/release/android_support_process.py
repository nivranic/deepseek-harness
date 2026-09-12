"""Project Android 16 system exit records without publishing process identifiers or diagnostic text."""

import re
import subprocess
from decimal import Decimal, ROUND_HALF_UP

from android_support_ui import PACKAGE

HEADER = "ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)"
# ApplicationExitInfo reason codes from Android 16, the candidate emulator's platform.
REASONS = ("unknown", "exit-self", "signaled", "low-memory", "crash", "crash-native", "anr",
           "initialization-failure", "permission-change", "excessive-resource-usage", "user-requested",
           "user-stopped", "dependency-died", "other", "freezer", "package-state-change", "package-updated")


def sampled_memory(line):
    """Android 16 prints rounded binary units from its last PSS/RSS sample, not memory at death or peak use."""
    fields = re.match(r"\s*importance=[0-9]{1,10} pss=(\S{1,16}) rss=(\S{1,16}) description=", line)
    result = {}
    for index, name in enumerate(("pss", "rss"), 1):
        result[name] = {"observation": "unavailable"}
        value = re.fullmatch(r"([0-9]{1,4}(?:[.,][0-9]{1,2})?)(KB|MB|GB|TB|PB)?", fields[index]) if fields else None
        if value is None:
            continue
        magnitude = Decimal(value[1].replace(",", "."))
        if magnitude == 0:
            result[name] = {"observation": "not-sampled"}
            continue
        power = (None, "KB", "MB", "GB", "TB", "PB").index(value[2])
        kib = int((magnitude * Decimal(1024) ** (power - 1)).to_integral_value(rounding=ROUND_HALF_UP))
        if 0 < kib <= (2 ** 63 - 1) // 1024:
            result[name] = {"observation": "last-known", "approximateKiB": kib}
    return result


def parse_exit_records(data):
    """Retain private timestamp/PID keys only for matching new records to observed application processes."""
    if not data or len(data) > 65536:
        raise ValueError("Android exit observation byte limit")
    lines = data.decode("utf-8").splitlines()
    if len(lines) < 2 or lines[0].strip() != HEADER or not re.fullmatch(
            r"Last Timestamp of Persistence Into Persistent Storage: [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}",
            lines[1]):
        raise ValueError("Android exit observation header differs")
    records = {}
    index = 2
    while index < len(lines):
        line = lines[index]
        if not line.strip() or line.strip() == "package: " + PACKAGE or re.fullmatch(r"\s*Historical Process Exit for uid=[0-9]{1,10}", line):
            index += 1
            continue
        if not re.fullmatch(r"\s*ApplicationExitInfo #[0-9]{1,3}:", line) or index + 3 >= len(lines):
            raise ValueError("Android exit observation record differs")
        identity = re.fullmatch(
            r"\s*timestamp=([0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3})"
            r" pid=([1-9][0-9]{0,9}) realUid=-?[0-9]{1,10} packageUid=-?[0-9]{1,10} definingUid=-?[0-9]{1,10} user=-?[0-9]{1,10}",
            lines[index + 1])
        fields = re.fullmatch(
            r"\s*process=(\S{1,256}) reason=([0-9]{1,10}) \([^\r\n)]{0,100}\)"
            r" subreason=([0-9]{1,10}) \([^\r\n)]{0,100}\) status=(-?[0-9]{1,10})", lines[index + 2])
        if identity is None or fields is None or not lines[index + 3].lstrip().startswith("importance="):
            raise ValueError("Android exit observation fields differ")
        memory = sampled_memory(lines[index + 3])
        index += 4
        if fields[1] != PACKAGE:
            continue
        key = (identity[1], int(identity[2]))
        if key in records or len(records) >= 64:
            raise ValueError("Android exit observation is ambiguous")
        records[key] = (*tuple(int(fields[column]) for column in (2, 3, 4)), memory)
    return records


def application_exit_records(device):
    """A five-second system query is optional diagnostics and never replaces an export result."""
    try:
        data = device.shell(["dumpsys", "activity", "exit-info", PACKAGE], timeout=5)
        return parse_exit_records(data)
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def observe_application_exits(device, baseline, pids):
    """Report only records absent before the scenario and matching one of its observed main-process PIDs."""
    current = application_exit_records(device)
    observed = {pid for pid in pids if pid is not None}
    if baseline is None or current is None or not observed:
        return {"observation": "unavailable"}
    selected = [fields for key, fields in current.items() if key not in baseline and key[1] in observed]
    if not selected:
        return {"observation": "not-observed"}
    return {"observation": "observed", "records": [
        {"reason": REASONS[reason] if reason < len(REASONS) else "unrecognized",
         "subreasonCode": subreason if subreason <= 32 else "unrecognized",
         "statusCode": status if 0 <= status <= 255 else "unrecognized", "memory": memory}
        for reason, subreason, status, memory in selected
    ]}


def compare_pids(before, after):
    """Matching numeric observations cannot prove continuity because Android can reuse a PID."""
    return "unavailable" if before is None or after is None else "matched" if before == after else "changed"
