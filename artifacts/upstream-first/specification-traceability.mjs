/** Lossless source coverage for the recovered specification; coverage is not acceptance. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const REPORT_STATUSES = new Set(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'PASS', 'FAIL', 'DEFERRED']);
export const sha256 = value => createHash('sha256').update(value).digest('hex');

export function specificationSections(source) {
  const lines = source.split(/\r?\n/), preamble = [], sections = [];
  let section;
  lines.forEach((text, offset) => {
    const match = /^(?:# (\d+)\. |## (0)\. )(.+)$/u.exec(text);
    if (match) {
      if (section) section.lineEnd = offset;
      section = { number: Number(match[1] ?? match[2]), title: match[3], lineStart: offset + 1, lineEnd: lines.length, sourceUnits: [] };
      sections.push(section);
    }
    if (text.trim() !== '') (section?.sourceUnits ?? preamble).push({ line: offset + 1, text });
  });
  assert.deepEqual(sections.map(s => s.number), Array.from({ length: 81 }, (_, n) => n), 'numbered specification sections must remain 0..80');
  return { preamble, sections };
}

export function validateTraceability(record, source, expectedHash) {
  assert.equal(sha256(source), expectedHash, 'original specification bytes changed');
  assert.equal(record.specification.sha256, expectedHash, 'traceability specification hash mismatch');
  const extracted = specificationSections(source.toString('utf8'));
  assert.deepEqual(record.preamble, extracted.preamble, 'specification preamble omitted');
  assert.equal(record.sections.length, 81, 'specification section omitted');
  record.sections.forEach((section, index) => {
    for (const key of ['number', 'title', 'lineStart', 'lineEnd', 'sourceUnits']) {
      assert.deepEqual(section[key], extracted.sections[index][key], 'specification source unit changed or omitted: ' + index + '/' + key);
    }
    assert.ok(REPORT_STATUSES.has(section.verificationStatus), 'unknown section verification status');
    assert.equal(section.acceptanceProven, false, 'initial traceability cannot claim acceptance without item-level evidence review');
    assert.notEqual(section.verificationStatus, 'PASS', 'source coverage does not prove requirement acceptance');
    assert.ok(section.candidateEvidence.length > 0, 'missing evidence location');
    assert.ok(section.remaining.length > 0, 'missing remaining work');
  });
  const units = extracted.preamble.length + extracted.sections.reduce((n, s) => n + s.sourceUnits.length, 0);
  assert.equal(record.coverage.nonEmptySourceLines, units, 'incorrect source coverage count');
  assert.equal(record.coverage.numberedSections, 81);
  assert.equal(record.fullGoalComplete, false, 'traceability is not a completion audit');
  return { status: 'PASS', numberedSections: 81, nonEmptySourceLines: units, acceptanceProven: false };
}

export function validateReportStatuses(value) {
  if (Array.isArray(value)) return value.forEach(validateReportStatuses);
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'status') assert.ok(REPORT_STATUSES.has(child), 'unknown report status: ' + child);
    validateReportStatuses(child);
  }
}
