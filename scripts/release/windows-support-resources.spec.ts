/** Filesystem-only candidate fault injection; no scanner or desktop process runs here. */
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { withMissingSupportScanner } from './windows-support-resources.ts'

const roots: string[] = []
const bytes = Buffer.from('fixed scanner fixture bytes')

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-scanner-withholding-'))
  roots.push(root)
  const scanner = join(root, 'SupportScanner'), binary = join(scanner, 'gitleaks.exe')
  await mkdir(scanner)
  await writeFile(binary, bytes)
  await writeFile(join(scanner, 'LICENSE'), 'fixed license')
  return { root, scanner, binary }
}

afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

async function scannerSnapshot(path: string) {
  const handle = await open(path, 'r')
  try {
    return { stat: await handle.stat({ bigint: true }), bytes: await handle.readFile() }
  } finally { await handle.close() }
}

it('withholds only the executable on its own filesystem and restores it before returning', async () => {
  const { root, scanner, binary } = await fixture()
  const original = await scannerSnapshot(binary)
  expect(await withMissingSupportScanner(scanner, async () => {
    expect(await readdir(scanner)).toEqual(['LICENSE'])
    const holding = (await readdir(root)).filter(name => name.startsWith('.dsh-withheld-scanner-'))
    expect(holding).toHaveLength(1)
    const stored = join(root, holding[0]!, 'gitleaks.exe')
    const snapshot = await scannerSnapshot(stored)
    expect(snapshot.stat.dev).toBe(original.stat.dev)
    expect(snapshot.stat.ino).toBe(original.stat.ino)
    expect(snapshot.bytes).toEqual(bytes)
    return 'refused'
  })).toBe('refused')
  const restored = await scannerSnapshot(binary)
  expect(restored.stat.dev).toBe(original.stat.dev)
  expect(restored.stat.ino).toBe(original.stat.ino)
  expect(restored.bytes).toEqual(bytes)
  expect(await readdir(root)).toEqual(['SupportScanner'])
})

it('restores the scanner even when the refusal scenario fails', async () => {
  const { root, scanner, binary } = await fixture()
  const failure = new Error('refusal scenario failed')
  await expect(withMissingSupportScanner(scanner, async () => { throw failure })).rejects.toBe(failure)
  expect(await readFile(binary)).toEqual(bytes)
  expect(await readdir(root)).toEqual(['SupportScanner'])
})

it('retains the original executable and both errors when restoration fails', async () => {
  const { root, scanner, binary } = await fixture()
  const operationFailure = new Error('refusal scenario failed')
  const failure = await withMissingSupportScanner(scanner, async () => {
    await mkdir(binary)
    throw operationFailure
  }).catch((error: unknown) => error)
  expect(failure).toBeInstanceOf(AggregateError)
  const errors = (failure as AggregateError).errors as unknown[]
  expect(errors).toHaveLength(2)
  expect(errors[0]).toBeInstanceOf(AggregateError)
  expect((errors[0] as AggregateError).errors[0]).toBe(operationFailure)
  expect((await lstat(binary)).isDirectory()).toBe(true)
  const holding = (await readdir(root)).filter(name => name.startsWith('.dsh-withheld-scanner-'))
  expect(holding).toHaveLength(1)
  expect(await readFile(join(root, holding[0]!, 'gitleaks.exe'))).toEqual(bytes)
})

it('does not invoke the scenario or leave a directory when withholding fails', async () => {
  const { root, scanner, binary } = await fixture()
  await rm(binary)
  let called = false
  await expect(withMissingSupportScanner(scanner, async () => { called = true })).rejects.toMatchObject({ code: 'ENOENT' })
  expect(called).toBe(false)
  expect(await readdir(root)).toEqual(['SupportScanner'])
})
