/** Source omissions and weak evidence cannot become requirement acceptance. */
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTraceability, validateReportStatuses } from './specification-traceability.mjs';
const source = fs.readFileSync('artifacts/upstream-first/original-specification.md');
const expected = JSON.parse(fs.readFileSync('UPSTREAM_DELTA.json')).specification.sha256;
const fixture = () => JSON.parse(fs.readFileSync('artifacts/upstream-first/specification-traceability.json'));
test('covers every numbered section and original nonempty source line without claiming acceptance', () => {
  assert.equal(validateTraceability(fixture(), source, expected).numberedSections, 81);
});
test('rejects omitted sections and source items', () => {
  const omitted = fixture(); omitted.sections.pop();
  assert.throws(() => validateTraceability(omitted, source, expected), /section omitted/u);
  const changed = fixture(); changed.sections[17].sourceUnits.pop();
  assert.throws(() => validateTraceability(changed, source, expected), /source unit changed or omitted/u);
});
test('rejects altered requirements and another specification', () => {
  const changed = fixture(); changed.sections[79].sourceUnits[0].text += ' altered';
  assert.throws(() => validateTraceability(changed, source, expected), /source unit changed or omitted/u);
  assert.throws(() => validateTraceability(fixture(), Buffer.concat([source, Buffer.from('changed')]), expected), /specification bytes changed/u);
});
test('rejects unreviewed acceptance and completion claims', () => {
  const accepted = fixture(); accepted.sections[17].verificationStatus = 'PASS';
  assert.throws(() => validateTraceability(accepted, source, expected), /does not prove requirement acceptance/u);
  const complete = fixture(); complete.fullGoalComplete = true;
  assert.throws(() => validateTraceability(complete, source, expected), /not a completion audit/u);
});
test('rejects unsupported public status vocabulary', () => {
  assert.throws(() => validateReportStatuses({ checks: [{ status: 'PARTIAL' }] }), /unknown report status/u);
  assert.doesNotThrow(() => validateReportStatuses({ status: 'IN_PROGRESS', checks: [{ status: 'FAIL' }] }));
});
test('rejects unknown verification states and missing evidence locations', () => {
  const state = fixture(); state.sections[0].verificationStatus = 'PROBABLY_DONE';
  assert.throws(() => validateTraceability(state, source, expected), /unknown section verification status/u);
  const empty = fixture(); empty.sections[55].candidateEvidence = [];
  assert.throws(() => validateTraceability(empty, source, expected), /missing evidence location/u);
});
