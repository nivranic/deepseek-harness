/** Invalid evidence must not admit feature work merely because report files exist. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { validateAudit } from './verify-audit.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = file => JSON.parse(readFileSync(resolve(root, file), 'utf8'));
const fixture = () => [read('UPSTREAM_DELTA.json'), read('CUSTOM_CAPABILITY_INVENTORY.json'), read('artifacts/upstream-first/evidence.json'), read('artifacts/upstream-first/component-reviews.json')];

test('admits completed source review and rejects an explicitly open gate', () => {
  const args = fixture();
  assert.equal(validateAudit(...args, true).gate0, 'PASS');
  args[2].gate0 = 'IN_PROGRESS';
  assert.throws(() => validateAudit(...args, true), /Gate 0 is not complete/u);
});

test('rejects evidence from another source commit', () => {
  const args = fixture();
  args[2].candidateSha = '0'.repeat(40);
  assert.throws(() => validateAudit(...args), /candidate SHA mismatch/u);
});

test('rejects omitted downstream paths', () => {
  const args = fixture();
  args[1].components[0].paths.pop();
  assert.throws(() => validateAudit(...args), /incomplete path coverage/u);
});

test('rejects undocumented classifications', () => {
  const args = fixture();
  args[1].components[0].classification = 'ProbablyFine';
  assert.throws(() => validateAudit(...args), /unknown classification/u);
});

test('rejects Gate 0 PASS while patch review is incomplete', () => {
  const args = fixture();
  const group = args[3].groups.shift();
  for (const owner of group.owners) {
    const component = args[1].components.find(c => c.owner === owner);
    component.reviewStatus = 'IN_PROGRESS';
  }
  args[1].coverage.reviewedComponents -= group.owners.length;
  args[1].coverage.patchReviewsRemaining += group.owners.length;
  args[2].gate0 = 'PASS';
  assert.throws(() => validateAudit(...args), /complete patch review/u);
});

test('rejects RC qualification from an audit receipt', () => {
  const args = fixture();
  args[2].completeRc = true;
  assert.throws(() => validateAudit(...args), /cannot qualify an RC/u);
});

test('rejects reviewed status without its source review record', () => {
  const args = fixture();
  args[3].groups.shift();
  assert.throws(() => validateAudit(...args), /PASS component has no source review/u);
});

test('rejects reviews against a different downstream commit', () => {
  const args = fixture();
  args[3].sourceTipSha = '0'.repeat(40);
  assert.throws(() => validateAudit(...args), /review source SHA mismatch/u);
});

test('rejects omitted uncommitted source dispositions', () => {
  const args = fixture();
  args[3].uncommittedReviews.pop();
  assert.throws(() => validateAudit(...args), /incomplete uncommitted source review/u);
});

test('rejects Gate 0 without an actionable migration plan', () => {
  const args = fixture();
  for (const group of args[3].groups) group.retainedWork = [];
  assert.throws(() => validateAudit(...args), /actionable migration plan/u);
});

test('rejects a migration task without a valid phase', () => {
  const args = fixture();
  args[3].groups.find(g => g.retainedWork.length > 0).retainedWork[0].phase = 99;
  assert.throws(() => validateAudit(...args), /migration task requires/u);
});

test('rejects an unknown migration task status', () => {
  const args = fixture();
  args[3].groups.find(g => g.retainedWork.length > 0).retainedWork[0].status = 'ProbablyDone';
  assert.throws(() => validateAudit(...args), /unknown migration task status/u);
});

test('rejects completed migration work without a result receipt', () => {
  const args = fixture();
  const task = args[3].groups.find(g => g.retainedWork.length > 0).retainedWork[0];
  task.status = 'PASS';
  delete task.receipt;
  assert.throws(() => validateAudit(...args), /completed migration task requires/u);
});
