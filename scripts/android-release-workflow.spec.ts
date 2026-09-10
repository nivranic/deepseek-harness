/** Exercise the hosted Linux artifact-preservation step with unsigned and rejected ZIP inputs. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'
import { beforeAll, describe, expect, it } from 'vitest'

interface Step {
  name?: string
  run?: string
  if?: string
  uses?: string
  'continue-on-error'?: boolean
  with?: { script?: string; 'api-level'?: number; target?: string; arch?: string }
}
interface Workflow { jobs: { 'gradle-test': { steps: Step[] } } }

const workflow = load(readFileSync('.github/workflows/android-kotlin.yml', 'utf8')) as Workflow
const steps = workflow.jobs['gradle-test'].steps
const preserve = steps.find(step => step.name === 'Preserve unsigned release bundle and R8 mapping')!

it.skipIf(process.platform !== 'linux').each([
  ['36', '16384', 0, 0, 0, true], ['35', '16384', 0, 0, 0, false], ['36', '4096', 0, 0, 0, false],
  ['36', '16384', 1, 0, 0, false], ['36', '16384', 0, 1, 0, false], ['36', '16384', 0, 0, 1, false],
] as const)('requires API %s / page size %s / adb %s / instrumentation %s / system export %s', (api, pages, adbExit, gradleExit, exportExit, accepted) => {
  const launch = steps.find(step => step.name === 'Launch the unpaired companion on Android')!
  expect(launch.with).toMatchObject({ 'api-level': 36, target: 'google_apis_ps16k', arch: 'x86_64' })
  const root = mkdtempSync(join(tmpdir(), 'dsh android runtime '))
  try {
    const bin = join(root, 'bin'), cwd = join(root, 'apps/android'), scripts = join(root, 'scripts/release')
    for (const directory of [bin, cwd, scripts]) mkdirSync(directory, { recursive: true })
    writeFileSync(join(scripts, 'android_runtime.py'), readFileSync('scripts/release/android_runtime.py'))
    writeFileSync(join(scripts, 'android_support_exports.py'), 'import os, sys\nfrom pathlib import Path\nassert Path("instrumentation-started").exists()\nassert sys.argv[1:] == ["--apk", "app/build/outputs/apk/debug/app-debug.apk", "--source-sha", "a" * 40, "--output", os.environ["RUNNER_TEMP"] + "/android-support-export"]\nPath("system-export-started").write_text("started")\nsys.exit(int(os.environ["DSH_TEST_EXPORT_EXIT"]))\n')
    const adb = join(bin, 'adb'), gradle = join(cwd, 'gradlew')
    writeFileSync(adb, '#!/bin/sh\n[ "$DSH_TEST_ADB_EXIT" = 0 ] || exit "$DSH_TEST_ADB_EXIT"\ncase "$*" in\n"shell getprop ro.build.version.sdk") printf "%s\\n" "$DSH_TEST_API";;\n"shell getconf PAGE_SIZE") printf "%s\\n" "$DSH_TEST_PAGES";;\n*) exit 2;;\nesac\n')
    writeFileSync(gradle, '#!/bin/sh\n[ "$*" = "--no-daemon -Pandroid.injected.androidTest.leaveApksInstalledAfterRun=true :app:connectedDebugAndroidTest" ] || exit 2\nprintf started > instrumentation-started\nexit "$DSH_TEST_GRADLE_EXIT"\n')
    for (const path of [adb, gradle]) chmodSync(path, 0o700)
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', launch.with!.script!], {
      cwd, encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, DSH_TEST_API: api, DSH_TEST_PAGES: pages,
        DSH_TEST_ADB_EXIT: String(adbExit), DSH_TEST_GRADLE_EXIT: String(gradleExit), DSH_TEST_EXPORT_EXIT: String(exportExit),
        DSH_SUPPORT_SOURCE_SHA: 'a'.repeat(40), RUNNER_TEMP: root },
    })
    expect(result.status === 0, result.stderr).toBe(accepted)
    const runtimeAccepted = api === '36' && pages === '16384' && adbExit === 0
    expect(existsSync(join(cwd, 'instrumentation-started'))).toBe(runtimeAccepted)
    expect(existsSync(join(cwd, 'system-export-started'))).toBe(runtimeAccepted && gradleExit === 0)
    const receipt = JSON.parse(readFileSync(join(cwd, 'app/build/outputs/android-runtime.json'), 'utf8')) as { status: string }
    expect(receipt.status).toBe(runtimeAccepted ? 'PASS' : 'FAIL')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

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
