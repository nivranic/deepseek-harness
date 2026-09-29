import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { recordAndroidCandidate, verifyAndroidObservations } from './release/android-candidate-receipt.ts'
import { readProductIdentity } from './release/product-files.ts'
import { writeRcFixtureFile } from './release/rc-fixture.ts'
import { parseRcPolicy } from './release/rc-manifest.ts'
import { verifyRcPlatform } from './release/rc-artifacts.ts'
import { inspectWorkflowSecurity, readLocalActions } from './workflow-security.ts'

const repository = resolve(import.meta.dirname, '..')
const context = { sourceSha: 'a'.repeat(40), identity: readProductIdentity(repository), maxJsonBytes: 1024 * 1024,
  sourceRepository: 'git+https://example.invalid/source', builderId: 'urn:synthetic:builder', invocationId: 'urn:synthetic:invocation' }
const policy = parseRcPolicy(JSON.parse(readFileSync(join(repository, 'release/rc-policy.json'), 'utf8')) as unknown)
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-android-candidate-'))
  roots.push(root)
  const file = (name: string, value: string) => writeRcFixtureFile(root, `android/${name}`, value)
  const hashes = { bundle: file('app.aab', 'synthetic bundle').sha256, mapping: file('mapping.txt', 'synthetic mapping').sha256,
    apk: file('app.apk', 'synthetic apk').sha256, certificate: file('debug-certificate.der', 'synthetic public certificate').sha256 }
  const tool = { name: 'dsh-android-aab-inventory', version: '1' }
  const sbom = { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
    metadata: { component: { type: 'application', name: 'app.aab' }, tools: { components: [{ type: 'application', ...tool }] } },
    components: [{ type: 'library', name: 'synthetic-library' }] }
  const sbomFile = file('inventory/sbom.cdx.json', JSON.stringify(sbom))
  const inventory = { schemaVersion: 1, kind: 'android-aab-inventory', status: 'PASS', generator: tool,
    bundle: { sha256: hashes.bundle }, payload: { mappingSha256: hashes.mapping }, sbom: { sha256: sbomFile.sha256 } }
  const inventoryFile = file('inventory/inventory.json', JSON.stringify(inventory))
  const classpath = [{ name: 'bundletool-1.18.0.jar', sha256: 'b'.repeat(64) }]
  const evidence = [sbomFile, inventoryFile, file('bundletool-classpath.json', JSON.stringify(classpath)),
    file('manifest.xml', 'synthetic manifest'), file('startup.xml', 'synthetic hierarchy'), file('startup.png', 'synthetic screenshot'),
    file('installed-base.apk', 'synthetic apk')]
  const native = { path: 'lib/x86_64/libsample.so', sha256: 'c'.repeat(64), elfClass: 'ELF64', loadAlignments: [16384] }
  const observations = { schemaVersion: 1, status: 'PASS', sourceSha: context.sourceSha, identity: context.identity,
    bundleSha256: hashes.bundle, mappingSha256: hashes.mapping, certificateSha256: hashes.certificate,
    payload: { bundleSha256: hashes.bundle, apkSha256: hashes.apk, dex: { 'classes.dex': 'd'.repeat(64) }, native: { [native.path]: native.sha256 } },
    manifest: { package: 'com.deepseek.harness.companion', version: context.identity.version, buildNumber: context.identity.buildNumber,
      channel: context.identity.channel, minSdk: 33, targetSdk: 36, debuggable: false, testOnly: false,
      launcher: 'com.deepseek.harness.companion/ai.deepseek.dsh.companion.MainActivity' },
    native: [native], zipAlignment: { pageSizeBytes: 16384, status: 'PASS' },
    startup: { apkSha256: hashes.apk, installedApkSha256: hashes.apk, pairingScreenVisible: true,
      runtime: { apiLevel: 36, pageSizeBytes: 16384 }, cleanup: { processAbsent: true, packageAbsent: true } },
    tools: { buildToolsVersion: '35.0.0', sha256: Object.fromEntries(['java', 'keytool', 'aapt2', 'apksigner', 'zipalign', 'apkanalyzer', 'adb', 'readelf']
      .map(name => [name, 'e'.repeat(64)])) },
    evidenceSha256: Object.fromEntries(evidence.map(entry => [entry.path.slice('android/'.length), entry.sha256])) }
  const save = () => file('observations.json', JSON.stringify(observations))
  save()
  return { root, file, hashes, observations, inventory, sbom, classpath, save }
}

function change(input: object, path: string, value: unknown) {
  const keys = path.split('.')
  let record = input as Record<string, unknown>
  for (const key of keys.slice(0, -1)) record = record[key] as Record<string, unknown>
  record[keys.at(-1)!] = value
}

describe('Android candidate evidence', () => {
  it('assembles a byte-bound platform receipt and detects later deliverable changes', async () => {
    const { root, file } = fixture()
    const receipt = await recordAndroidCandidate(root, policy, context)
    expect(receipt.platform).toBe('android')
    expect(receipt.artifacts.map(value => [value.kind, value.signing])).toEqual([['bundle', 'unsigned'], ['application', 'debug'], ['mapping', 'unsigned']])
    expect(receipt.checks.map(value => value.name)).toEqual(['aab-inventory', 'identity', 'native-alignment', 'startup'])
    expect(await verifyRcPlatform(root, receipt, policy, context)).toEqual(receipt)
    expect(JSON.parse(readFileSync(join(root, 'android/receipt.json'), 'utf8'))).toEqual(receipt)
    file('app.apk', 'Synthetic apk')
    await expect(verifyRcPlatform(root, receipt, policy, context)).rejects.toThrow('checksum mismatch')
  })

  it.each<[string, unknown]>([
    ['schemaVersion', 2], ['status', 'FAIL'], ['sourceSha', 'b'.repeat(40)], ['identity', {}], ['bundleSha256', 'bad'], ['mappingSha256', 'bad'],
    ['certificateSha256', 'bad'], ['payload.apkSha256', 'bad'], ['startup.installedApkSha256', 'bad'], ['startup.pairingScreenVisible', false],
    ['startup.runtime.apiLevel', 35], ['startup.runtime.pageSizeBytes', 4096], ['startup.cleanup.processAbsent', false], ['startup.cleanup.packageAbsent', false],
    ['zipAlignment.status', 'FAIL'], ['manifest.package', 'another.app'], ['manifest.version', '0.0.0'], ['manifest.buildNumber', 0],
    ['manifest.channel', 'stable'], ['manifest.targetSdk', 35], ['manifest.minSdk', 32], ['manifest.debuggable', true], ['manifest.testOnly', true],
    ['manifest.launcher', 'bad launcher'], ['payload.dex', {}], ['payload.dex', { 'classes.dex': 'bad' }], ['native', null], ['native', []],
    ['native.0.elfClass', 'ELF32'], ['native.0.loadAlignments', [4096]], ['native.0.loadAlignments', [24576]], ['native.0.sha256', 'bad'],
    ['tools.sha256.adb', 'bad'], ['tools.buildToolsVersion', 'latest'],
  ])('rejects incomplete or contradictory %s', (path, value) => {
    const { observations, hashes } = fixture()
    change(observations, path, value)
    expect(() => { verifyAndroidObservations(observations, context, hashes) }).toThrow()
  })

  it('rejects a duplicated native library inspection', () => {
    const { observations, hashes } = fixture()
    observations.native.push(observations.native[0]!)
    expect(() => { verifyAndroidObservations(observations, context, hashes) }).toThrow('native identity')
  })

  it.each(['manifest.xml', 'startup.xml', 'startup.png', 'installed-base.apk', 'bundletool-classpath.json', 'inventory/inventory.json', 'inventory/sbom.cdx.json'])(
    'does not issue a receipt if retained %s changed after production', async (path) => {
      const { root, file } = fixture()
      file(path, 'modified evidence')
      await expect(recordAndroidCandidate(root, policy, context)).rejects.toThrow('evidence differs')
      expect(existsSync(join(root, 'android/receipt.json'))).toBe(false)
    })

  it.each(['missing', 'malformed', 'oversized'])('rejects %s subprocess JSON before producing a receipt', async (mode) => {
    const { root } = fixture(), path = join(root, 'android/observations.json')
    if (mode === 'missing') rmSync(path)
    else writeFileSync(path, mode === 'malformed' ? '{' : ' '.repeat(context.maxJsonBytes + 1))
    await expect(recordAndroidCandidate(root, policy, context)).rejects.toThrow()
    expect(existsSync(join(root, 'android/receipt.json'))).toBe(false)
  })

  it.each(['inventory', 'mapping', 'sbom-digest', 'classpath-empty', 'classpath-duplicate', 'classpath-version', 'sbom-schema', 'sbom-tool'])(
    'rejects inconsistent %s even when observation digests are refreshed', async (mode) => {
      const { root, file, observations, inventory, classpath, sbom, save } = fixture()
      if (mode === 'inventory') inventory.bundle.sha256 = 'b'.repeat(64)
      if (mode === 'mapping') inventory.payload.mappingSha256 = 'b'.repeat(64)
      if (mode === 'sbom-digest') inventory.sbom.sha256 = 'b'.repeat(64)
      if (mode === 'classpath-empty') classpath.length = 0
      if (mode === 'classpath-duplicate') classpath.push(classpath[0]!)
      if (mode === 'classpath-version') classpath[0]!.name = 'bundletool-0.0.0.jar'
      if (mode === 'sbom-schema') sbom.specVersion = 'invalid'
      if (mode === 'sbom-tool') sbom.metadata.tools.components[0]!.name = 'another scanner'
      const sbomFile = file('inventory/sbom.cdx.json', JSON.stringify(sbom))
      if (mode.startsWith('sbom-') && mode !== 'sbom-digest') inventory.sbom.sha256 = sbomFile.sha256
      for (const entry of [sbomFile, file('inventory/inventory.json', JSON.stringify(inventory)), file('bundletool-classpath.json', JSON.stringify(classpath))]) {
        observations.evidenceSha256[entry.path.slice('android/'.length)] = entry.sha256
      }
      save()
      await expect(recordAndroidCandidate(root, policy, context)).rejects.toThrow()
      expect(existsSync(join(root, 'android/receipt.json'))).toBe(false)
    })
})

describe('Android candidate entry', () => {
  it('keeps every actual workflow action revision in the upstream pin registry', () => {
    const path = join(repository, '.github/workflows')
    const files = new Map(readdirSync(path).filter(name => /\.ya?ml$/.test(name)).map(name => [name, readFileSync(join(path, name), 'utf8')]))
    const pins: unknown = JSON.parse(readFileSync(join(repository, 'release/action-pins.json'), 'utf8'))
    const permissions: unknown = JSON.parse(readFileSync(join(repository, 'release/workflow-security.json'), 'utf8'))
    expect(inspectWorkflowSecurity(files, pins, permissions, readLocalActions(repository))).toEqual([])
  })
  it('loads with the supported source launcher and rejects a persistent host before output or device access', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-android-entry-'))
    roots.push(root)
    const output = join(root, 'must-not-be-created')
    await expect(promisify(execFile)(process.execPath, ['--import', 'tsx/esm', 'scripts/produce-android-candidate.ts', '--output', output],
      { cwd: repository, env: { ...process.env, GITHUB_ACTIONS: 'false' }, windowsHide: true })).rejects.toMatchObject({ code: 1,
      stderr: expect.stringContaining('requires disposable GitHub-hosted Linux') as unknown })
    expect(existsSync(output)).toBe(false)
  }, 30_000)

  it('checks out the immutable candidate and only uploads after hosted 16 KiB release acceptance', () => {
    const workflow = load(readFileSync(join(repository, '.github/workflows/android-candidate.yml'), 'utf8')) as {
      permissions: Record<string, string>
      jobs: { android: {
        'runs-on': string
        env: Record<string, string>
        steps: Array<{ name?: string; uses?: string; run?: string; if?: string; with?: Record<string, unknown> }>
      } }
    }
    const job = workflow.jobs.android
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(job['runs-on']).toBe('ubuntu-24.04')
    expect(job.env.DSH_RC_SOURCE_SHA).toBe('${{ inputs.source_sha || github.event.pull_request.head.sha || github.sha }}')
    expect(job.env.DSH_ANDROID_SIGNING_MODE).toBe('unsigned')
    const checkout = job.steps.find(step => step.uses?.startsWith('actions/checkout@'))!
    expect(checkout.with).toEqual({ ref: '${{ env.DSH_RC_SOURCE_SHA }}', 'persist-credentials': false })
    const emulator = job.steps.find(step => step.uses?.startsWith('reactivecircus/'))!
    expect(emulator.uses).toBe('reactivecircus/android-emulator-runner@a421e43855164a8197daf9d8d40fe71c6996bb0d')
    expect(emulator.with).toMatchObject({ 'api-level': 36, target: 'google_apis_ps16k', arch: 'x86_64',
      script: 'node --import tsx/esm scripts/produce-android-candidate.ts --output "$RUNNER_TEMP/android-rc"' })
    const upload = job.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'))!
    expect(job.steps.indexOf(upload)).toBeGreaterThan(job.steps.indexOf(emulator))
    expect(upload.if).toBeUndefined()
    expect(upload.with?.path).toBe('${{ runner.temp }}/android-rc/')
  })
})
