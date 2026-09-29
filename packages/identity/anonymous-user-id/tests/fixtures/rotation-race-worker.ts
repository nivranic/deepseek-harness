import { existsSync, writeFileSync } from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'

const [home, seedByteText, role, readyPath, releasePath] = process.argv.slice(2)
if (home === undefined || seedByteText === undefined || role === undefined) {
  throw new Error('rotation race worker requires home, seed byte, and role')
}
if (role !== 'holder' && role !== 'contender') throw new Error(`invalid rotation race role: ${role}`)
if (role === 'holder' && (readyPath === undefined || releasePath === undefined)) {
  throw new Error('rotation race holder requires ready and release paths')
}

if (role === 'holder') {
  const fs = createRequire(import.meta.url)('node:fs') as typeof import('node:fs')
  const systemRenameSync = fs.renameSync
  const identityPath = join(home, '.anonymous-user-id')
  fs.renameSync = (...args: Parameters<typeof fs.renameSync>): void => {
    if (String(args[1]) === identityPath) {
      writeFileSync(readyPath as string, 'ready\n', { flag: 'wx' })
      const deadline = Date.now() + 10_000
      const waitCell = new Int32Array(new SharedArrayBuffer(4))
      while (!existsSync(releasePath as string)) {
        if (Date.now() >= deadline) throw new Error('rotation race release timed out')
        Atomics.wait(waitCell, 0, 0, 10)
      }
    }
    systemRenameSync(...args)
  }
  syncBuiltinESMExports()
}

const seedByte = Number(seedByteText)
if (!Number.isInteger(seedByte) || seedByte < 0 || seedByte > 255) {
  throw new Error(`invalid rotation race seed byte: ${seedByteText}`)
}
const { getOrCreateAnonymousIdentity } = await import('../../src/index.ts')
const identity = getOrCreateAnonymousIdentity({
  env: { DSH_HOME: home },
  randomBytes: () => Buffer.alloc(32, seedByte),
})
process.stdout.write(identity.userId)
