"""Capture this handoff only; never runs builds, tests, publication, or product seal helpers."""
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[3]
head_expected = '74b476627a950189b348a5771bb205c508f8230f'
previous = '5bd766f9114174e4d78760977391ec62104a7868'
source_path = 'artifacts/upstream-first/android-attachment-receipt-recovery-source.json'
source_sha = 'a6885018a5c9d2ca9564314993f9edff2d1af832023244979fd2842101feb14d'
archive_path = '.artifacts/native-upload-budget-before/archive.json'
archive_sha = 'a239e9736694a7e9e531f121ee440d806a042842d7549847e1cf4b306a533c5b'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git(*args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', *args], cwd=root)

def write(name, data):
    target = here / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert target.read_bytes() == data, 'Partial capture differs: ' + name
        return
    with target.open('xb') as output:
        output.write(data)

def save_json(name, value):
    write(name, (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode())

assert git('rev-parse', 'HEAD').decode().strip() == head_expected
assert git('branch', '--show-current').decode().strip() == 'agents/upstream-first'
assert sha((root / source_path).read_bytes()) == source_sha
assert sha((root / archive_path).read_bytes()) == archive_sha
assert not (here / 'state.json').exists(), 'Do not overwrite an existing handoff capture'
excluded = ('artifacts/upstream-first/handoff/', '.glm-router/')
dirty = []
for item in git('status', '--porcelain=v1', '-z', '--untracked-files=all').decode().split('\0'):
    if not item:
        continue
    status, path = item[:2], item[3:]
    assert not any(tag in status for tag in ('R', 'C')), 'Review rename handling before capture'
    if path.startswith(excluded):
        continue
    target = root / path
    record = {'path': path, 'gitStatus': status}
    if target.is_file():
        data = target.read_bytes()
        copy = 'uncommitted-files/' + path
        write(copy, data)
        record.update(sha256=sha(data), bytes=len(data), snapshot=copy)
    else:
        record.update(deleted=True)
    dirty.append(record)
patch = git('diff', '--binary', 'HEAD', '--', '.', ':(exclude)artifacts/upstream-first/handoff/**', ':(exclude).glm-router/**')
write('tracked.patch', patch)
commits = []
for line in git('log', '--reverse', '--format=%H%x09%s', previous + '..HEAD').decode().splitlines():
    commit, subject = line.split('\t', 1)
    commits.append({'sha': commit, 'subject': subject})
assert len(commits) == 41
save_json('changes.json', {
    'schemaVersion': 1,
    'commitRange': {'base': previous, 'head': head_expected, 'count': len(commits), 'commits': commits},
    'committedNameStatus': git('diff', '--name-status', previous, 'HEAD').decode().splitlines(),
    'unsealedFiles': dirty,
    'trackedPatch': {'path': 'tracked.patch', 'sha256': sha(patch), 'bytes': len(patch)},
    'excluded': list(excluded),
})
for source, destination in [
    ('artifacts/upstream-first/original-specification.md', 'original-specification.md'),
    ('IMPLEMENTATION_STATUS.md', 'report-snapshots/IMPLEMENTATION_STATUS.md'),
    ('artifacts/upstream-first/specification-traceability.json', 'report-snapshots/specification-traceability.json'),
    ('artifacts/upstream-first/evidence.json', 'report-snapshots/evidence.json'),
]:
    write(destination, (root / source).read_bytes())

evidence_paths = {path.relative_to(root).as_posix() for path in (root / '.artifacts').glob('native-upload-budget-*') if path.is_file()}
evidence_paths.update([
    '.artifacts/prepare-native-upload-budget.mjs',
    '.artifacts/verify-native-upload-budget-prepare-draft.mjs',
    '.artifacts/read-native-upload-budget-core-results.py',
    '.artifacts/preserve-native-upload-budget-client-emissions.py',
    '.artifacts/native-upload-budget-client-emissions/manifest.json',
    '.artifacts/native-upload-budget-before/archive.json',
    '.artifacts/authorized-attachment-receipt-recovery-publication.json',
    '.artifacts/authorized-attachment-receipt-recovery-ci-status.json',
    '.artifacts/dispatch-authorized-attachment-receipt-recovery-ci.py',
    '.artifacts/check-authorized-attachment-receipt-recovery-ci.py',
    '.artifacts/android-push-foreground-cursor-investigation.json',
])
core = json.loads((root / '.artifacts/native-upload-budget-core-results.json').read_text(encoding='utf-8'))
assert core['tests'] == 57 and core['suites'] == 7
for entry in core['files']:
    assert sha((root / entry['path']).read_bytes()) == entry['sha256']
    evidence_paths.add(entry['path'])
evidence = []
for path in sorted(evidence_paths):
    file = root / path
    assert file.is_file(), path
    data = file.read_bytes()
    name = file.name
    if path == archive_path:
        name = 'native-upload-budget-before-archive.json'
    elif path.endswith('client-emissions/manifest.json'):
        name = 'native-upload-budget-client-emissions-manifest.json'
    copy = 'resume-evidence/' + name
    write(copy, data)
    evidence.append({'path': path, 'sha256': sha(data), 'bytes': len(data), 'snapshot': copy})
save_json('evidence-index.json', {
    'schemaVersion': 1, 'files': evidence,
    'qualification': 'Hashes preserve observed bytes, not proof that an unfinished run passed.',
    'notPackaged': ['complete .artifacts history and before archive bytes', 'APK/AAR binaries', 'node_modules', 'Gradle and Android SDK', 'credentials and emulator state'],
})
apk_paths = [
    'apps/android/app/build/outputs/apk/debug/app-debug.apk',
    'apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk',
]
apk = [{'path': path, 'sha256': sha((root / path).read_bytes()), 'bytes': (root / path).stat().st_size} for path in apk_paths]
evidence_report = json.loads((root / 'artifacts/upstream-first/evidence.json').read_text(encoding='utf-8'))
assert evidence_report['latestSourceRecord'] == source_path and evidence_report['completeRc'] is False
save_json('state.json', {
    'schemaVersion': 1, 'handoffId': '2026-09-29-01', 'predecessorHandoff': '2026-09-25-01',
    'predecessorManualSha256': sha((here.parent / '2026-09-25-01/HANDOFF.md').read_bytes()),
    'capturedAt': datetime.now(timezone.utc).isoformat(), 'timezone': 'Asia/Hong_Kong',
    'threadId': '01a0d683-d6ce-77f0-b946-b99408ba2e12',
    'goalStatus': 'paused', 'goalStatusBasis': 'Live get_goal result during this handoff',
    'fullGoalComplete': False, 'completeRc': False, 'sessionWriterVersion': 3,
    'worktree': root.as_posix(), 'branch': 'agents/upstream-first', 'head': head_expected,
    'remoteVerifiedSha': head_expected, 'remoteVerification': 'Read-only ls-remote during this handoff; no fetch or push',
    'remote': 'https://github.com/nivranic/deepseek-harness',
    'latestSealedRecord': {'path': source_path, 'sha256': source_sha},
    'unsealedIncrement': {'key': 'native-upload-budget', 'beforeArchive': archive_path, 'beforeArchiveSha256': archive_sha,
                         'beforeFiles': len(json.loads((root / archive_path).read_text(encoding='utf-8'))['files']), 'captureStarted': False},
    'coreTests': {key: value for key, value in core.items() if key != 'files'}, 'currentApks': apk,
    'ci': {'runId': 36355618789, 'dispatch': 204, 'lastSavedStatus': 'queued', 'liveCiRefreshedForHandoff': False},
    'authorization': 'User authorized Camera and subsequent verified increments to normal push and ci.yml dispatch on agents/upstream-first.',
    'processObservation': 'Agent listing contains only root; narrow elevated process query found no matching budget test/catalog command. No global processes were stopped.',
    'sourceRecordCount': len(list((root / 'artifacts/upstream-first').glob('*-source.json'))),
    'beforeManifestCount': len(list((root / '.artifacts').glob('*-before/archive.json'))),
    'protectedMainWorktreeStatus': subprocess.check_output(['git', '-C', 'E:/Mix/project/deepseek-harness', '-c', 'core.fsmonitor=false', 'status', '--short']).decode().splitlines(),
    'notPerformedDuringHandoff': ['product implementation', 'product tests/builds', 'seal generation', 'commit/push/CI dispatch', 'memory writes', 'history cleanup'],
})
print(json.dumps({'dirtyFiles': len(dirty), 'commits': len(commits), 'evidenceFiles': len(evidence), 'apks': len(apk)}))
