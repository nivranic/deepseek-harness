import hashlib
import json
import xml.etree.ElementTree as ET
from pathlib import Path

destination = Path('.artifacts/native-upload-budget-core-results.json')
initial = destination.with_name('native-upload-budget-core-results-initial.json')
if destination.exists():
    assert not initial.exists()
    destination.rename(initial)
files = []
fields = ('tests', 'failures', 'errors', 'skipped')
for path in sorted(Path('apps/android/core/build/test-results/test').glob('TEST-*.xml')):
    data = path.read_bytes()
    suite = ET.fromstring(data)
    assert suite.tag == 'testsuite'
    files.append({'path': path.as_posix(), 'sha256': hashlib.sha256(data).hexdigest(),
                  **{field: int(suite.attrib[field]) for field in fields}})
assert len(files) == 7
result = {**{field: sum(item[field] for item in files) for field in fields}, 'suites': len(files), 'files': files}
assert result['tests'] > 0 and all(result[field] == 0 for field in fields[1:])
with destination.open('x', encoding='utf-8', newline='\n') as output:
    output.write(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key != 'files'}))
