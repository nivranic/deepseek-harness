/** Checklist metadata cannot narrow engineering requirements or grant production authority. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { removeFixtureSafely } from '../test-fixture-cleanup.ts'
import { evaluateReleaseChecklist, parseReleaseChecklist, type GovernanceObservation } from './governance.ts'

const repository = resolve(import.meta.dirname, '../..')
const input = () => JSON.parse(readFileSync(join(repository, 'release/checklist.json'), 'utf8')) as Record<string, unknown>
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) removeFixtureSafely(root) })

it('keeps publication unauthorized even when every engineering owner passes', () => {
  const checklist = parseReleaseChecklist(input())
  const observations: GovernanceObservation[] = checklist.engineering.map(({ id }) => ({ id, status: 'PASS', reason: 'synthetic owner result' }))
  const result = evaluateReleaseChecklist(checklist, observations)
  expect(result).toMatchObject({ decision: 'GO', publicationAuthorized: false })
  expect(result.production).toHaveLength(6)
  expect(result.production.every(row => row.status === 'NOT_EXECUTED')).toBe(true)
})

it.each(['FAIL', 'PENDING', 'UNAVAILABLE', 'absent'] as const)('blocks Go when one engineering owner is %s', (status) => {
  const checklist = parseReleaseChecklist(input())
  const observations: GovernanceObservation[] = checklist.engineering.filter(row => row.id !== 'G2-SUPPORT')
    .map(({ id }) => ({ id, status: 'PASS', reason: 'synthetic owner result' }))
  if (status !== 'absent') observations.push({ id: 'G2-SUPPORT', status, reason: 'synthetic non-PASS' })
  const result = evaluateReleaseChecklist(checklist, observations)
  expect(result.decision).toBe('NO_GO')
  expect(result.engineering.find(row => row.id === 'G2-SUPPORT')?.status).toBe(status === 'absent' ? 'UNAVAILABLE' : status)
})

it.each(['engineering', 'production'])('rejects missing, duplicate and unknown %s requirements', (group) => {
  for (const change of ['missing', 'duplicate', 'unknown']) {
    const value = input(), rows = value[group] as Record<string, unknown>[]
    if (change === 'missing') rows.pop()
    if (change === 'duplicate') rows[0] = rows[1]!
    if (change === 'unknown') rows[0]!.id = 'G2-UNKNOWN'
    expect(() => parseReleaseChecklist(value)).toThrow(/every requirement|unknown or duplicate/)
  }
})

it.each([
  ['ownerRole', 'someone'], ['evidenceOwner', 'manual-approval'], ['definitionOfDone', ' '],
  ['status', 'PASS'], ['status', 'NOT_EXECUTED'], ['waiver', true],
])('rejects invalid or additional %s metadata', (key, value) => {
  const policy = input(), rows = policy.engineering as Record<string, unknown>[]
  rows[0]![key] = value
  expect(() => parseReleaseChecklist(policy)).toThrow()
})

it('rejects moving an engineering requirement into the production-only list', () => {
  const policy = input(), engineering = policy.engineering as unknown[], production = policy.production as unknown[]
  const row = engineering[0]; engineering[0] = production[0]; production[0] = row
  expect(() => parseReleaseChecklist(policy)).toThrow('unknown or duplicate')
})

it.each([null, [], {}, { ...input(), schemaVersion: 2 }, { ...input(), scope: 'ga' }, { ...input(), decision: 'GO' }])(
  'rejects unsupported checklist input %#', (value) => { expect(() => parseReleaseChecklist(value)).toThrow() },
)

it('executes the static gate and rejects a narrowed policy with a nonzero exit', () => {
  const entry = join(repository, 'scripts/verify-release-checklist.ts')
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx/esm', entry, ...args], { cwd: repository, encoding: 'utf8' })
  const accepted = run([])
  expect(accepted.status).toBe(0)
  expect(accepted.stdout).toContain('16 engineering and 6 production')
  const root = mkdtempSync(join(tmpdir(), 'dsh-checklist-gate-')); roots.push(root)
  const value = input(); (value.engineering as unknown[]).pop()
  const path = join(root, 'policy.json'); writeFileSync(path, JSON.stringify(value))
  const rejected = run([path])
  expect(rejected).toMatchObject({ status: 1, stdout: '' })
  expect(rejected.stderr).toContain('every requirement')
})
