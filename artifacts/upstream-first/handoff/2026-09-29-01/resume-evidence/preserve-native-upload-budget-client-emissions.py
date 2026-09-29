import hashlib
import json
import subprocess
from pathlib import Path

root = Path.cwd().resolve()
assert root.as_posix().endswith('/deepseek-harness/.worktrees/upstream-first')
log = root / '.artifacts/native-upload-budget-factory-client-build.log'
assert 'TS6059' in log.read_text(encoding='utf-8')
started = getattr(log.stat(), 'st_birthtime', log.stat().st_ctime) - 2
tracked = set(subprocess.check_output(['git', '-c', 'core.fsmonitor=false', 'ls-files', '-z']).decode().split('\0'))
untracked = subprocess.check_output(['git', '-c', 'core.fsmonitor=false', 'ls-files', '--others', '--exclude-standard', '-z']).decode().split('\0')
archive = root / '.artifacts/native-upload-budget-client-emissions'
assert not archive.exists(), 'Emission backup already exists'
entries = []
skipped = []
for relative in untracked:
    if not relative.endswith(('.js', '.js.map', '.d.ts', '.d.ts.map')):
        continue
    path = root / relative
    assert path.resolve().is_relative_to(root) and not path.is_symlink() and path.is_file(), relative
    if not '/src/' in relative or path.stat().st_mtime < started:
        skipped.append(relative)
        continue
    emitted = Path(str(path)[:-4]) if relative.endswith('.map') else path
    mapping = Path(str(emitted) + '.map')
    if not mapping.is_file() or mapping.is_symlink():
        skipped.append(relative)
        continue
    parsed = json.loads(mapping.read_text(encoding='utf-8'))
    sources = parsed.get('sources', [])
    if parsed.get('file') != emitted.name or len(sources) != 1:
        skipped.append(relative)
        continue
    source = (mapping.parent / parsed.get('sourceRoot', '') / sources[0]).resolve()
    stem = emitted.name[:-5] if emitted.name.endswith('.d.ts') else emitted.name[:-3]
    if source.parent != emitted.parent.resolve() or source.name not in (stem + '.ts', stem + '.tsx'):
        skipped.append(relative)
        continue
    if source.relative_to(root).as_posix() not in tracked or not source.is_file():
        skipped.append(relative)
        continue
    data = path.read_bytes()
    entries.append({'path': relative, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': data,
                    'source': source.relative_to(root).as_posix(), 'mtime': path.stat().st_mtime})
assert entries, 'No proven compiler emissions found'
for entry in entries:
    target = archive / entry['path']
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as output:
        output.write(entry['bytes'])
receipt = {'reason': 'Client project accidentally included a new Host E2E before face registration',
           'buildLog': log.relative_to(root).as_posix(), 'entries': [{k: v for k, v in entry.items() if k != 'bytes'} for entry in entries],
           'skipped': skipped}
with (archive / 'manifest.json').open('x', encoding='utf-8', newline='\n') as output:
    output.write(json.dumps(receipt, indent=2) + '\n')
for entry in entries:
    target = root / entry['path']
    assert target.resolve().is_relative_to(root) and not target.is_symlink()
    assert hashlib.sha256(target.read_bytes()).hexdigest() == entry['sha256']
    target.unlink()
print(json.dumps({'preservedAndRemoved': len(entries), 'skipped': skipped}))
