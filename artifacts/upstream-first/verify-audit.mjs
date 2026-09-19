/** Validate capture completeness without treating a captured inventory as a completed migration. */
import assert from 'node:assert/strict';
import { validateTraceability, validateReportStatuses } from './specification-traceability.mjs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const classifications = new Set(['Adopt', 'Adapt', 'Keep', 'Migrate', 'Delete', 'Experimental']);
const statuses = new Set(['NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'PASS', 'FAIL', 'DEFERRED']);

/**
 * Check SHA binding, complete path coverage, closed states, and honest Gate 0 qualification.
 * @param baseline - Captured Git worktrees and comparisons.
 * @param inventory - Classified components and capability dispositions.
 * @param evidence - Candidate-specific execution results.
 * @param reviews - SHA-bound source review records, distinct from migration acceptance.
 * @param requireGate0 - Reject valid but incomplete audits when used for phase admission.
 * @returns Counts for the validated inventory, with its actual Gate 0 state.
 */
export function validateAudit(baseline, inventory, evidence, reviews, requireGate0 = false) {
  assert.match(baseline.upstream.sha, /^[0-9a-f]{40}$/u, 'invalid upstream SHA');
  assert.equal(baseline.candidate.sha, baseline.upstream.sha, 'candidate baseline differs from captured upstream');
  assert.equal(inventory.upstreamSha, baseline.upstream.sha, 'inventory upstream SHA mismatch');
  assert.equal(evidence.upstreamSha, baseline.upstream.sha, 'evidence upstream SHA mismatch');
  assert.equal(evidence.candidateSha, baseline.candidate.sha, 'evidence candidate SHA mismatch');
  assert.equal(evidence.completeRc, false, 'an audit cannot qualify an RC');
  assert.equal(reviews.upstreamSha, baseline.upstream.sha, 'review upstream SHA mismatch');
  assert.equal(reviews.sourceTipSha, inventory.sourceTipSha, 'review source SHA mismatch');
  const expectedUncommitted = baseline.worktrees.filter(w => w.branch !== 'refs/heads/agents/upstream-first')
    .flatMap(w => [...w.trackedStatusRecords.map(row => row.slice(3)), ...w.untrackedPaths]
      .map(path => `${w.head}:${w.path}:${path}`)).sort();
  const actualUncommitted = reviews.uncommittedReviews.map(row => {
    assert.equal(row.reviewStatus, 'PASS', 'uncommitted source requires a disposition');
    assert.equal(row.classification, 'Keep', 'historical uncommitted reports must be retained');
    assert.match(row.sha256, /^[0-9a-f]{64}$/u, 'uncommitted source requires a file digest');
    assert.ok(row.disposition.length > 0, 'uncommitted source requires a reason');
    return `${row.head}:${row.worktree}:${row.path}`;
  }).sort();
  assert.deepEqual(actualUncommitted, expectedUncommitted, 'incomplete uncommitted source review');
  const reviewedOwners = new Map();
  const reviewIds = new Set();
  for (const group of reviews.groups) {
    assert.ok(!reviewIds.has(group.id), 'duplicate review id');
    reviewIds.add(group.id);
    assert.ok(group.evidence.length > 0 && group.upstreamEvidence.length > 0 && group.reason.length > 0, 'review requires source evidence');
    assert.ok(Array.isArray(group.retainedWork), 'review requires migration tasks or an explicit empty list');
    for (const task of group.retainedWork) {
      assert.ok(Number.isInteger(task.phase) && task.phase >= 1 && task.phase <= 12
        && task.action.length > 0 && task.target.length > 0, 'migration task requires phase, action and target');
      assert.ok(statuses.has(task.status ?? 'NOT_STARTED'), 'unknown migration task status');
      if (task.status === 'PASS') {
        assert.ok(task.result?.length > 0 && task.receipt?.length > 0, 'completed migration task requires result and receipt');
      }
    }
    for (const owner of group.owners) {
      assert.ok(!reviewedOwners.has(owner), 'duplicate reviewed owner');
      reviewedOwners.set(owner, group);
    }
  }
  const expectedPaths = new Set(baseline.worktrees.flatMap(w => w.downstreamChanges.map(c => c.path)));
  const actualPaths = inventory.components.flatMap(c => c.paths);
  assert.ok(expectedPaths.size > 0, 'empty downstream comparison');
  assert.equal(actualPaths.length, new Set(actualPaths).size, 'duplicate component path');
  assert.deepEqual([...new Set(actualPaths)].sort(), [...expectedPaths].sort(), 'incomplete path coverage');
  assert.equal(inventory.coverage.uniqueChangedPaths, expectedPaths.size, 'path count mismatch');
  assert.equal(inventory.coverage.components, inventory.components.length, 'component count mismatch');
  assert.equal(inventory.coverage.worktrees, baseline.worktrees.length, 'worktree count mismatch');
  const capabilityIds = new Set(inventory.capabilities.map(c => c.id));
  assert.equal(capabilityIds.size, inventory.capabilities.length, 'duplicate capability id');
  for (const row of [...inventory.components, ...inventory.capabilities]) {
    assert.ok(classifications.has(row.classification), `unknown classification: ${row.classification}`);
  }
  for (const row of inventory.components) {
    assert.ok(statuses.has(row.reviewStatus), 'unknown component review status');
    assert.ok(row.capabilityId === null || capabilityIds.has(row.capabilityId), 'missing capability mapping');
    assert.ok(row.paths.length > 0 && row.sourceShas.length > 0, 'empty component');
    const review = reviewedOwners.get(row.owner);
    if (row.reviewStatus === 'PASS') {
      assert.ok(review !== undefined, 'PASS component has no source review');
      assert.equal(row.reviewId, review.id, 'review id mismatch');
      assert.equal(row.classification, review.classification, 'review classification mismatch');
      assert.equal(row.capabilityId, review.capabilityId, 'review capability mismatch');
    } else assert.ok(review === undefined, 'review record not projected into inventory');
  }
  assert.equal(inventory.coverage.reviewedComponents, reviewedOwners.size, 'reviewed component count mismatch');
  assert.equal(inventory.coverage.patchReviewsRemaining, inventory.components.length - reviewedOwners.size, 'remaining review count mismatch');
  assert.ok([...reviewedOwners.keys()].every(owner => inventory.components.some(c => c.owner === owner)), 'reviewed owner missing from inventory');
  for (const row of inventory.capabilities) {
    for (const field of ['status', 'ownershipReview', 'migrationStatus']) assert.ok(statuses.has(row[field]), `unknown ${field}`);
    assert.ok(row.sourcePaths.length > 0 && row.targetPaths.length > 0 && row.decision.length > 0, 'incomplete disposition');
  }
  for (const check of [...evidence.checks, ...evidence.blockers]) assert.ok(statuses.has(check.status), 'unknown evidence status');
  for (const state of [inventory.status, evidence.gate0, evidence.phase0, evidence.phase1]) assert.ok(statuses.has(state), 'unknown stage status');
  if (evidence.gate0 === 'PASS') {
    assert.equal(reviews.status, 'PASS', 'Gate 0 requires completed source review');
    assert.ok(reviews.groups.some(g => g.retainedWork.length > 0), 'Gate 0 requires an actionable migration plan');
    assert.ok(inventory.components.every(c => c.reviewStatus === 'PASS' && c.capabilityId !== null), 'Gate 0 requires complete patch review');
    assert.equal(evidence.phase1, 'PASS', 'Gate 0 requires completed Phase 1');
    assert.equal(inventory.status, 'PASS', 'Gate 0 requires completed inventory');
  }
  if (requireGate0) assert.equal(evidence.gate0, 'PASS', 'Gate 0 is not complete; new feature development is not admitted');
  return { validation: 'PASS', gate0: evidence.gate0, paths: expectedPaths.size, components: inventory.components.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(import.meta.dirname, '../..');
  const read = name => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
  const baseline = read('UPSTREAM_DELTA.json');
  const currentHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(currentHead, baseline.candidate.sha, 'candidate HEAD changed; refresh the baseline');
  for (const report of baseline.preservedReports) {
    assert.equal(createHash('sha256').update(readFileSync(report.path)).digest('hex'), report.sha256, 'preserved report changed');
  }
  const reviews = read('artifacts/upstream-first/component-reviews.json');
  for (const row of reviews.uncommittedReviews) {
    assert.equal(createHash('sha256').update(readFileSync(resolve(row.worktree, row.path))).digest('hex'), row.sha256,
      'historical uncommitted source changed after review');
  }
  for (const group of reviews.groups) {
    for (const [sha, paths] of [[reviews.sourceTipSha, group.evidence], [reviews.upstreamSha, group.upstreamEvidence]]) {
      for (const path of paths) execFileSync('git', ['cat-file', '-e', `${sha}:${path}`], { cwd: root, stdio: 'pipe' });
    }
  }
  const evidence = read('artifacts/upstream-first/evidence.json');
  const traceability = read('artifacts/upstream-first/specification-traceability.json');
  const specification = readFileSync(resolve(root, traceability.specification.path));
  const specificationCoverage = validateTraceability(traceability, specification, baseline.specification.sha256);
  validateReportStatuses(evidence);
  console.log(JSON.stringify({ ...validateAudit(baseline, read('CUSTOM_CAPABILITY_INVENTORY.json'),
    evidence, reviews, process.argv.includes('--require-gate0')), specificationCoverage }, null, 2));
}
