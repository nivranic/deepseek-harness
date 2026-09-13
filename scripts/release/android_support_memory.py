"""Observe fixed Linux memory counters at export checkpoints without publishing process identities."""

import re
import subprocess
import time

from android_support_ui import PACKAGE


SYSTEM_FIELDS = {b"MemTotal": "total", b"MemAvailable": "available", b"MemFree": "free",
                 b"Cached": "cached", b"SwapTotal": "swapTotal", b"SwapFree": "swapFree"}
PROCESS_FIELDS = {b"VmRSS": "resident", b"RssAnon": "anonymous", b"RssFile": "file", b"RssShmem": "shared"}


def memory_fields(data, fields):
    """Select required kernel KiB counters; unknown lines never become diagnostic fields."""
    if not data or len(data) > 16384:
        raise ValueError("Android memory observation byte limit")
    result = {}
    for line in data.splitlines():
        key, _, value = line.partition(b":")
        if key not in fields:
            continue
        match = re.fullmatch(rb"\s*([0-9]{1,19})\s+kB\s*", value)
        if match is None or int(match[1]) > 2 ** 63 - 1 or fields[key] in result:
            raise ValueError("Android memory observation counter differs")
        result[fields[key]] = int(match[1])
    if set(result) != set(fields.values()):
        raise ValueError("Android memory observation counters are incomplete")
    return {"observation": "sampled", "reportedKiB": result}


def memory_pressure(data):
    """PSI averages cover the preceding ten seconds; totals are cumulative stall microseconds."""
    if not data or len(data) > 1024:
        raise ValueError("Android memory pressure byte limit")
    result = {}
    for line in data.splitlines():
        match = re.fullmatch(rb"(some|full) avg10=([0-9]{1,3}\.[0-9]{2}) avg60=([0-9]{1,3}\.[0-9]{2}) "
                             rb"avg300=([0-9]{1,3}\.[0-9]{2}) total=([0-9]{1,20})", line)
        if match is None or any(float(match[i]) > 100 for i in (2, 3, 4)) or int(match[5]) > 2 ** 64 - 1:
            raise ValueError("Android memory pressure fields differ")
        name = match[1].decode("ascii")
        if name in result:
            raise ValueError("Android memory pressure duplicate record")
        result[name] = {"average10SecondsPercent": float(match[2]), "totalMicroseconds": int(match[5])}
    if set(result) != {"some", "full"}:
        raise ValueError("Android memory pressure records are incomplete")
    return {"observation": "sampled", **result}


def process_start(line, pid):
    """Keep the kernel start tick private to reject PID reuse during a multi-file sample."""
    prefix, separator, tail = line.rpartition(b") ")
    number, opening, _name = prefix.partition(b" (")
    fields = tail.split()
    if not separator or not opening or number != str(pid).encode() or len(fields) < 20 \
            or re.fullmatch(rb"[0-9]{1,20}", fields[19]) is None or int(fields[19]) > 2 ** 64 - 1:
        raise ValueError("Android process memory identity differs")
    return int(fields[19])


def process_memory(data, pid):
    """Admit status counters only when surrounding stat reads identify the same process lifetime."""
    if not data or len(data) > 16384:
        raise ValueError("Android process memory byte limit")
    lines = data.splitlines()
    if len(lines) < 4 or process_start(lines[0], pid) != process_start(lines[-1], pid) \
            or re.fullmatch(rb"-?[0-9]{1,4}", lines[-2]) is None or not -1000 <= int(lines[-2]) <= 1000:
        raise ValueError("Android process memory sample changed")
    return {**memory_fields(b"\n".join(lines[1:-2]), PROCESS_FIELDS), "oomScoreAdjustment": int(lines[-2])}


def optional_query(device, arguments, parse):
    """An unavailable two-second read supplies no counters and cannot replace the export result."""
    try:
        return parse(device.shell(arguments, timeout=2))
    except (OSError, ValueError, subprocess.SubprocessError):
        return {"observation": "unavailable"}


def observe_memory(device, pid):
    """Three sequential, bounded reads describe a checkpoint, not simultaneous values or peak usage."""
    started = time.monotonic()
    system = optional_query(device, ["cat", "/proc/meminfo"], lambda data: memory_fields(data, SYSTEM_FIELDS))
    pressure = optional_query(device, ["cat", "/proc/pressure/memory"], memory_pressure)
    application = {"observation": "unavailable"}
    if pid is not None:
        path = "/proc/" + str(pid)
        application = optional_query(device, ["run-as", PACKAGE, "cat", path + "/stat", path + "/status",
                                               path + "/oom_score_adj", path + "/stat"], lambda data: process_memory(data, pid))
    return {"elapsedMilliseconds": min(2 ** 32 - 1, round((time.monotonic() - started) * 1000)),
            "system": system, "pressure": pressure, "application": application}
