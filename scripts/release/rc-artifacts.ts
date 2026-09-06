/** Verify a complete RC or one platform's bytes and claims against independent source expectations. */
import { isDeepStrictEqual } from 'node:util'
import type { ProductIdentity } from './product-identity.ts'
import { verifyRcCheck, verifyRcProvenance, verifyRcSbom } from './rc-evidence.ts'
import { RcFileReader } from './rc-files.ts'
import { parseRcManifest, parseRcPlatformReceipt, type RcManifest, type RcPlatformReceipt, type RcPolicy } from './rc-manifest.ts'

/** Caller-selected inputs that candidate JSON cannot override. */
export interface RcExpectation {
  sourceSha: string
  sourceRepository: string
  identity: ProductIdentity
  maxJsonBytes: number
}

async function verifyReceipt(reader: RcFileReader, receipt: RcPlatformReceipt, expected: RcExpectation): Promise<void> {
  if (receipt.sourceSha !== expected.sourceSha || !isDeepStrictEqual(receipt.identity, expected.identity)) {
    throw new Error('RC source or identity differs from the independently expected candidate')
  }
  if (expected.sourceRepository.trim().length === 0) throw new Error('RC expected source repository is required')
  for (const artifact of receipt.artifacts) await reader.read(artifact)
  for (const attachment of receipt.attachments) await reader.read(attachment)
  for (const check of receipt.checks) verifyRcCheck(await reader.read(check, true), check.name, receipt)
  await verifyRcSbom(await reader.read(receipt.sbom, true), receipt)
  verifyRcProvenance(await reader.read(receipt.provenance, true), receipt, expected.sourceRepository)
}

/**
 * Verify one producer without representing it as a complete four-platform candidate.
 * @param root - exclusive, immutable artifact root through verification and later use.
 * @param input - untrusted platform receipt JSON.
 * @param policy - parsed required platform/check policy.
 * @param expected - independently selected source and product identity.
 * @returns the canonical receipt after every referenced file and claim passes.
 */
export async function verifyRcPlatform(
  root: string, input: unknown, policy: RcPolicy, expected: RcExpectation,
): Promise<RcPlatformReceipt> {
  const receipt = parseRcPlatformReceipt(input, policy)
  const reader = await RcFileReader.create(root, expected.maxJsonBytes)
  await verifyReceipt(reader, receipt, expected)
  await reader.assertUnchanged()
  return receipt
}

/**
 * Verify all four platforms, file contents and evidence before accepting candidate integrity.
 * @param root - exclusive, immutable artifact root through verification and later use.
 * @param input - untrusted complete candidate JSON.
 * @param policy - parsed complete-platform policy.
 * @param expected - independently selected source and product identity.
 * @returns canonical metadata; this does not grant publication or authenticate unsigned provenance.
 */
export async function verifyRcArtifacts(root: string, input: unknown, policy: RcPolicy, expected: RcExpectation): Promise<RcManifest> {
  const manifest = parseRcManifest(input, policy)
  const reader = await RcFileReader.create(root, expected.maxJsonBytes)
  for (const receipt of manifest.platforms) await verifyReceipt(reader, receipt, expected)
  await reader.assertUnchanged()
  return manifest
}
