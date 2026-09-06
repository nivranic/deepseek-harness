/** Exercise the hosted Linux artifact-preservation step with unsigned and rejected ZIP inputs. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { beforeAll, describe, expect, it } from 'vitest'

interface Step { name?: string; run?: string; if?: string; uses?: string; 'continue-on-error'?: boolean }
interface Workflow { jobs: { 'gradle-test': { steps: Step[] } } }

const workflow = load(readFileSync('.github/workflows/android-kotlin.yml', 'utf8')) as Workflow
const steps = workflow.jobs['gradle-test'].steps
const preserve = steps.find(step => step.name === 'Preserve unsigned release bundle and R8 mapping')!

it.skipIf(process.platform !== 'linux')('finds sdkmanager under an SDK root with spaces without requiring it on PATH', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh android sdk '))
  try {
    const bin = join(root, 'cmdline-tools/latest/bin')
    mkdirSync(bin, { recursive: true })
    const executable = join(bin, 'sdkmanager')
    writeFileSync(executable, '#!/bin/sh\n[ "$#" -eq 1 ] && [ "$1" = "platforms;android-36" ]\n')
    chmodSync(executable, 0o700)
    const supply = load(readFileSync('.github/workflows/supply-chain.yml', 'utf8')) as { jobs: { codeql: { steps: Step[] } } }
    for (const workflowSteps of [steps, supply.jobs.codeql.steps]) {
      const install = workflowSteps.find(step => step.name === 'Install Android compile SDK')!
      expect(install.run).toBeTypeOf('string')
      const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', install.run!], {
        env: { ...process.env, ANDROID_HOME: root, PATH: root }, encoding: 'utf8', timeout: 10_000,
      })
      expect(result.status, result.stderr).toBe(0)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

describe.skipIf(process.platform !== 'linux')('Android release artifact preservation on hosted Linux', () => {
  beforeAll(() => {
    expect(spawnSync('unzip', ['-v']).status, 'hosted Linux preservation requires unzip').toBe(0)
  })

  it.each(['unsigned', 'signed', 'missing-mapping', 'missing-sbom', 'missing-inventory', 'corrupt'] as const)('handles %s input before upload', (kind) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-android-release-'))
    try {
      mkdirSync(join(root, 'bundle/release'), { recursive: true })
      mkdirSync(join(root, 'mapping/release'), { recursive: true })
      mkdirSync(join(root, 'release-inventory'))
      if (kind !== 'missing-sbom') writeFileSync(join(root, 'release-inventory/sbom.cdx.json'), '{}\n')
      if (kind !== 'missing-inventory') writeFileSync(join(root, 'release-inventory/inventory.json'), '{}\n')
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
        if (kind !== 'missing-sbom' && kind !== 'missing-inventory') expect(existsSync(output)).toBe(false)
        return
      }
      expect(result.status, result.stderr).toBe(0)
      expect(readFileSync(join(output, 'app-release.aab'))).toEqual(readFileSync(bundle))
      expect(readFileSync(join(output, 'mapping.txt'), 'utf8')).toBe('mapping sentinel\n')
      const checksums = readFileSync(join(output, 'SHA256SUMS'), 'utf8')
      for (const file of ['app-release.aab', 'mapping.txt', 'sbom.cdx.json', 'inventory.json']) {
        const digest = createHash('sha256').update(readFileSync(join(output, file))).digest('hex')
        expect(checksums).toContain(`${digest}  ${file}\n`)
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

it('runs bundle validation before preservation and publishes only after success', () => {
  const signing = steps.findIndex(step => step.name === 'Verify Android signing configuration')
  const sbomTests = steps.findIndex(step => step.name === 'Verify Android SBOM scanners')
  const sbom = steps.findIndex(step => step.name === 'Inventory unsigned Android release bundle')
  const validate = steps.findIndex(step => step.name === 'Build and validate the unsigned release bundle')
  const preserveIndex = steps.indexOf(preserve)
  const upload = steps.findIndex(step => step.name === 'Upload unsigned Android release foundation')
  expect(validate).toBeGreaterThanOrEqual(0)
  expect(signing).toBeGreaterThan(validate)
  expect(steps[signing]?.run).toContain('test_android_signing.py')
  expect(sbomTests).toBeGreaterThan(signing)
  expect(sbom).toBeGreaterThan(sbomTests)
  expect(steps[sbomTests]?.run).toContain('test_android_sbom*.py')
  expect(steps[sbom]?.run).toContain('scripts/release/android_sbom.py')
  expect(steps[sbom]?.run).toContain('--output apps/android/app/build/outputs/release-inventory')
  expect(preserveIndex).toBeGreaterThan(sbom)
  expect(upload).toBeGreaterThan(preserveIndex)
  expect(steps[validate]?.run).toContain(':app:lintRelease :app:validateReleaseBundle')
  for (const index of [signing, validate, sbomTests, sbom, preserveIndex, upload]) {
    expect(steps[index]?.if).toBeUndefined()
    expect(steps[index]?.['continue-on-error']).toBeUndefined()
  }
  expect(steps[upload]?.uses).toMatch(/^actions\/upload-artifact@/)
})
