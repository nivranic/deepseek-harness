import fs from 'node:fs';
import assert from 'node:assert/strict';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const sourceRecord = 'artifacts/upstream-first/android-attachment-receipt-recovery-source.json';
const expectedSourceSha = 'a6885018a5c9d2ca9564314993f9edff2d1af832023244979fd2842101feb14d';
const priorPrefix = '.artifacts/android-attachment-receipt-recovery-';
const validationPath = 'artifacts/upstream-first/android-attachment-receipt-recovery-report-validation.json';
const bindingPath = 'artifacts/upstream-first/android-attachment-receipt-recovery-binding.json';
const generatorPath = 'artifacts/upstream-first/write-reports.mjs';
const bindingHelper = '.artifacts/check-android-attachment-receipt-recovery-binding.mjs';
const before = '.artifacts/native-upload-budget-before';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const expectedHelpers = ['advance-android-attachment-receipt-recovery-reports', 'capture-android-attachment-receipt-recovery-validation'].map(name => '.artifacts/' + name + '.mjs');
const expectedReports = ['IMPLEMENTATION_STATUS.md', 'artifacts/upstream-first/evidence.json'];
const expectedChecks = ['binding', 'audit-tests', 'gate0-report', 'report-diff-check', 'report-generation'].map(name => priorPrefix + name + '.log');

/** Accept only normalized repository-relative files; archive destinations cannot escape their root. */
export function validateRelativePath(path) {
  assert.equal(typeof path, 'string');
  assert.ok(path.length > 0 && !isAbsolute(path) && !/[\\:\r\n\0]/u.test(path), 'Unsafe archive path: ' + path);
  assert.ok(path.split('/').every(part => part && part !== '.' && part !== '..'), 'Unsafe archive path: ' + path);
  assert.ok(!path.startsWith('.glm-router/') && !path.startsWith('.git/'), 'Excluded archive input: ' + path);
  return path;
}

/** Pure read-only preflight; every final receipt input must still match before any archive writes. */
export function validatePriorSeal(readBytes, requiredSourceSha) {
  assert.match(requiredSourceSha, /^[a-f0-9]{64}$/u);
  const read = path => readBytes(validateRelativePath(path)).toString('utf8');
  const json = path => JSON.parse(read(path));
  const verify = file => {
    validateRelativePath(file.path);
    assert.match(file.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(digest(readBytes(file.path)), file.sha256, 'Prior validation input changed: ' + file.path);
  };
  assert.equal(digest(readBytes(sourceRecord)), requiredSourceSha, 'Prior source SHA differs');
  const record = json(sourceRecord);
  assert.equal(record.baseSha, 'c291e7961a515f6d7af9304e7fd1d257929aef26');
  assert.equal(record.conclusions.androidAttachmentReceiptRecovery, true);
  const receipt = json(validationPath);
  assert.equal(receipt.status, 'PASS');
  assert.equal(receipt.gate0.validation, 'PASS');
  assert.equal(receipt.gate0.gate0, 'PASS');
  assert.deepEqual(receipt.sourceRecord, { path: sourceRecord, sha256: requiredSourceSha });
  assert.equal(receipt.generator.path, generatorPath);
  assert.equal(receipt.binding.path, bindingPath);
  assert.deepEqual(receipt.helpers.map(file => file.path), expectedHelpers);
  assert.deepEqual(receipt.reports.map(file => file.path), expectedReports);
  assert.deepEqual(receipt.checks.map(file => file.path), expectedChecks);
  const receiptFiles = [receipt.sourceRecord, receipt.generator, receipt.binding, ...receipt.helpers, ...receipt.reports, ...receipt.checks];
  assert.equal(receiptFiles.length, 12);
  assert.equal(new Set(receiptFiles.map(file => file.path)).size, 12);
  receiptFiles.forEach(verify);

  const binding = json(bindingPath);
  assert.equal(binding.status, 'PASS'); assert.equal(binding.controls, 3);
  assert.deepEqual(binding.sourceRecord, receipt.sourceRecord);
  assert.deepEqual(binding.generator, receipt.generator);
  assert.equal(binding.helper.path, bindingHelper); verify(binding.helper);
  const evidence = json(expectedReports[1]);
  assert.equal(evidence.latestSourceRecord, sourceRecord);
  assert.equal(evidence.completeRc, false);
  for (const path of [priorPrefix + 'audit-tests.log', priorPrefix + 'audit-final.log']) {
    const output = read(path);
    for (const line of ['tests 19', 'pass 19', 'fail 0', 'cancelled 0', 'skipped 0', 'todo 0']) {
      assert.match(output, new RegExp('^# ' + line + '\\r?$', 'mu'), 'Incomplete prior audit: ' + path);
    }
  }
  for (const path of [priorPrefix + 'gate0-report.log', priorPrefix + 'gate0-final.log']) {
    const gate = json(path); assert.equal(gate.validation, 'PASS'); assert.equal(gate.gate0, 'PASS');
  }
  assert.equal(read(priorPrefix + 'report-diff-check.log').trim(), '');
  for (const key of ['sourceFiles', 'builtFiles', 'logs', 'helpers', 'historicalRecords', 'screenshots', 'observations', 'comparisons']) {
    assert.ok(Array.isArray(record[key]), 'Missing prior source list: ' + key);
    record[key].forEach(verify);
  }
  return record;
}

function prepare() {
  const record = validatePriorSeal(path => fs.readFileSync(path), expectedSourceSha);
  const git = args => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], { maxBuffer: 1 << 28 });
  assert.equal(digest(git(['show', 'HEAD:' + sourceRecord])), expectedSourceSha, 'Prior source must be committed before preparing the next increment');
  assert.equal(digest(git(['show', 'HEAD:' + validationPath])), digest(fs.readFileSync(validationPath)), 'Prior final validation must be committed');
  assert.equal(git(['rev-parse', 'HEAD']).toString('utf8').trim(), git(['rev-parse', 'origin/agents/upstream-first']).toString('utf8').trim(), 'Prior commit must match the locally recorded upstream; Root owns live push verification');
  assert.equal(fs.existsSync(before + '/archive.json'), false, 'This before archive is already sealed');
  for (const path of record.removedPaths) assert.equal(fs.existsSync(validateRelativePath(path)), false, 'Retired entry returned: ' + path);
  const history = new Map();
  for (const archive of record.historicalRecords) {
    for (const file of JSON.parse(fs.readFileSync(archive.path, 'utf8')).files) {
      validateRelativePath(file.originalPath); validateRelativePath(file.path);
      history.set(file.originalPath + ':' + file.sha256, file.path);
    }
  }
  const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
  const finalSealInputs = [validation.sourceRecord, validation.generator, validation.binding,
    ...validation.helpers, ...validation.reports, ...validation.checks,
    ...[validationPath, priorPrefix + 'audit-final.log', priorPrefix + 'gate0-final.log']
      .map(path => ({ path, sha256: digest(fs.readFileSync(path)) }))];
  const bound = [...['sourceFiles', 'builtFiles', 'screenshots', 'observations', 'comparisons'].flatMap(key => record[key]), ...finalSealInputs];
  const walk = path => fs.readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isFile() ? [path + '/' + entry.name]
    : entry.isDirectory() && !['lib', 'node_modules', 'build', '.gradle'].includes(entry.name) ? walk(path + '/' + entry.name) : []);
  const directories = ['packages/client/ui-sidebar-documentpreview', 'packages/client/ui-primitives', 'apps/web/tests',
    'packages/client/ui-settings-hosts', 'packages/client/ui-settings-devices', 'packages/client/connection',
    'packages/api/gateway', 'packages/api', 'packages/client/file-upload', 'packages/attachment', 'packages/bundle',
    'apps/android', 'packages/api/device-trust', 'packages/typert/protocol', 'apps/android/contract', 'apps/apple/contract',
    '.agents/notes/implemented/feature'];
  const paths = [...new Set([...bound.map(file => file.path), ...directories.flatMap(walk), 'pnpm-lock.yaml',
    'native/README.md', 'native/README.zh.md', 'native/README.i18n.yaml', 'package.json', 'apps/cli/package.json',
    'tsconfig.json', 'tsconfig.host.json', 'tsconfig.client.json', 'tsconfig.base.json', 'tsdown.config.ts',
    'scripts/gen-cordis-catalog.ts', 'scripts/gen-cordis-api.ts', 'scripts/type-equiv.manifest.json',
    'docs/subsystems/typert.md', 'docs/subsystems/typert.zh.md', 'docs/subsystems/typert.i18n.yaml',
    sourceRecord, validationPath, bindingPath, priorPrefix + 'audit-final.log', priorPrefix + 'gate0-final.log',
    'artifacts/upstream-first/specification-traceability.json', generatorPath, ...expectedReports])].map(validateRelativePath);
  const tracked = new Set(git(['ls-tree', '-r', '--name-only', '-z', 'HEAD']).toString('utf8').split('\0'));
  const requested = paths.filter(path => tracked.has(path));
  const head = new Map();
  for (let offset = 0; offset < requested.length; offset += 100) {
    const batch = requested.slice(offset, offset + 100);
    const bytes = execFileSync('git', ['-c', 'core.fsmonitor=false', 'cat-file', '--batch'], {
      input: batch.map(path => 'HEAD:' + path + '\n').join(''), maxBuffer: 1 << 28,
    });
    let cursor = 0;
    for (const path of batch) {
      const end = bytes.indexOf(10, cursor);
      const header = bytes.subarray(cursor, end).toString('ascii');
      const match = /^[a-f0-9]+ blob (\d+)$/u.exec(header); assert.ok(match, header);
      const length = Number(match[1]);
      head.set(path, bytes.subarray(end + 1, end + 1 + length)); cursor = end + length + 2;
    }
    assert.equal(cursor, bytes.length);
  }
  const boundBytes = new Map();
  for (const file of bound) {
    const archived = history.get(file.path + ':' + file.sha256);
    const current = fs.existsSync(file.path) ? fs.readFileSync(file.path) : undefined;
    const actual = archived !== undefined ? fs.readFileSync(archived) : current && digest(current) === file.sha256 ? current : head.get(file.path);
    assert.ok(actual, 'Missing prior bound input: ' + file.path);
    assert.equal(digest(actual), file.sha256, 'Prior bound input changed: ' + file.path);
    if (boundBytes.has(file.path)) assert.equal(digest(boundBytes.get(file.path)), file.sha256, 'Conflicting bound bytes: ' + file.path);
    boundBytes.set(file.path, actual);
  }
  const archiveRoot = resolve(before);
  const workspaceRoot = resolve('.');
  const entries = paths.map(originalPath => {
    let bytes = boundBytes.get(originalPath) ?? head.get(originalPath);
    if (bytes === undefined && fs.existsSync(originalPath)) bytes = fs.readFileSync(originalPath);
    if (bytes === undefined) {
      for (const [key, copy] of history) if (key.startsWith(originalPath + ':')) { bytes = fs.readFileSync(copy); break; }
    }
    assert.ok(bytes, 'Before-state not found: ' + originalPath);
    const path = before + '/' + originalPath;
    const local = relative(archiveRoot, resolve(path));
    assert.ok(local && !local.startsWith('..' + sep) && !isAbsolute(local), 'Archive destination escaped: ' + path);
    for (let ancestor = resolve(path); ancestor !== workspaceRoot; ancestor = dirname(ancestor)) {
      const stat = fs.lstatSync(ancestor, { throwIfNoEntry: false });
      assert.ok(!stat?.isSymbolicLink(), 'Archive destination contains a symlink: ' + ancestor);
    }
    const sha256 = digest(bytes);
    if (fs.existsSync(path)) assert.equal(digest(fs.readFileSync(path)), sha256, 'Partial archive differs: ' + path);
    return { originalPath, path, sha256, bytes };
  });
  // Every input and any existing partial copy is verified before the first archive mutation.
  let reused = 0; let written = 0;
  for (const entry of entries) {
    if (fs.existsSync(entry.path)) { reused++; continue; }
    fs.mkdirSync(dirname(entry.path), { recursive: true });
    fs.writeFileSync(entry.path, entry.bytes, { flag: 'wx' }); written++;
  }
  const files = entries.map(({ originalPath, path, sha256 }) => ({ originalPath, path, sha256 }));
  fs.writeFileSync(before + '/archive.json', JSON.stringify({ schemaVersion: 1, sourceRecord, baseSha: record.baseSha, files }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ files: files.length, reused, written }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) prepare();
