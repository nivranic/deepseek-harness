/** Capture handover inventories and report copies without changing implementation evidence. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const relativeDirectory = path.relative(root, directory).replaceAll('\\', '/');
const baseline = 'c291e7961a515f6d7af9304e7fd1d257929aef26';
const originalSha = '4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80';
const sealedPath = 'artifacts/upstream-first/remote-validation-details-source.json';
const sealedSha = 'd3ebb0fda88dc60acef6ba1eb429d542e2683d9b0d54e57b78cf7a8b960a51fc';
const read = relative => fs.readFileSync(path.join(root, relative));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = relative => ({ path: relative, bytes: fs.statSync(path.join(root, relative)).size, sha256: sha(read(relative)) });
const write = (relative, value) => fs.writeFileSync(path.join(directory, relative), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const git = (args, cwd = root) => {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.safecrlf=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};

assert.equal(path.resolve(process.cwd()).toLowerCase(), root.toLowerCase(), 'Run from the implementation worktree');
assert.equal(fs.existsSync(path.join(directory, 'state.json')), false, 'This handover has already been captured; use a new version');
assert.equal(git(['rev-parse', 'HEAD']).trim(), baseline);
assert.equal(git(['branch', '--show-current']).trim(), 'agents/upstream-first');
assert.equal(sha(read('artifacts/upstream-first/original-specification.md')), originalSha);
assert.equal(sha(read(sealedPath)), sealedSha);

const status = git(['status', '--porcelain=v1', '--untracked-files=all', '-z']).split('\0').filter(Boolean);
const files = [];
for (let index = 0; index < status.length; index++) {
  const record = status[index];
  const code = record.slice(0, 2);
  const relative = record.slice(3);
  const oldPath = /[RC]/.test(code) ? status[++index] : undefined;
  if (relative.startsWith(relativeDirectory + '/')) continue;
  const exists = fs.existsSync(path.join(root, relative));
  files.push({ status: code, path: relative, ...(oldPath ? { oldPath } : {}), ...(exists ? { bytes: fs.statSync(path.join(root, relative)).size, sha256: sha(read(relative)) } : { exists: false }) });
}
const counts = Object.fromEntries([...new Set(files.map(file => file.status))].map(code => [code, files.filter(file => file.status === code).length]));
assert.equal(git(['diff', '--cached', '--name-only']).trim(), '', 'Unexpected staged changes');
const diff = git(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', 'HEAD']);
fs.writeFileSync(path.join(directory, 'tracked-changes.patch'), diff, { flag: 'wx' });
write('changes.json', { schemaVersion: 1, baseline, capturedAt: new Date().toISOString(), excludes: [relativeDirectory + '/'], counts, total: files.length, staged: 0, trackedDiff: { path: 'tracked-changes.patch', sha256: sha(Buffer.from(diff)), includesUntrackedFiles: false }, files });

fs.copyFileSync(path.join(root, 'artifacts/upstream-first/original-specification.md'), path.join(directory, 'original-specification.md'), fs.constants.COPYFILE_EXCL);
const reports = ['IMPLEMENTATION_STATUS.md', 'UPSTREAM_BASELINE.md', 'UPSTREAM_DELTA.md', 'UPSTREAM_DELTA.json', 'ARCHITECTURE_DECISIONS.md', 'CUSTOM_CAPABILITY_INVENTORY.json', 'COMPATIBILITY_MATRIX.md', 'SECURITY_STATUS.md', 'PLATFORM_VERIFICATION.md', 'RELEASE_STATUS.md', 'artifacts/upstream-first/evidence.json', 'artifacts/upstream-first/specification-traceability.json', 'artifacts/upstream-first/remote-validation-details-report-validation.json'];
fs.mkdirSync(path.join(directory, 'report-snapshots'));
const snapshots = reports.map(relative => {
  const copy = 'report-snapshots/' + path.basename(relative);
  fs.copyFileSync(path.join(root, relative), path.join(directory, copy), fs.constants.COPYFILE_EXCL);
  return { ...entry(relative), copy };
});

const archivePath = '.artifacts/remote-error-envelope-schema-before/archive.json';
const archive = JSON.parse(read(archivePath));
const changed = archive.files.filter(file => !file.originalPath.startsWith('artifacts/') && !file.originalPath.startsWith('.artifacts/') && !file.originalPath.includes('/lib/') && fs.existsSync(path.join(root, file.originalPath)) && sha(read(file.originalPath)) !== file.sha256).map(file => ({ ...entry(file.originalPath), archivedPath: file.path, archivedSha256: file.sha256 }));
const additions = ['scripts/gen-remote-error-envelope.ts', 'scripts/gen-remote-error-envelope.spec.ts', 'packages/typert/protocol/remote-errors.schema.json'].map(entry);
const unsealedFiles = fs.readdirSync(path.join(root, '.artifacts'), { withFileTypes: true }).filter(item => item.isFile() && item.name.includes('remote-error-envelope-schema')).map(item => entry('.artifacts/' + item.name));
const tarball = entry('.artifacts/remote-error-envelope-schema-pack/deepseek-ai-dsh-typert-protocol-0.1.5-rc.2.tgz');
write('unsealed-increment.json', { schemaVersion: 1, status: 'IN_PROGRESS', key: 'remoteErrorEnvelopeSchema', predecessor: entry(sealedPath), archive: { ...entry(archivePath), files: archive.files.length }, changed, additions, evidence: [...unsealedFiles, tarball], missingAtCapture: ['.artifacts/capture-remote-error-envelope-schema.mjs', '.artifacts/advance-remote-error-envelope-schema-reports.mjs', 'artifacts/upstream-first/remote-error-envelope-schema-source.json'].map(relative => ({ path: relative, exists: fs.existsSync(path.join(root, relative)) })) });

const sourceRecords = fs.readdirSync(path.join(root, 'artifacts/upstream-first')).filter(name => name.endsWith('-source.json')).sort().map(name => {
  const relative = 'artifacts/upstream-first/' + name;
  const record = JSON.parse(read(relative));
  return { ...entry(relative), capturedAt: record.capturedAt ?? null, scope: record.scope ?? null, sourceFiles: record.sourceFiles?.length ?? null, builtFiles: record.builtFiles?.length ?? null };
});
const artifactDirectories = fs.readdirSync(path.join(root, '.artifacts'), { withFileTypes: true }).filter(item => item.isDirectory()).map(item => {
  const relative = '.artifacts/' + item.name;
  const manifest = relative + '/archive.json';
  return { path: relative, ...(fs.existsSync(path.join(root, manifest)) ? { archiveManifest: entry(manifest) } : {}) };
});
write('evidence-index.json', { schemaVersion: 1, reports: snapshots, sourceRecords, ignoredArtifactDirectories: artifactDirectories, ignoredDirectoriesRecursivelyHashed: false, note: 'The index and tracked patch are not a portable backup. Keep untracked files and all referenced ignored evidence. Historical archive copies are required by report bindings.' });

const mainRoot = path.resolve(root, '../..');
const protectedFiles = ['GOAL_PROGRESS_SUMMARY_2026-09-14.md', 'IMPLEMENTATION_VERIFICATION_V2.md'].map(name => {
  const absolute = path.join(mainRoot, name);
  return { path: absolute.replaceAll('\\', '/'), sha256: sha(fs.readFileSync(absolute)) };
});
const traceability = JSON.parse(read('artifacts/upstream-first/specification-traceability.json'));
write('state.json', {
  schemaVersion: 1, handoffId: '2026-09-19-01', predecessorHandoff: null, capturedAt: new Date().toISOString(), timezone: 'Asia/Hong_Kong', taskId: '01a0a084-9501-7fe3-8be0-434a574812e1',
  goal: { objective: '按照新的这份方案开始执行', status: 'paused', fullGoalComplete: false, reason: '用户要求暂停实施并撰写详细移交手册' },
  workspace: { path: root.replaceAll('\\', '/'), branch: 'agents/upstream-first', head: baseline, dirtyCountsBeforeHandoff: counts, totalDirtyBeforeHandoff: files.length, staged: 0, writer: 3 },
  mainWorkspace: { path: mainRoot.replaceAll('\\', '/'), branch: git(['branch', '--show-current'], mainRoot).trim(), head: git(['rev-parse', 'HEAD'], mainRoot).trim(), status: git(['status', '--short'], mainRoot).trim().split('\n'), protectedFiles },
  originalSpecification: { source: 'artifacts/upstream-first/original-specification.md', copy: 'original-specification.md', sha256: originalSha, sections: traceability.coverage.numberedSections, nonEmptyLines: traceability.coverage.nonEmptySourceLines, acceptanceProven: false },
  sealed: { key: 'remoteValidationDetails', ...entry(sealedPath) },
  unsealed: { key: 'remoteErrorEnvelopeSchema', details: 'unsealed-increment.json', implementationAndSelectedTestsComplete: true, sourceRecordCaptured: false, reportChainAdvanced: false },
  environment: { os: 'Windows', shell: 'PowerShell', node: process.version, pnpmObserved: '11.7.0', processInspection: { scope: 'Win32_Process node.exe/electron.exe/pnpm.exe command lines containing upstream-first', hostQueryResult: 'no matches', limitation: 'Not an exhaustive proof that every unrelated or command-line-hidden process is stopped; tool process handles from prior implementation were reported terminal.' } },
  authorization: { allowedNow: ['read-only verification', 'handover artifacts and validation'], implementation: 'paused pending user continuation instruction', commit: false, push: false, publication: false, userDataMigration: false, autostartChange: false, delegation: false, memoryWrite: false },
  reports: snapshots, nextActionAfterUserResumes: '核对未封存增量与终态证据，完成 §45 追踪、来源捕获、报告链晋级及绑定审计；然后回到完整 Phase 0–12。',
  portability: { sameMachine: 'Use the same isolated worktree.', portableBackupComplete: false, requiredBeyondThisDirectory: ['all modified and untracked worktree files', 'all source-record-referenced .artifacts evidence and historical archives', 'baseline Git objects and branch/worktree metadata or a deliberate reconstruction', 'environment dependency and native build prerequisites'] }
});
console.log(JSON.stringify({ captured: relativeDirectory, files: files.length, counts, reports: snapshots.length, sourceRecords: sourceRecords.length, unsealedChanged: changed.length, unsealedAdded: additions.length, archivedFiles: archive.files.length }));
