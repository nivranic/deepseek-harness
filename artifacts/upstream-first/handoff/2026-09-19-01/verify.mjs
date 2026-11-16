/** Read-only verification of this handover; --live also checks the captured worktree. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../../..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = relative => JSON.parse(fs.readFileSync(path.join(directory, relative), 'utf8'));
const failures = [];
let checks = 0;
const check = (condition, message) => { checks++; if (!condition) failures.push(message); };
const fileHash = file => fs.existsSync(file) && fs.statSync(file).isFile() ? sha(fs.readFileSync(file)) : null;
const git = (args, cwd = root) => {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.safecrlf=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  check(result.status === 0, 'Git command failed: ' + args.join(' '));
  return result.stdout ?? '';
};
const state = json('state.json');
const changes = json('changes.json');
const evidence = json('evidence-index.json');
const increment = json('unsealed-increment.json');
const manifest = json('manifest.json');
for (const item of manifest.files) {
  const file = path.resolve(directory, item.path);
  check(file.startsWith(directory + path.sep), 'Manifest path leaves handover directory: ' + item.path);
  check(fileHash(file) === item.sha256, 'Handover bytes changed: ' + item.path);
  if (fs.existsSync(file)) check(fs.statSync(file).size === item.bytes, 'Handover size changed: ' + item.path);
  if (item.path.endsWith('.json')) {
    try { JSON.parse(fs.readFileSync(file, 'utf8')); check(true, ''); }
    catch { check(false, 'Invalid JSON: ' + item.path); }
  }
}

const specification = fs.readFileSync(path.join(directory, 'original-specification.md'));
const sourceText = specification.toString('utf8');
const numbers = [...sourceText.matchAll(/^(?:# ([1-9]\d*)\.|## (0)\.) /gm)].map(match => Number(match[1] ?? match[2]));
const nonEmpty = sourceText.split(/\r?\n/u).filter(line => line.trim().length).length;
check(sha(specification) === state.originalSpecification.sha256, 'Original specification SHA mismatch');
check(JSON.stringify(numbers) === JSON.stringify(Array.from({ length: 81 }, (_, index) => index)), 'Original numbered sections differ');
check(nonEmpty === 1983, 'Original nonempty line count differs');
check(state.goal.status === 'paused' && state.goal.fullGoalComplete === false, 'Handover goal state is wrong');
check(changes.total === 1487 && changes.counts[' M'] === 839 && changes.counts['??'] === 648, 'Captured dirty scope differs');
check(increment.changed.length === 21 && increment.additions.length === 3 && increment.archive.files === 5461, 'Unsealed scope differs');
for (const item of evidence.reports) check(fileHash(path.join(directory, item.copy)) === item.sha256, 'Report snapshot changed: ' + item.copy);

const manualPath = path.join(directory, 'HANDOFF.md');
const manual = fs.readFileSync(manualPath, 'utf8');
check(manual.endsWith('\n') && !manual.endsWith('\n\n'), 'Manual must end with exactly one newline');
check(!/[\t ]+$/m.test(manual), 'Manual contains trailing whitespace');
const fences = manual.match(/^~~~/gm) ?? [];
check(fences.length % 2 === 0, 'Manual fence imbalance');
const anchors = [...manual.matchAll(/<a id="([^"]+)"><\/a>/g)].map(match => match[1]);
check(new Set(anchors).size === anchors.length, 'Duplicate manual anchors');
const links = [...manual.matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)].map(match => match[1]);
for (const link of links) {
  if (/^https?:\/\//.test(link)) continue;
  const [rawFile, fragment] = link.split('#');
  const target = rawFile ? path.resolve(directory, decodeURIComponent(rawFile)) : manualPath;
  check(fs.existsSync(target), 'Missing linked file: ' + link);
  if (fragment && fs.existsSync(target)) {
    const content = fs.readFileSync(target, 'utf8');
    check(content.includes('id="' + fragment + '"'), 'Missing linked anchor: ' + link);
  }
}

const live = process.argv.includes('--live');
if (live) {
  check(git(['rev-parse', 'HEAD']).trim() === state.workspace.head, 'Implementation HEAD differs');
  check(git(['branch', '--show-current']).trim() === state.workspace.branch, 'Implementation branch differs');
  check(git(['diff', '--cached', '--name-only']).trim() === '', 'Staged changes exist');
  const records = git(['status', '--porcelain=v1', '--untracked-files=all', '-z']).split('\0').filter(Boolean);
  const current = [];
  for (let index = 0; index < records.length; index++) {
    const code = records[index].slice(0, 2);
    const relative = records[index].slice(3);
    const oldPath = /[RC]/.test(code) ? records[++index] : undefined;
    if (relative.startsWith('artifacts/upstream-first/handoff/')) continue;
    current.push({ status: code, path: relative, ...(oldPath ? { oldPath } : {}) });
  }
  check(JSON.stringify(current) === JSON.stringify(changes.files.map(({ status, path, oldPath }) => ({ status, path, ...(oldPath ? { oldPath } : {}) }))), 'Dirty file status set changed outside handover');
  for (const item of changes.files) {
    const target = path.join(root, item.path);
    check(item.exists === false ? !fs.existsSync(target) : fileHash(target) === item.sha256, 'Captured worktree file changed: ' + item.path);
  }
  const patch = git(['diff', '--binary', '--full-index', '--no-ext-diff', '--no-textconv', 'HEAD']);
  check(sha(Buffer.from(patch)) === changes.trackedDiff.sha256, 'Tracked patch changed');
  check(fileHash(path.join(root, state.sealed.path)) === state.sealed.sha256, 'Latest sealed source changed');
  check(fileHash(path.join(root, state.originalSpecification.source)) === state.originalSpecification.sha256, 'Authoritative specification changed');
  for (const item of evidence.reports) check(fileHash(path.join(root, item.path)) === item.sha256, 'Live sealed report changed: ' + item.path);
  for (const item of evidence.sourceRecords) check(fileHash(path.join(root, item.path)) === item.sha256, 'Historical source record changed: ' + item.path);
  for (const item of evidence.ignoredArtifactDirectories) if (item.archiveManifest) check(fileHash(path.join(root, item.archiveManifest.path)) === item.archiveManifest.sha256, 'Historical archive manifest changed: ' + item.path);
  for (const item of [...increment.changed, ...increment.additions, ...increment.evidence, increment.archive]) check(fileHash(path.join(root, item.path)) === item.sha256, 'Unsealed evidence changed: ' + item.path);
  for (const item of increment.missingAtCapture) check(fs.existsSync(path.join(root, item.path)) === item.exists, 'Unsealed capture state changed: ' + item.path);
  const mainRoot = path.resolve(root, '../..');
  check(git(['rev-parse', 'HEAD'], mainRoot).trim() === state.mainWorkspace.head, 'Main workspace HEAD changed');
  check(git(['branch', '--show-current'], mainRoot).trim() === state.mainWorkspace.branch, 'Main workspace branch changed');
  check(JSON.stringify(git(['status', '--short'], mainRoot).trim().split('\n')) === JSON.stringify(state.mainWorkspace.status), 'Main workspace dirty state changed');
  for (const item of state.mainWorkspace.protectedFiles) check(fileHash(item.path) === item.sha256, 'Protected main report changed: ' + item.path);
}

console.log(JSON.stringify({ schemaVersion: 1, status: failures.length ? 'FAIL' : 'PASS', checkedAt: new Date().toISOString(), scope: 'Handover completeness and byte integrity only; no product tests were rerun', live, checks, manifestFiles: manifest.files.length, originalSections: numbers.length, originalNonEmptyLines: nonEmpty, manualLinks: links.length, originalSpecificationSha256: sha(specification), existingDirtyFiles: changes.total, sourceRecords: evidence.sourceRecords.length, reportSnapshots: evidence.reports.length, unsealedChangedFiles: increment.changed.length, unsealedAddedFiles: increment.additions.length, productAcceptanceProven: false, failureCount: failures.length, failures }, null, 2));
process.exitCode = failures.length ? 1 : 0;
