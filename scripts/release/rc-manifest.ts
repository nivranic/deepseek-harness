/** Portable release-candidate metadata; artifact integrity is separate from release authorization. */
import { assertBuildAdvances, parseProductIdentity, type ProductIdentity } from './product-identity.ts'

/** Platforms that must be represented in a complete application candidate. */
const RC_PLATFORMS = ['windows', 'macos', 'ios', 'android'] as const
/** A native application distribution platform. */
type RcPlatform = typeof RC_PLATFORMS[number]
/** Full host runtime or companion application, which may provide native Lite features. */
type RuntimeClass = 'full' | 'companion'
/** A deliverable's packaging purpose. */
type ArtifactKind = 'installer' | 'portable' | 'archive' | 'bundle' | 'mapping' | 'application'

/** A regular file beneath the artifact root, identified by its complete bytes. */
export interface RcFile {
  path: string
  bytes: number
  sha256: string
}

/** One produced application, installer, archive or associated release file. */
interface RcArtifact extends RcFile {
  kind: ArtifactKind
  runtimeClass: RuntimeClass
  signing: 'unsigned' | 'debug'
}

/** A producer check; its referenced JSON must bind PASS to the same subjects and source. */
interface RcCheck extends RcFile {
  name: string
}

/** The scanner and standard used to describe the actual packaged closure. */
interface RcSbom extends RcFile {
  format: 'cyclonedx-1.6'
  tool: { name: string; version: string }
}

/** An unsigned SLSA provenance statement, with no authenticated-attestation claim. */
interface RcProvenance extends RcFile {
  builderId: string
  invocationId: string
}

/** One platform's outputs and evidence produced from an immutable source commit. */
export interface RcPlatformReceipt {
  schemaVersion: 1
  sourceSha: string
  identity: ProductIdentity
  platform: RcPlatform
  artifacts: RcArtifact[]
  checks: RcCheck[]
  sbom: RcSbom
  provenance: RcProvenance
}

/** A complete application candidate; verification does not authorize publication. */
export interface RcManifest {
  schemaVersion: 1
  sourceSha: string
  identity: ProductIdentity
  platforms: RcPlatformReceipt[]
}

/** Required platform artifacts and named producer checks. */
export interface RcPolicy {
  schemaVersion: 1
  requiredChecks: string[]
  platforms: Array<{ platform: RcPlatform; artifacts: Array<{ kind: ArtifactKind; runtimeClass: RuntimeClass }> }>
}

function object(input: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error(`${label} must be an object`)
  const value = input as Record<string, unknown>
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) throw new Error(`${label} has missing or unknown fields`)
  return value
}

function text(input: unknown, label: string): string {
  if (typeof input !== 'string' || input.length === 0 || /[\u0000-\u001f\u007f]/.test(input)) throw new Error(`${label} must be non-empty text without control characters`)
  return input
}

function list<T>(input: unknown, parse: (item: unknown) => T, label: string): T[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error(`${label} must be a non-empty array`)
  return input.map(parse)
}

function choice<T extends string>(input: unknown, choices: readonly T[], label: string): T {
  if (typeof input !== 'string' || !choices.includes(input as T)) throw new Error(`unsupported ${label}`)
  return input as T
}

function sourceSha(input: unknown): string {
  if (typeof input !== 'string' || input.length !== 40 || !/^[a-f0-9]{40}$/.test(input)) throw new Error('RC source must be a full Git SHA')
  return input
}

function identity(input: unknown): ProductIdentity {
  const value = object(input, ['schemaVersion', 'version', 'marketingVersion', 'buildNumber', 'channel', 'windowsFileVersion', 'appleBuildVersion'], 'RC identity')
  const result = parseProductIdentity({ version: value.version }, {
    schemaVersion: value.schemaVersion, buildNumber: value.buildNumber, channel: value.channel,
  })
  if (Object.entries(result).some(([key, expected]) => value[key] !== expected)) throw new Error('RC derived platform identity differs from its source fields')
  return result
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`duplicate ${label}`)
}

function platform(input: unknown): RcPlatform { return choice(input, RC_PLATFORMS, 'RC platform') }
function kind(input: unknown): ArtifactKind {
  return choice(input, ['installer', 'portable', 'archive', 'bundle', 'mapping', 'application'], 'artifact kind')
}
function runtimeClass(input: unknown): RuntimeClass { return choice(input, ['full', 'companion'], 'runtime class') }
function checkName(input: unknown): string {
  const result = text(input, 'check name')
  if (!/^[a-z][a-z0-9-]*$/.test(result)) throw new Error('check name must be a lowercase identifier')
  return result
}

/**
 * Reject absolute, escaping and non-portable file references before filesystem access.
 * @param input - JSON path using forward slashes relative to the artifact root.
 * @returns the unchanged canonical path.
 */
export function parseRcPath(input: unknown): string {
  const result = text(input, 'artifact path')
  if (/[\\<>:"|?*]|[^\x20-\x7e]/.test(result) || result.split('/').some(part =>
    part === '' || part === '.' || part === '..' || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?: *\.|$)/i.test(part))) {
    throw new Error('artifact path must be portable, relative and non-escaping')
  }
  return result
}

function file(input: Record<string, unknown>): RcFile {
  if (typeof input.bytes !== 'number' || !Number.isSafeInteger(input.bytes) || input.bytes <= 0) throw new Error('artifact byte size must be a positive integer')
  if (typeof input.sha256 !== 'string' || input.sha256.length !== 64 || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error('artifact digest must be SHA-256')
  return { path: parseRcPath(input.path), bytes: input.bytes, sha256: input.sha256 }
}

/**
 * Parse the complete platform policy without allowing a narrowed platform set.
 * @param input - parsed release/rc-policy.json.
 * @returns validated requirements for all supported platforms.
 */
export function parseRcPolicy(input: unknown): RcPolicy {
  const value = object(input, ['schemaVersion', 'requiredChecks', 'platforms'], 'RC policy')
  if (value.schemaVersion !== 1) throw new Error('unsupported RC policy schema')
  const requiredChecks = list(value.requiredChecks, checkName, 'required checks')
  unique(requiredChecks, 'required check')
  const platforms = list(value.platforms, (item) => {
    const row = object(item, ['platform', 'artifacts'], 'platform policy')
    const artifacts = list(row.artifacts, (artifact) => {
      const required = object(artifact, ['kind', 'runtimeClass'], 'required artifact')
      return { kind: kind(required.kind), runtimeClass: runtimeClass(required.runtimeClass) }
    }, 'required artifacts')
    unique(artifacts.map(entry => `${entry.kind}/${entry.runtimeClass}`), 'required artifact')
    return { platform: platform(row.platform), artifacts }
  }, 'platform policy')
  unique(platforms.map(row => row.platform), 'policy platform')
  if (platforms.length !== RC_PLATFORMS.length) throw new Error('RC policy must require all four platforms')
  return { schemaVersion: 1, requiredChecks, platforms }
}

/**
 * Parse one producer's receipt and require its platform's artifacts and checks.
 * @param input - platform receipt JSON.
 * @param policy - validated complete-platform policy.
 * @returns canonical producer metadata; no file contents are trusted by this parser.
 */
export function parseRcPlatformReceipt(input: unknown, policy: RcPolicy): RcPlatformReceipt {
  const row = object(input, ['schemaVersion', 'sourceSha', 'identity', 'platform', 'artifacts', 'checks', 'sbom', 'provenance'], 'platform receipt')
  if (row.schemaVersion !== 1) throw new Error('unsupported RC receipt schema')
  const artifacts = list(row.artifacts, (item) => {
    const artifact = object(item, ['path', 'bytes', 'sha256', 'kind', 'runtimeClass', 'signing'], 'artifact')
    return { ...file(artifact), kind: kind(artifact.kind), runtimeClass: runtimeClass(artifact.runtimeClass), signing: choice(artifact.signing, ['unsigned', 'debug'], 'candidate signing class') }
  }, 'artifacts')
  const checks = list(row.checks, (item) => {
    const check = object(item, ['name', 'path', 'bytes', 'sha256'], 'producer check')
    return { ...file(check), name: checkName(check.name) }
  }, 'checks')
  unique(checks.map(check => check.name), 'producer check')
  const sbom = object(row.sbom, ['path', 'bytes', 'sha256', 'format', 'tool'], 'SBOM reference')
  const tool = object(sbom.tool, ['name', 'version'], 'SBOM tool')
  const provenance = object(row.provenance, ['path', 'bytes', 'sha256', 'builderId', 'invocationId'], 'provenance reference')
  const result: RcPlatformReceipt = {
    schemaVersion: 1, sourceSha: sourceSha(row.sourceSha), identity: identity(row.identity),
    platform: platform(row.platform), artifacts, checks,
    sbom: {
      ...file(sbom), format: choice(sbom.format, ['cyclonedx-1.6'], 'SBOM format'),
      tool: { name: text(tool.name, 'scanner name'), version: text(tool.version, 'scanner version') },
    },
    provenance: { ...file(provenance), builderId: text(provenance.builderId, 'builder id'), invocationId: text(provenance.invocationId, 'invocation id') },
  }
  const required = policy.platforms.find(item => item.platform === result.platform)
  if (required === undefined) throw new Error('RC policy has no requirements for this platform')
  for (const artifact of required.artifacts) {
    if (!artifacts.some(item => item.kind === artifact.kind && item.runtimeClass === artifact.runtimeClass)) throw new Error(`${result.platform} required artifact missing: ${artifact.kind}/${artifact.runtimeClass}`)
  }
  for (const name of policy.requiredChecks) if (!checks.some(check => check.name === name)) throw new Error(`${result.platform} required check missing: ${name}`)
  const files = [...artifacts, ...checks, result.sbom, result.provenance]
  unique(files.map(item => item.path.toLowerCase()), 'artifact/evidence path')
  if (files.some(item => !item.path.startsWith(`${result.platform}/`))) throw new Error('platform files must stay in their platform namespace')
  result.artifacts.sort((a, b) => a.path.localeCompare(b.path, 'en'))
  result.checks.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  return result
}

/**
 * Parse a complete candidate and reject missing platforms or mixed source identities.
 * @param input - candidate manifest JSON.
 * @param policy - validated platform and evidence requirements.
 * @returns canonical candidate metadata with one receipt per platform.
 */
export function parseRcManifest(input: unknown, policy: RcPolicy): RcManifest {
  const row = object(input, ['schemaVersion', 'sourceSha', 'identity', 'platforms'], 'RC manifest')
  if (row.schemaVersion !== 1) throw new Error('unsupported RC manifest schema')
  const source = sourceSha(row.sourceSha), product = identity(row.identity)
  const platforms = list(row.platforms, item => parseRcPlatformReceipt(item, policy), 'platform receipts')
  unique(platforms.map(item => item.platform), 'platform receipt')
  if (platforms.length !== RC_PLATFORMS.length) throw new Error('complete RC requires all four platforms')
  for (const receipt of platforms) {
    if (receipt.sourceSha !== source || JSON.stringify(receipt.identity) !== JSON.stringify(product)) throw new Error('RC platforms have mixed source or application identities')
  }
  platforms.sort((a, b) => RC_PLATFORMS.indexOf(a.platform) - RC_PLATFORMS.indexOf(b.platform))
  return { schemaVersion: 1, sourceSha: source, identity: product, platforms }
}

/**
 * Admit retries with unchanged source, identity and deliverables, or an increased build number.
 * @param previous - canonical retained distribution manifest.
 * @param next - canonical proposed distribution manifest.
 * @returns whether this is an unchanged retry or a new candidate.
 */
export function classifyRcAdvance(previous: RcManifest, next: RcManifest): 'retry' | 'new' {
  const deliverables = (manifest: RcManifest) => ({
    sourceSha: manifest.sourceSha, identity: manifest.identity,
    platforms: manifest.platforms.map(receipt => ({ platform: receipt.platform, artifacts: receipt.artifacts })),
  })
  if (JSON.stringify(deliverables(previous)) === JSON.stringify(deliverables(next))) return 'retry'
  assertBuildAdvances(previous.identity, next.identity)
  return 'new'
}
