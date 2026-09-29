"""Finalize only the handoff inventory and LATEST pointer, once."""
import hashlib
import json
from pathlib import Path

here = Path(__file__).resolve().parent
latest = here.parent / 'LATEST.json'
previous = latest.read_bytes()
assert json.loads(previous)['handoffId'] == '2026-09-25-01'
assert not (here / 'manifest.json').exists()
with (here / 'previous-LATEST.json').open('xb') as output:
    output.write(previous)
files = []
for path in sorted(here.rglob('*')):
    if not path.is_file() or path.name in ('manifest.json', 'verification.json'):
        continue
    data = path.read_bytes()
    files.append({'path': path.relative_to(here).as_posix(), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
manifest = {'schemaVersion': 1, 'handoffId': '2026-09-29-01', 'files': files,
            'excludedSelfReferences': ['manifest.json', 'verification.json']}
manifest_bytes = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
with (here / 'manifest.json').open('xb') as output:
    output.write(manifest_bytes)
pointer = {'schemaVersion': 1, 'handoffId': '2026-09-29-01', 'predecessorHandoff': '2026-09-25-01',
           'entry': '2026-09-29-01/HANDOFF.md', 'entrySha256': hashlib.sha256((here / 'HANDOFF.md').read_bytes()).hexdigest(),
           'state': '2026-09-29-01/state.json', 'manifest': '2026-09-29-01/manifest.json',
           'manifestSha256': hashlib.sha256(manifest_bytes).hexdigest(), 'verification': '2026-09-29-01/verification.json',
           'goalStatus': 'paused', 'updatedAt': json.loads((here / 'state.json').read_text(encoding='utf-8'))['capturedAt']}
latest.write_text(json.dumps(pointer, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'manifestFiles': len(files), 'handoff': pointer['handoffId']}))
