/** Synthetic packaging data for verifier regressions; these bytes are never application RC evidence. */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ProductIdentity } from './product-identity.ts'
import { RC_BUILD_TYPE, rcSubjects } from './rc-evidence.ts'
import type { RcFile, RcManifest, RcPlatformReceipt, RcPolicy } from './rc-manifest.ts'

/**
 * Write a synthetic regular file and describe its exact bytes.
 * @param root - test-owned temporary directory.
 * @param path - fixture-relative filename.
 * @param content - complete UTF-8 test data.
 * @returns a reference to the newly written bytes.
 */
export function writeRcFixtureFile(root: string, path: string, content: string): RcFile {
  const target = join(root, path)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
  return { path, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }
}

/**
 * Build complete synthetic receipts to exercise acceptance and rejection without platform toolchains.
 * @param root - test-owned temporary directory.
 * @param policy - parsed repository policy.
 * @param identity - validated synthetic product identity.
 * @param sourceSha - full synthetic source commit.
 * @param sourceRepository - synthetic repository URI.
 * @returns a complete, self-consistent fixture that does not represent real platform builds.
 */
export function writeRcFixture(
  root: string, policy: RcPolicy, identity: ProductIdentity, sourceSha: string, sourceRepository: string,
): RcManifest {
  const platforms = policy.platforms.map(({ platform, artifacts: required }): RcPlatformReceipt => {
    const artifacts = required.map((artifact, index) => ({
      ...writeRcFixtureFile(root, `${platform}/application-${index}.bin`, `synthetic ${platform} ${index}`),
      ...artifact, signing: 'unsigned' as const,
    }))
    const checks = policy.requiredChecks.map(name => ({
      ...writeRcFixtureFile(root, `${platform}/${name}.json`, JSON.stringify({
        schemaVersion: 1, name, sourceSha, identity, platform, status: 'PASS', subjects: rcSubjects(artifacts),
      })), name,
    }))
    const tool = { name: 'synthetic-scanner', version: '1.0.0' }
    const sbom = {
      ...writeRcFixtureFile(root, `${platform}/sbom.cdx.json`, JSON.stringify({
        bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
        metadata: {
          tools: { components: [{ type: 'application', ...tool }] },
          component: { type: 'application', name: `synthetic-${platform}`, version: identity.version },
        },
        components: [{ type: 'library', name: 'synthetic-dependency', version: '1.0.0' }],
      })), format: 'cyclonedx-1.6' as const, tool,
    }
    const builderId = 'urn:dsh:synthetic-builder', invocationId = 'urn:dsh:synthetic-run:1'
    const provenance = {
      ...writeRcFixtureFile(root, `${platform}/provenance.json`, JSON.stringify({
        _type: 'https://in-toto.io/Statement/v1', predicateType: 'https://slsa.dev/provenance/v1',
        subject: rcSubjects([...artifacts, ...checks, sbom]),
        predicate: {
          buildDefinition: {
            buildType: RC_BUILD_TYPE, externalParameters: { sourceSha, identity, platform },
            resolvedDependencies: [{ uri: sourceRepository, digest: { gitCommit: sourceSha } }],
          },
          runDetails: { builder: { id: builderId }, metadata: { invocationId } },
        },
      })), builderId, invocationId,
    }
    return { schemaVersion: 1, sourceSha, identity, platform, artifacts, checks, sbom, provenance }
  })
  return { schemaVersion: 1, sourceSha, identity, platforms }
}
