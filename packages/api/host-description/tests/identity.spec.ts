import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { loadHostId } from '../src/identity.ts'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function identityFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-host-identity-'))
  directories.push(directory)
  return join(directory, 'home', '.host-id')
}

it('persists one identity across concurrent first loads and subsequent launches', async () => {
  const path = await identityFile()
  const identities = await Promise.all(Array.from({ length: 8 }, () => loadHostId(path, 2000)))
  expect(new Set(identities).size).toBe(1)
  expect(await readFile(path, 'utf8')).toBe(`${identities[0]}\n`)
  expect(await loadHostId(path, 2000)).toBe(identities[0])
})

it('keeps distinct Harness homes independent', async () => {
  expect(await loadHostId(await identityFile(), 2000)).not.toBe(await loadHostId(await identityFile(), 2000))
})

it('refuses a malformed persisted identity without replacing its bytes', async () => {
  const path = await identityFile()
  await loadHostId(path, 2000)
  const corrupt = 'unrecoverable identity\n'
  await writeFile(path, corrupt)
  await expect(loadHostId(path, 2000)).rejects.toThrow(/restore the saved identity/u)
  expect(await readFile(path, 'utf8')).toBe(corrupt)
})

it('propagates an unreadable identity instead of generating a temporary id', async () => {
  const path = await identityFile()
  await mkdir(path, { recursive: true })
  await expect(loadHostId(path, 2000)).rejects.toThrow()
})

it('rejects a relative identity path before writing', async () => {
  await expect(loadHostId('.host-id', 2000)).rejects.toThrow(/absolute path/u)
})
