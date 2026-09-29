/** Read and verify committed product-version projections; only the explicit generator writes them. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseProductIdentity, renderProductIdentity, type ProductIdentity } from './product-identity.ts'

/**
 * Read the two application identity owners from one checkout.
 * @param root - absolute repository root.
 * @returns A validated application identity; missing, malformed, and inconsistent input fails loudly.
 */
export function readProductIdentity(root: string): ProductIdentity {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const metadata: unknown = JSON.parse(readFileSync(join(root, 'release/product.json'), 'utf8'))
  return parseProductIdentity(manifest, metadata)
}

/**
 * Write all platform representations after input validation completes.
 * @param root - absolute repository root.
 * @param identity - the validated application identity.
 */
export function writeProductIdentity(root: string, identity: ProductIdentity): void {
  const outputs = renderProductIdentity(identity)
  for (const [relative, value] of Object.entries(outputs)) {
    const path = join(root, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, value)
  }
}

/**
 * Find missing or stale generated platform-version inputs without repairing them.
 * @param root - absolute repository root.
 * @param identity - the validated application identity expected by this build.
 * @returns Repository-relative stale output names; filesystem access errors remain thrown.
 */
export function staleProductIdentityFiles(root: string, identity: ProductIdentity): string[] {
  return Object.entries(renderProductIdentity(identity)).filter(([relative, value]) => {
    const path = join(root, relative)
    return !existsSync(path) || readFileSync(path, 'utf8') !== value
  }).map(([relative]) => relative)
}
