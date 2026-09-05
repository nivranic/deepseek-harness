/** Security jobs must execute every language and reject incomplete scans without write privileges. */
import { readFileSync } from 'node:fs'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

interface Step { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown>; 'continue-on-error'?: boolean }
interface Job { needs?: string[]; steps: Step[]; permissions?: Record<string, string>; strategy?: { matrix: { include: { language: string; 'build-mode': string }[] } } }
interface Workflow { permissions: Record<string, string>; on: Record<string, unknown>; jobs: Record<string, Job> }

const workflow = load(readFileSync('.github/workflows/supply-chain.yml', 'utf8')) as Workflow

describe('candidate security workflow', () => {
  it('requires all scanners and preserves read-only credentials on candidate code', () => {
    expect(workflow.on).toHaveProperty('pull_request')
    expect(workflow.on).not.toHaveProperty('pull_request_target')
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.verdict?.needs).toEqual(['secrets', 'dependencies', 'codeql'])
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions).toBeUndefined()
      for (const step of job.steps) {
        expect(step['continue-on-error']).toBeUndefined()
        if (step.uses?.startsWith('actions/checkout@')) {
          expect(step.with?.['persist-credentials']).toBe(false)
          expect(step.with?.ref).toBe('${{ env.DSH_SECURITY_CANDIDATE }}')
        }
      }
    }
  })

  it('covers the four application languages with compiled native app targets', () => {
    const job = workflow.jobs.codeql!
    expect(job.strategy?.matrix.include).toEqual([
      { language: 'javascript-typescript', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'python', os: 'ubuntu-latest', 'build-mode': 'none' },
      { language: 'java-kotlin', os: 'ubuntu-latest', 'build-mode': 'manual' },
      { language: 'swift', os: 'macos-latest', 'build-mode': 'manual' },
    ])
    const commands = job.steps.map(step => step.run ?? '').join('\n')
    for (const target of [':core:classes :app:assembleDebug', 'swift build', '-scheme CompanioniOS', '-scheme CompanionMac', '-scheme DirectHostMac']) expect(commands).toContain(target)
    expect(job.steps.find(step => step.uses?.startsWith('github/codeql-action/init@'))?.with?.queries).toBe('security-extended')
    expect(job.steps.find(step => step.uses?.startsWith('github/codeql-action/analyze@'))?.with?.upload).toBe('never')
    expect(job.steps.find(step => step.uses?.startsWith('github/codeql-action/analyze@'))?.with?.['upload-database']).toBe(false)
    expect(job.steps.find(step => step.name === 'Reject security findings')?.run).toContain('scripts/security-evidence.py sast')
  })

  it('does not turn dependency warnings or missing secret history into success', () => {
    const review = workflow.jobs.dependencies!.steps.find(step => step.uses?.startsWith('actions/dependency-review-action@'))!
    expect(review.with).toMatchObject({ 'fail-on-severity': 'low', 'warn-only': false, 'vulnerability-check': true, 'comment-summary-in-pr': 'never' })
    const secrets = workflow.jobs.secrets!.steps
    expect(secrets.find(step => step.uses?.startsWith('actions/checkout@'))?.with?.['fetch-depth']).toBe(0)
    expect(secrets.find(step => step.name === 'Scan immutable candidate')?.run).toContain('scripts/scan-secrets.py --candidate')
  })
})
