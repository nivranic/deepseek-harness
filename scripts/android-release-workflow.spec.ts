/** Exercise the hosted Linux artifact-preservation step with unsigned and rejected ZIP inputs. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { beforeAll, describe, expect, it } from 'vitest'

interface Step { name?: string; run?: string; if?: string; uses?: string; 'continue-on-error'?: boolean }
interface Workflow { jobs: { 'gradle-test': { steps: Step[] } } }

const workflow = load(readFileSync('.github/workflows/android-kotlin.yml', 'utf8')) as Workflow
const steps = workflow.jobs['gradle-test'].steps
const preserve = steps.find(step => step.name === 'Preserve unsigned release bundle and R8 mapping')!

describe.skipIf(process.platform !== 'linux')('Android release artifact preservation on hosted Linux', () => {
  beforeAll(() => {
    expect(spawnSync('unzip', ['-v']).status, 'hosted Linux preservation requires unzip').toBe(0)
  })

  it.each(['unsigned', 'signed', 'missing-mapping', 'corrupt'] as const)('handles %s input before upload', (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-android-release-'))
    try {
      mkdirSync(join(root, 'bundle/release'), { recursive: true })
      mkdirSync(join(root, 'mapping/release'), { recursive: true })
      const bundle = join(root, 'bundle/release/app-release.aab')
      const generated = spawnSync('python3', ['-c', [
        'import sys, zipfile',
        'with zipfile.ZipFile(sys.argv[1], "w") as archive:',
        '    archive.writestr("BundleConfig.pb", b"synthetic bundle input")',
        '    if sys.argv[2] == "signed": archive.writestr("META-INF/SIGNER.RSA", b"signature sentinel")',
      ].join('\n'), bundle, kind], { encoding: 'utf8' })
      expect(generated.status, generated.stderr).toBe(0)
      if (kind === 'corrupt') writeFileSync(bundle, 'not a ZIP')
      if (kind !== 'missing-mapping') writeFileSync(join(root, 'mapping/release/mapping.txt'), 'mapping sentinel\n')
      expect(preserve.run).toBeTypeOf('string')
      const result = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', preserve.run!], {
        cwd: root, encoding: 'utf8', timeout: 10_000,
      })
      const output = join(root, 'release-foundation')
      if (kind !== 'unsigned') {
        expect(result.status, result.stderr).not.toBe(0)
        expect(existsSync(output)).toBe(false)
        return
      }
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(join(output, 'app-release.aab'))).toEqual(readFileSync(bundle))
      expect(readFileSync(join(output, 'mapping.txt'), 'utf8')).toBe('mapping sentinel\n')
      const checksums = readFileSync(join(output, 'SHA256SUMS'), 'utf8')
      for (const file of ['app-release.aab', 'mapping.txt']) {
        const digest = createHash('sha256').update(readFileSync(join(output, file))).digest('hex')
        expect(checksums).toContain(`${digest}  ${file}\n`)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

it('runs bundle validation before preservation and publishes only after success', () => {
  const validate = steps.findIndex(step => step.name === 'Build and validate the unsigned release bundle')
  const preserveIndex = steps.indexOf(preserve)
  const upload = steps.findIndex(step => step.name === 'Upload unsigned Android release foundation')
  expect(validate).toBeGreaterThanOrEqual(0)
  expect(preserveIndex).toBeGreaterThan(validate)
  expect(upload).toBeGreaterThan(preserveIndex)
  expect(steps[validate]?.run).toContain(':app:lintRelease :app:validateReleaseBundle')
  for (const index of [validate, preserveIndex, upload]) {
    expect(steps[index]?.if).toBeUndefined()
    expect(steps[index]?.['continue-on-error']).toBeUndefined()
  }
  expect(steps[upload]?.uses).toMatch(/^actions\/upload-artifact@/)
})
