import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectProductDiagnosticFile } from './diagnostic-files.ts'
import type { DiagnosticProduct } from './product-diagnostics.ts'

const product: DiagnosticProduct = { version: '0.1.2-alpha.1', buildNumber: 1, channel: 'dev',
  sourceSha: 'a'.repeat(40), platform: 'macos', runtimeClass: 'full' }
const directories: string[] = []
async function fixture(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-diagnostic-'))
  directories.push(directory)
  await writeFile(join(directory, 'native-crashes.json'), contents)
  return directory
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('native diagnostic files', () => {
  it('writes only the versioned projection and refuses to replace an existing output', async () => {
    const directory = await fixture(JSON.stringify({ status: 'REPORTS_FOUND', records: [{ message: 'synthetic-private-payload' }], errors: [] }))
    const actual = await collectProductDiagnosticFile(directory, product, 4096)
    const written = await readFile(join(directory, 'product-diagnostics.json'), 'utf8')
    expect(JSON.parse(written)).toEqual(actual)
    expect(written).not.toContain('synthetic-private-payload')
    expect(actual).toMatchObject({ ...product, status: 'OBSERVED', errors: [{ errorClass: 'native-crash', count: 1 }] })
    await expect(collectProductDiagnosticFile(directory, product, 4096)).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(directory, 'product-diagnostics.json'), 'utf8')).toBe(written)
  })

  it('reads the Windows collector filename and preserves an unavailable query', async () => {
    const directory = await fixture('{}')
    await writeFile(join(directory, 'installer-crash.json'), JSON.stringify({ schemaVersion: 1,
      scope: 'windows-installer-crash-diagnostic', queryState: 'unavailable', malformedRecords: 0, records: [] }))
    expect(await collectProductDiagnosticFile(directory, { ...product, platform: 'windows' }, 4096))
      .toMatchObject({ status: 'UNAVAILABLE', collectionErrors: 1, errors: [] })
  })

  it('rejects oversized or malformed native input before creating product output', async () => {
    for (const [contents, limit, reason] of [
      ['synthetic-private-payload', 1, 'byte limit'],
      ['{synthetic-private-payload', 4096, 'valid UTF-8 JSON'],
    ] as const) {
      const directory = await fixture(contents)
      await expect(collectProductDiagnosticFile(directory, product, limit)).rejects.toThrow(reason)
      await expect(readFile(join(directory, 'product-diagnostics.json'))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it.each([0, -1, 0.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects invalid input byte limit %s', async (limit) => {
    await expect(collectProductDiagnosticFile('not-opened', product, limit)).rejects.toThrow('byte limit')
  })

  it('does not invent a collector for an unconnected mobile platform', async () => {
    await expect(collectProductDiagnosticFile('not-opened', { ...product, platform: 'ios', runtimeClass: 'companion' }, 4096))
      .rejects.toThrow('not connected')
  })
})
