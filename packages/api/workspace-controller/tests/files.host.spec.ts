/** Read-only file-browse verbs over the real local backend: containment, normalization, size cap, binary guard, range read. */

import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WorkspaceFiles } from '../src/files.ts'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** Failure shape the verbs throw across the Remote boundary. */
interface Failure {
  code: string
  details: Record<string, unknown>
}

const failureOf = async (run: () => Promise<unknown>): Promise<Failure> => {
  try {
    await run()
  } catch (error) {
    const candidate = (error as { failure?: { code?: string; details?: Record<string, unknown> } }).failure
    expect(candidate?.code).toBeDefined()
    return { code: candidate!.code!, details: candidate!.details ?? {} }
  }
  throw new Error('expected the call to fail')
}

describe('WorkspaceFiles', () => {
  let ctx: Context | undefined
  let root: string | undefined
  let files: WorkspaceFiles | undefined

  beforeEach(async () => {
    const home = await import('node:fs/promises').then(fs => fs.mkdtemp(join(tmpdir(), 'dsh-workspace-files-')))
    root = join(home, 'root')
    const outside = join(home, 'outside')
    await mkdir(join(root, 'src'), { recursive: true })
    await mkdir(outside, { recursive: true })
    await writeFile(join(root, 'readme.md'), '# 伴侣\n\n只读浏览。\n', 'utf8')
    await writeFile(join(root, 'src', 'main.ts'), 'export const answer = 42\n', 'utf8')
    // Invalid UTF-8 bytes: the backend's text decode must reject this file.
    await writeFile(join(root, 'src', 'logo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00]))
    await writeFile(join(outside, 'secret.txt'), 'outside the root\n', 'utf8')
    // A directory link escaping the root: junctions need no privilege on
    // Windows and degrade to plain symlinks elsewhere.
    await symlink(outside, join(root, 'escape'), 'junction')
    await writeFile(join(root, 'big.txt'), 'x'.repeat(300), 'utf8')

    ctx = new Context()
    new LocalFileSystem(ctx, { cwd: root, diffBasisMaxBytes: 1024 * 1024 })
    const workspace = { id: 'ws-1', path: root } as unknown as Workspace
    ctx.provide('workspaceRegistry', {
      get: (id: string) => id === 'ws-1' ? workspace : undefined,
    } as never)
    files = new WorkspaceFiles(ctx, { maxReadBytes: 128 })
  })

  afterEach(async () => {
    await ctx?.fiber.dispose()
  })

  it('lists the root and nested directories with names, types, and sizes', async () => {
    const listed = await files!.list('ws-1', undefined)
    expect(listed.path).toBe('')
    expect(listed.entries.map(entry => [entry.name, entry.type])).toEqual([
      ['big.txt', 'file'],
      ['escape', 'directory'],
      ['readme.md', 'file'],
      ['src', 'directory'],
    ])
    expect(listed.entries[0]).toMatchObject({ name: 'big.txt', size: 300 })

    const nested = await files!.list('ws-1', 'src')
    expect(nested.path).toBe('src')
    expect(nested.entries.map(entry => entry.name)).toEqual(['logo.bin', 'main.ts'])
  })

  it('normalizes dot segments before resolving', async () => {
    const nested = await files!.list('ws-1', './src/../src')
    expect(nested.path).toBe('src')
    const file = await files!.read('ws-1', 'src/./../src/main.ts', undefined, undefined)
    expect(file.content).toBe('export const answer = 42\n')
  })

  it('rejects traversal above the root both textually and canonically', async () => {
    const textual = await failureOf(() => files!.list('ws-1', '../outside'))
    expect(textual.code).toBe('path-outside-workspace')

    // The escape link resolves canonically outside the root.
    const canonical = await failureOf(() => files!.list('ws-1', 'escape'))
    expect(canonical.code).toBe('path-outside-workspace')
  })

  it('rejects unknown workspaces, missing paths, and wrong kinds', async () => {
    expect((await failureOf(() => files!.list('ws-x', undefined))).code).toBe('workspace-not-found')
    expect((await failureOf(() => files!.list('ws-1', 'nope'))).code).toBe('file-not-found')
    expect((await failureOf(() => files!.list('ws-1', 'readme.md'))).code).toBe('not-a-directory')
    expect((await failureOf(() => files!.read('ws-1', 'src', undefined, undefined))).code).toBe('not-a-regular-file')
    expect((await failureOf(() => files!.read('ws-1', 'gone.md', undefined, undefined))).code).toBe('file-not-found')
  })

  it('reads text with media type, size, and a UTF-16 range', async () => {
    const whole = await files!.read('ws-1', 'readme.md', undefined, undefined)
    expect(whole).toMatchObject({
      content: '# 伴侣\n\n只读浏览。\n',
      truncated: false,
      mediaType: 'text/markdown',
    })
    expect(whole.size).toBe(whole.content.length)

    const ranged = await files!.read('ws-1', 'big.txt', 10, 50)
    expect(ranged.content).toBe('x'.repeat(50))
    expect(ranged.truncated).toBe(true)
    expect(ranged.size).toBe(300)
    expect(ranged.mediaType).toBe('text/plain')
  })

  it('enforces the byte cap and the binary guard', async () => {
    const tooLarge = await failureOf(() => files!.read('ws-1', 'big.txt', undefined, undefined))
    expect(tooLarge.code).toBe('file-too-large')
    expect(tooLarge.details).toMatchObject({ path: 'big.txt', size: 300, maxBytes: 128 })

    const binary = await failureOf(() => files!.read('ws-1', 'src/logo.bin', undefined, undefined))
    expect(binary.code).toBe('file-binary')
  })

  it('rejects malformed payloads at the wire boundary', async () => {
    expect((await failureOf(() => files!.read('ws-1', '', undefined, undefined))).code).toBe('bad-request')
    expect((await failureOf(() => files!.read('ws-1', 'a', -1, undefined))).code).toBe('bad-request')
    expect((await failureOf(() => files!.read('ws-1', 'a', undefined, 0))).code).toBe('bad-request')
  })
})
