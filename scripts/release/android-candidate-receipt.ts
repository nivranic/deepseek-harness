/** Bind Android producer observations and retained artifact bytes into the shared RC receipt. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { verifyRcPlatform, type RcExpectation } from './rc-artifacts.ts'
import { RC_BUILD_TYPE, rcSubjects } from './rc-evidence.ts'
import { type RcPlatformReceipt, type RcPolicy } from './rc-manifest.ts'
import { describeRcOutput, writeRcOutput } from './rc-output.ts'

/** Independently selected source, product identity and hosted workflow invocation. */
export interface AndroidCandidateContext extends RcExpectation {
  builderId: string
  invocationId: string
}

function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function record(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'Android observation requires an object')
  return value as Record<string, unknown>
}

function digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

/**
 * Require the subprocess report to describe these bytes and completed release-device checks.
 * @param input - bounded producer JSON read after the process succeeds.
 * @param expected - independent source and product identity.
 * @param hashes - hashes of the retained bundle, mapping, APK and public certificate.
 */
export function verifyAndroidObservations(
  input: unknown, expected: AndroidCandidateContext,
  hashes: { bundle: string; mapping: string; apk: string; certificate: string },
): void {
  const value = record(input), payload = record(value.payload), startup = record(value.startup), manifest = record(value.manifest)
  requireValue(value.schemaVersion === 1 && value.status === 'PASS' && value.sourceSha === expected.sourceSha
    && isDeepStrictEqual(value.identity, expected.identity), 'Android observations differ from the candidate')
  requireValue(value.bundleSha256 === hashes.bundle && value.mappingSha256 === hashes.mapping
    && value.certificateSha256 === hashes.certificate && payload.bundleSha256 === hashes.bundle
    && payload.apkSha256 === hashes.apk && startup.apkSha256 === hashes.apk && startup.installedApkSha256 === hashes.apk,
  'Android observations differ from retained artifact bytes')
  requireValue(startup.pairingScreenVisible === true
    && isDeepStrictEqual(startup.runtime, { apiLevel: 36, pageSizeBytes: 16384 })
    && isDeepStrictEqual(startup.cleanup, { processAbsent: true, packageAbsent: true })
    && isDeepStrictEqual(value.zipAlignment, { pageSizeBytes: 16384, status: 'PASS' }), 'Android device or alignment checks are incomplete')
  requireValue(manifest.package === 'com.deepseek.harness.companion' && manifest.version === expected.identity.version
    && manifest.buildNumber === expected.identity.buildNumber && manifest.channel === expected.identity.channel
    && manifest.minSdk === 33 && manifest.targetSdk === 36 && manifest.debuggable === false && manifest.testOnly === false
    && typeof manifest.launcher === 'string'
    && /^com\.deepseek\.harness\.companion\/[A-Za-z_$][A-Za-z0-9_.$]*$/.test(manifest.launcher),
  'Android release manifest differs from the candidate')
  const dex = record(payload.dex), native = record(payload.native)
  requireValue(Object.keys(dex).length > 0
    && Object.entries(dex).every(([name, hash]) => /^classes[0-9]*\.dex$/.test(name) && digest(hash)),
  'Android DEX identity is incomplete')
  requireValue(Array.isArray(value.native), 'Android native inspection is missing')
  const inspected = new Set<string>()
  for (const item of value.native) {
    const library = record(item)
    requireValue(typeof library.path === 'string' && /^lib\/(arm64-v8a|x86_64|armeabi-v7a|x86)\/[^/]+\.so$/.test(library.path)
      && digest(library.sha256) && native[library.path] === library.sha256 && !inspected.has(library.path), 'Android native identity differs')
    inspected.add(library.path)
    const is64 = /\/(arm64-v8a|x86_64)\//.test(library.path)
    requireValue(library.elfClass === (is64 ? 'ELF64' : 'ELF32') && Array.isArray(library.loadAlignments)
      && library.loadAlignments.length > 0 && library.loadAlignments.every((alignment: unknown) => typeof alignment === 'number'
        && Number.isSafeInteger(alignment) && alignment > 0 && Number.isInteger(Math.log2(alignment)) && (!is64 || alignment >= 16384)),
    'Android ELF alignment is incomplete')
  }
  requireValue(inspected.size === Object.keys(native).length, 'Android native inspection omitted a library')
  const tools = record(value.tools), toolHashes = record(tools.sha256)
  requireValue(typeof tools.buildToolsVersion === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(tools.buildToolsVersion)
    && ['java', 'keytool', 'aapt2', 'apksigner', 'zipalign', 'apkanalyzer', 'adb', 'readelf'].every(name => digest(toolHashes[name])),
  'Android producer tool identities are incomplete')
}

async function readJson(root: string, path: string, limit: number): Promise<unknown> {
  const file = await describeRcOutput(root, path)
  requireValue(file.bytes > 0 && file.bytes <= limit, 'Android evidence exceeds its JSON limit')
  const text = await readFile(join(root, path), 'utf8')
  try { return JSON.parse(text) as unknown }
  catch { throw new Error('Android evidence is not valid JSON') }
}

/**
 * Generate and independently verify the complete Android platform receipt after actual production.
 * @param root - exclusive completed producer output root.
 * @param policy - platform artifacts and required checks.
 * @param context - caller-selected source, product and workflow invocation.
 * @returns the verified platform receipt; does not authenticate or publish it.
 */
export async function recordAndroidCandidate(
  root: string, policy: RcPolicy, context: AndroidCandidateContext,
): Promise<RcPlatformReceipt> {
  const bundle = await describeRcOutput(root, 'android/app.aab'), mapping = await describeRcOutput(root, 'android/mapping.txt')
  const apk = await describeRcOutput(root, 'android/app.apk'), certificate = await describeRcOutput(root, 'android/debug-certificate.der')
  const observations = await readJson(root, 'android/observations.json', context.maxJsonBytes)
  verifyAndroidObservations(observations, context, {
    bundle: bundle.sha256, mapping: mapping.sha256, apk: apk.sha256, certificate: certificate.sha256,
  })
  const evidencePaths = ['manifest.xml', 'startup.xml', 'startup.png', 'installed-base.apk', 'bundletool-classpath.json',
    'inventory/inventory.json', 'inventory/sbom.cdx.json']
  const evidence = await Promise.all(evidencePaths.map(path => describeRcOutput(root, `android/${path}`)))
  requireValue(isDeepStrictEqual(record(observations).evidenceSha256,
    Object.fromEntries(evidence.map((file, index) => [evidencePaths[index], file.sha256]))), 'Android retained evidence differs from production')
  const inventory = record(await readJson(root, 'android/inventory/inventory.json', context.maxJsonBytes))
  const generator = record(inventory.generator)
  requireValue(inventory.status === 'PASS' && inventory.kind === 'android-aab-inventory'
    && record(inventory.bundle).sha256 === bundle.sha256 && record(inventory.payload).mappingSha256 === mapping.sha256
    && typeof generator.name === 'string' && generator.name.length > 0 && typeof generator.version === 'string' && generator.version.length > 0,
  'Android inventory does not cover the retained bundle and mapping')
  const sbomFile = await describeRcOutput(root, 'android/inventory/sbom.cdx.json')
  requireValue(record(inventory.sbom).sha256 === sbomFile.sha256, 'Android inventory SBOM digest differs')
  const classpath = await readJson(root, 'android/bundletool-classpath.json', context.maxJsonBytes)
  const names = new Set<string>()
  requireValue(Array.isArray(classpath) && classpath.length > 0 && classpath.every((item: unknown) => {
    const entry = record(item)
    if (typeof entry.name !== 'string' || !/^[A-Za-z0-9_.+-]+\.jar$/.test(entry.name) || !digest(entry.sha256) || names.has(entry.name)) return false
    names.add(entry.name)
    return true
  }), 'Android bundletool classpath identities are incomplete')
  requireValue(names.has('bundletool-1.18.0.jar'), 'Android candidate requires the pinned bundletool')
  const artifacts: RcPlatformReceipt['artifacts'] = [
    { ...bundle, kind: 'bundle', runtimeClass: 'companion', signing: 'unsigned' },
    { ...mapping, kind: 'mapping', runtimeClass: 'companion', signing: 'unsigned' },
    { ...apk, kind: 'application', runtimeClass: 'companion', signing: 'debug' },
  ]
  const checks: RcPlatformReceipt['checks'] = []
  for (const name of ['identity', 'startup', 'native-alignment', 'aab-inventory']) {
    checks.push({ ...await writeRcOutput(root, `android/${name}.json`, {
      schemaVersion: 1, name, sourceSha: context.sourceSha, identity: context.identity, platform: 'android', status: 'PASS', subjects: rcSubjects(artifacts),
    }), name })
  }
  const attachments = [certificate]
  for (const path of ['observations.json', 'manifest.xml', 'startup.xml', 'startup.png', 'installed-base.apk', 'bundletool-classpath.json', 'inventory/inventory.json']) {
    attachments.push(await describeRcOutput(root, `android/${path}`))
  }
  requireValue(attachments.find(file => file.path === 'android/installed-base.apk')?.sha256 === apk.sha256, 'Retained installed APK differs')
  const sbom = { ...sbomFile, format: 'cyclonedx-1.6' as const, tool: { name: generator.name, version: generator.version } }
  const provenance = await writeRcOutput(root, 'android/provenance.json', {
    _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1', subject: rcSubjects([...artifacts, ...checks, ...attachments, sbom]),
    predicate: {
      buildDefinition: { buildType: RC_BUILD_TYPE, externalParameters: { sourceSha: context.sourceSha, identity: context.identity, platform: 'android' },
        resolvedDependencies: [{ uri: context.sourceRepository, digest: { gitCommit: context.sourceSha } }] },
      runDetails: { builder: { id: context.builderId }, metadata: { invocationId: context.invocationId } },
    },
  })
  const receipt: RcPlatformReceipt = { schemaVersion: 1, sourceSha: context.sourceSha, identity: context.identity, platform: 'android',
    artifacts, checks, attachments, sbom, provenance: { ...provenance, builderId: context.builderId, invocationId: context.invocationId } }
  const verified = await verifyRcPlatform(root, receipt, policy, context)
  await writeRcOutput(root, 'android/receipt.json', verified)
  return verified
}
