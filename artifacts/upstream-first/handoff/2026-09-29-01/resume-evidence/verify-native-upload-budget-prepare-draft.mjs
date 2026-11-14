import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { validatePriorSeal, validateRelativePath } from './prepare-native-upload-budget.mjs';

const sourcePath = 'artifacts/upstream-first/android-attachment-receipt-recovery-source.json';
const validationPath = 'artifacts/upstream-first/android-attachment-receipt-recovery-report-validation.json';
const bindingPath = 'artifacts/upstream-first/android-attachment-receipt-recovery-binding.json';
const prefix = '.artifacts/android-attachment-receipt-recovery-';
const generator = 'artifacts/upstream-first/write-reports.mjs';
const evidencePath = 'artifacts/upstream-first/evidence.json';
const files = new Map();
const put = (path, value) => files.set(path, Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
const hash = path => ({ path, sha256: createHash('sha256').update(files.get(path)).digest('hex') });
put(generator, 'synthetic generator');
put('IMPLEMENTATION_STATUS.md', 'synthetic report');
put(evidencePath, { latestSourceRecord: sourcePath, completeRc: false });
put('apps/synthetic-source.ts', 'synthetic prior source');
const source = {
  baseSha: 'c291e7961a515f6d7af9304e7fd1d257929aef26', conclusions: { androidAttachmentReceiptRecovery: true },
  sourceFiles: [hash('apps/synthetic-source.ts'), hash('IMPLEMENTATION_STATUS.md')], builtFiles: [], logs: [], helpers: [], historicalRecords: [], screenshots: [], observations: [], comparisons: [], removedPaths: [],
};
put(sourcePath, source);
const sourceSha = hash(sourcePath).sha256;
const bindingHelper = '.artifacts/check-android-attachment-receipt-recovery-binding.mjs';
put(bindingHelper, 'synthetic binding helper');
put(bindingPath, { status: 'PASS', controls: 3, sourceRecord: hash(sourcePath), generator: hash(generator), helper: hash(bindingHelper) });
const helperPaths = ['advance-android-attachment-receipt-recovery-reports', 'capture-android-attachment-receipt-recovery-validation'].map(name => '.artifacts/' + name + '.mjs');
helperPaths.forEach(path => put(path, 'synthetic helper'));
const audit = '# tests 19\n# pass 19\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
put(prefix + 'binding.log', 'PASS synthetic controls');
put(prefix + 'audit-tests.log', audit); put(prefix + 'audit-final.log', audit);
put(prefix + 'gate0-report.log', { validation: 'PASS', gate0: 'PASS' });
put(prefix + 'gate0-final.log', { validation: 'PASS', gate0: 'PASS' });
put(prefix + 'report-diff-check.log', ''); put(prefix + 'report-generation.log', 'synthetic generation');
put(validationPath, {
  status: 'PASS', gate0: { validation: 'PASS', gate0: 'PASS' }, sourceRecord: hash(sourcePath), generator: hash(generator), binding: hash(bindingPath),
  helpers: helperPaths.map(hash), reports: ['IMPLEMENTATION_STATUS.md', evidencePath].map(hash),
  checks: ['binding', 'audit-tests', 'gate0-report', 'report-diff-check', 'report-generation'].map(name => hash(prefix + name + '.log')),
});
const read = map => path => { assert.ok(map.has(path), 'Missing synthetic input: ' + path); return map.get(path); };
assert.deepEqual(validatePriorSeal(read(files), sourceSha), source);
let negativeControls = 0;
const rejects = change => {
  const changed = new Map(files); change(changed);
  assert.throws(() => validatePriorSeal(read(changed), sourceSha)); negativeControls++;
};
const changeReceipt = mutate => rejects(changed => {
  const receipt = JSON.parse(changed.get(validationPath)); mutate(receipt);
  changed.set(validationPath, Buffer.from(JSON.stringify(receipt)));
});
for (const path of [validationPath, bindingPath, prefix + 'audit-final.log', prefix + 'gate0-final.log']) rejects(changed => changed.delete(path));
changeReceipt(receipt => receipt.status = 'PENDING');
changeReceipt(receipt => receipt.sourceRecord.sha256 = '0'.repeat(64));
changeReceipt(receipt => receipt.gate0.validation = 'FAIL');
changeReceipt(receipt => receipt.helpers[1] = receipt.helpers[0]);
changeReceipt(receipt => receipt.checks.pop());
changeReceipt(receipt => receipt.reports[0].path = '../outside.md');
for (const path of [generator, evidencePath, bindingHelper, 'apps/synthetic-source.ts', prefix + 'report-generation.log']) {
  rejects(changed => changed.set(path, Buffer.from('changed')));
}
rejects(changed => changed.set(prefix + 'audit-final.log', Buffer.from(audit.replace('# fail 0', '# fail 1'))));
rejects(changed => changed.set(prefix + 'gate0-final.log', Buffer.from('{"validation":"PASS","gate0":"FAIL"}')));
rejects(changed => {
  const report = Buffer.from('a different final report');
  changed.set('IMPLEMENTATION_STATUS.md', report);
  const receipt = JSON.parse(changed.get(validationPath));
  receipt.reports[0].sha256 = createHash('sha256').update(report).digest('hex');
  changed.set(validationPath, Buffer.from(JSON.stringify(receipt)));
});
assert.throws(() => validatePriorSeal(read(files), '0'.repeat(64))); negativeControls++;
for (const path of ['../outside', '/absolute', 'C:/outside', 'a\\b', 'a/../b', 'a//b', '.glm-router/log', '.git/config', 'a\nb', 'a\0b']) {
  assert.throws(() => validateRelativePath(path)); negativeControls++;
}
assert.equal(validateRelativePath('apps/android/README.md'), 'apps/android/README.md');
const prepareText = fs.readFileSync('.artifacts/prepare-native-upload-budget.mjs', 'utf8');
assert.ok(prepareText.includes("const expectedSourceSha = 'a6885018a5c9d2ca9564314993f9edff2d1af832023244979fd2842101feb14d'"));
assert.ok(prepareText.includes('const record = validatePriorSeal(path => fs.readFileSync(path), expectedSourceSha)'));
assert.ok(prepareText.indexOf('const record = validatePriorSeal(') < prepareText.indexOf('fs.mkdirSync('));
assert.ok(prepareText.includes("digest(git(['show', 'HEAD:' + sourceRecord]))"));
assert.ok(prepareText.includes("git(['rev-parse', 'origin/agents/upstream-first'])"));
assert.ok(prepareText.includes('...validation.helpers, ...validation.reports, ...validation.checks'));
assert.ok(prepareText.includes('...finalSealInputs]'));
assert.ok(prepareText.includes("'scripts/gen-cordis-api.ts'"));
assert.ok(prepareText.includes('!stat?.isSymbolicLink()'));
assert.ok(prepareText.includes("{ flag: 'wx' }"));
assert.ok(prepareText.includes('import.meta.url === pathToFileURL(resolve(process.argv[1])).href'));
console.log(JSON.stringify({ status: 'PASS', negativeControls, scope: 'In-memory prior-seal validation and static prepare checks only; archive preparation was not invoked' }));
