/** Refuse generated application version drift before packaging or CI acceptance. */
import { resolve } from 'node:path'
import { readProductIdentity, staleProductIdentityFiles } from './release/product-files.ts'

const root = resolve(import.meta.dirname, '..')
const stale = staleProductIdentityFiles(root, readProductIdentity(root))
if (stale.length !== 0) {
  throw new Error(`product identity drift in ${stale.join(', ')}; run pnpm run gen-product-identity`)
}
console.log('verify-product-identity: three platform identity files match their source owners')
