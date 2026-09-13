"""Retain bounded native Host crash facts without process paths, arguments or exception messages."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys


def summarize(text):
    """Project a single Apple IPS document; unrelated processes return no record."""
    decoder = json.JSONDecoder()
    report, end = decoder.raw_decode(text.lstrip())
    remaining = text.lstrip()[end:].strip()
    if remaining:
        report, end = decoder.raw_decode(remaining)
        if remaining[end:].strip():
            raise ValueError('unexpected crash-report document')
    if not isinstance(report, dict):
        raise ValueError('invalid crash-report document')
    if report.get('procName') != 'DSH Host' or report.get('bundleInfo', {}).get('CFBundleIdentifier') != 'com.deepseek-harness.host.mac':
        return None
    result = {'process': 'DSH Host', 'exception': {}, 'termination': {}, 'frames': []}
    for key, pattern in [('type', r'EXC_[A-Z_]+'), ('signal', r'SIG[A-Z0-9]+')]:
        value = report.get('exception', {}).get(key)
        if isinstance(value, str) and re.fullmatch(pattern, value):
            result['exception'][key] = value
    termination = report.get('termination', {})
    value = termination.get('namespace')
    if isinstance(value, str) and re.fullmatch(r'[A-Z_]+', value):
        result['termination']['namespace'] = value
    value = termination.get('code')
    if type(value) is int and value >= 0:
        result['termination']['code'] = value
    threads = report.get('threads', [])
    thread = report.get('faultingThread')
    if not isinstance(threads, list) or type(thread) is not int or not 0 <= thread < len(threads):
        return result
    for frame in threads[thread].get('frames', [])[:64]:
        safe = {}
        for key in ('imageIndex', 'imageOffset', 'symbolLocation'):
            value = frame.get(key)
            if type(value) is int and value >= 0:
                safe[key] = value
        symbol = frame.get('symbol')
        if isinstance(symbol, str) and 0 < len(symbol) <= 512 and not any(ord(c) < 32 or c in '/\\' for c in symbol):
            safe['symbol'] = symbol
        result['frames'].append(safe)
    return result


def collect(directory, since):
    """Read only fresh regular Host IPS files; unreadable reports remain explicit collection failures."""
    records, errors = [], []
    if not directory.exists():
        return {'status': 'NO_REPORT', 'records': records, 'errors': errors}
    candidates = [p for p in directory.iterdir() if p.suffix == '.ips' and p.name.startswith(('DSH Host-', 'DSH_Host-'))]
    if len(candidates) > 128:
        raise ValueError('too many Host crash reports')
    for path in sorted(candidates):
        try:
            info = path.lstat()
            if info.st_mtime < since:
                continue
            if not stat.S_ISREG(info.st_mode) or info.st_size > 4 * 1024 * 1024:
                raise ValueError('unsafe crash report')
            record = summarize(path.read_text(encoding='utf-8'))
            if record is not None:
                records.append(record)
        except (OSError, ValueError, AttributeError, TypeError):
            errors.append('host-report-unreadable')
    return {'status': 'INCOMPLETE' if errors else 'REPORTS_FOUND' if records else 'NO_REPORT', 'records': records, 'errors': errors}


def main():
    """Collect one hosted candidate's test interval into its existing diagnostic directory."""
    parser = argparse.ArgumentParser()
    parser.add_argument('--output-directory', type=Path, required=True)
    args = parser.parse_args()
    if sys.platform != 'darwin' or os.environ.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        raise ValueError('native crash collection requires hosted macOS')
    started = args.output_directory / 'native-test-start.json'
    if not started.exists():
        return
    since = json.loads(started.read_text(encoding='utf-8'))['epochSeconds']
    if type(since) not in (int, float) or not 0 < since < 100_000_000_000:
        raise ValueError('invalid native test interval')
    result = collect(Path.home() / 'Library/Logs/DiagnosticReports', since)
    with (args.output_directory / 'native-crashes.json').open('x', encoding='utf-8', newline='\n') as output:
        json.dump(result, output, indent=2)
        output.write('\n')


if __name__ == '__main__':
    main()
