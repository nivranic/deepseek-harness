"""Record the running Android device's API and kernel page size before instrumentation."""
import argparse
import json
import subprocess
from pathlib import Path


def device_number(arguments: list[str]) -> int:
    """Read one numeric property from the single adb-selected device; reject failed queries."""
    result = subprocess.run(['adb', 'shell', *arguments], capture_output=True, text=True, timeout=30, check=False)
    value = result.stdout.strip()
    if result.returncode != 0 or not value.isascii() or not value.isdecimal():
        raise ValueError('Android runtime query failed or returned a non-decimal value')
    return int(value)


def main(argv: list[str] | None = None) -> int:
    """Write a new runtime observation and return nonzero unless both required values match."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-level', type=int, required=True)
    parser.add_argument('--page-size', type=int, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    if args.api_level <= 0 or args.page_size <= 0:
        parser.error('API level and page size must be positive')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Opening exclusively before adb prevents an old observation from surviving a failed rerun.
    with args.output.open('x', encoding='utf-8', newline='\n') as output:
        record = {
            'schemaVersion': 1,
            'status': 'FAIL',
            'expected': {'apiLevel': args.api_level, 'pageSizeBytes': args.page_size},
            'observed': {},
        }
        try:
            record['observed']['apiLevel'] = device_number(['getprop', 'ro.build.version.sdk'])
            record['observed']['pageSizeBytes'] = device_number(['getconf', 'PAGE_SIZE'])
            if record['observed'] == record['expected']:
                record['status'] = 'PASS'
        except (OSError, ValueError, subprocess.TimeoutExpired):
            # Device diagnostics may identify a host or device; the receipt retains only completed numeric observations.
            record['queryError'] = 'device-query-failed'
        json.dump(record, output, indent=2)
        output.write('\n')
    print('Android runtime observation: ' + record['status'])
    return 0 if record['status'] == 'PASS' else 1


if __name__ == '__main__':
    raise SystemExit(main())
