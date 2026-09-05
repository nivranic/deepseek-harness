/** Generate application version inputs from package.json and release/product.json. */
import { resolve } from 'node:path'
import { readProductIdentity, writeProductIdentity } from './release/product-files.ts'

const root = resolve(import.meta.dirname, '..')
writeProductIdentity(root, readProductIdentity(root))
console.log('gen-product-identity: wrote three platform identity files')
