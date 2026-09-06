/** Verify producer claims against one receipt; unsigned evidence provides consistency, not authentication. */
import { isDeepStrictEqual } from 'node:util'
import { JsonValidator } from '@cyclonedx/cyclonedx-library/Validation'
import { Version } from '@cyclonedx/cyclonedx-library/Spec'
import { parseRcPath, type RcFile, type RcPlatformReceipt } from './rc-manifest.ts'

/** SLSA build definition for the repository's unsigned candidate producers. */
export const RC_BUILD_TYPE = 'urn:dsh:release-candidate:v1'

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('RC evidence requires an object')
  return value as Record<string, unknown>
}

/**
 * Map verified files to canonical in-toto subjects.
 * @param files - artifact or evidence file references.
 * @returns subjects ordered by portable path.
 */
export function rcSubjects(files: readonly RcFile[]): Array<{ name: string; digest: { sha256: string } }> {
  return files.map(file => ({ name: file.path, digest: { sha256: file.sha256 } }))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

function requireSubjects(input: unknown, files: readonly RcFile[]): void {
  if (!Array.isArray(input)) throw new Error('RC evidence subjects must be an array')
  const subjects = input.map((item: unknown) => {
    const value = record(item)
    return { ...value, name: parseRcPath(value.name) }
  }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  if (!isDeepStrictEqual(subjects, rcSubjects(files))) throw new Error('RC evidence subjects differ from the receipt')
}

/**
 * Require a PASS check to name this platform, source, complete identity and every deliverable.
 * @param input - JSON read from the checksum-verified check file.
 * @param name - policy-required check identifier.
 * @param receipt - validated platform receipt.
 */
export function verifyRcCheck(input: unknown, name: string, receipt: RcPlatformReceipt): void {
  const { subjects, ...claim } = record(input)
  const expected = {
    schemaVersion: 1, name, sourceSha: receipt.sourceSha, identity: receipt.identity,
    platform: receipt.platform, status: 'PASS',
  }
  if (!isDeepStrictEqual(claim, expected)) throw new Error(`RC check does not attest PASS for the expected candidate: ${name}`)
  requireSubjects(subjects, receipt.artifacts)
}

const sbomValidator = new JsonValidator(Version.v1dot6)

/**
 * Validate the complete CycloneDX 1.6 schema and the recorded scanner identity.
 * @param input - JSON read from the checksum-verified SBOM file.
 * @param receipt - validated receipt; provenance binds the SBOM bytes to its deliverables.
 */
export async function verifyRcSbom(input: unknown, receipt: RcPlatformReceipt): Promise<void> {
  const errors: unknown = await sbomValidator.validate(JSON.stringify(input))
  if (errors !== null) throw new Error('RC SBOM fails the CycloneDX 1.6 schema')
  const bom = record(input)
  if (bom.bomFormat !== 'CycloneDX' || bom.specVersion !== '1.6') throw new Error('RC SBOM must declare CycloneDX 1.6')
  const metadata = record(bom.metadata)
  const tools = metadata.tools
  const components = Array.isArray(tools) ? tools : record(tools).components
  if (!Array.isArray(components) || !components.some((item: unknown) => {
    const tool = record(item)
    return tool.name === receipt.sbom.tool.name && tool.version === receipt.sbom.tool.version
  })) throw new Error('RC SBOM scanner name or version differs from its receipt')
  if (!Array.isArray(bom.components) || bom.components.length === 0 || metadata.component === undefined) {
    throw new Error('RC SBOM must describe a scan target and a non-empty packaged inventory')
  }
}

/**
 * Check a portable in-toto/SLSA v1 statement without authenticating its builder claim.
 * @param input - checksum-verified provenance JSON.
 * @param receipt - validated platform receipt with builder and invocation identifiers.
 * @param sourceRepository - trusted Git repository URI selected independently of the receipt.
 */
export function verifyRcProvenance(input: unknown, receipt: RcPlatformReceipt, sourceRepository: string): void {
  const statement = record(input)
  if (statement._type !== 'https://in-toto.io/Statement/v1' || statement.predicateType !== 'https://slsa.dev/provenance/v1') {
    throw new Error('RC provenance must be an in-toto Statement v1 with SLSA provenance v1')
  }
  requireSubjects(statement.subject, [...receipt.artifacts, ...receipt.checks, receipt.sbom])
  const predicate = record(statement.predicate)
  const definition = record(predicate.buildDefinition)
  if (definition.buildType !== RC_BUILD_TYPE || !isDeepStrictEqual(definition.externalParameters, {
    sourceSha: receipt.sourceSha, identity: receipt.identity, platform: receipt.platform,
  })) throw new Error('RC provenance build parameters differ from the candidate')
  const sourceMaterial = [{ uri: sourceRepository, digest: { gitCommit: receipt.sourceSha } }]
  if (!isDeepStrictEqual(definition.resolvedDependencies, sourceMaterial)) {
    throw new Error('RC provenance source material differs from the expected repository and commit')
  }
  const details = record(predicate.runDetails)
  if (record(details.builder).id !== receipt.provenance.builderId
    || record(details.metadata).invocationId !== receipt.provenance.invocationId) {
    throw new Error('RC provenance builder or invocation differs from the receipt')
  }
}
