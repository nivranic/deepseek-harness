"""Read only the JSON-compatible application properties from an XML or binary Xcode archive plist."""
import json
import plistlib
import sys
from pathlib import Path


def archive_properties(path: Path) -> dict:
    """Preserve dates and other archive fields on disk while projecting ApplicationProperties."""
    with path.open('rb') as stream:
        value = plistlib.load(stream)
    if not isinstance(value, dict) or not isinstance(value.get('ApplicationProperties'), dict):
        raise ValueError('Archive plist requires an ApplicationProperties dictionary')
    result = {'ApplicationProperties': value['ApplicationProperties']}
    json.dumps(result, allow_nan=False)
    return result


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: apple_archive_plist.py <xcarchive/Info.plist>')
    try:
        print(json.dumps(archive_properties(Path(sys.argv[1])), allow_nan=False))
    except (OSError, ValueError, TypeError, plistlib.InvalidFileException):
        raise SystemExit('Cannot read JSON-compatible archive application properties') from None
