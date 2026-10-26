import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type AttachmentStore from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { createScope } from '@deepseek-ai/dsh-scope'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it } from 'vitest'
import { FileUploads } from '../src/index.ts'
import type { FileUploadReceiptId } from '../src/types.ts'

interface RouteUploadValue {
  readonly receiptId: string
  readonly file: FileAttachmentRef
}

type RouteUploadResult =
  | { readonly ok: true; readonly value: RouteUploadValue }
  | { readonly ok: false; readonly error: { readonly code: string; readonly details: { readonly reason?: string } } }

const contexts: Context[] = []
const homes: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true })))
})

function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function stored(result: RouteUploadResult): RouteUploadValue {
  if (!result.ok) throw new Error(`upload failed: ${JSON.stringify(result.error)}`)
  return result.value
}

function hostPath(store: AttachmentStore, ref: FileAttachmentRef): string {
  const path = store.fileHostPath(ref)
  if (path === undefined) throw new Error('local attachment store exposes no host path')
  return path
}

async function storeHarness(input: {
  readonly sessionId?: string
  readonly dshHome?: string
} = {}): Promise<{
  ctx: Context
  uploads: FileUploads
  route: (request: Request) => Promise<Response>
  agent: Agent
  root: string
}> {
  const ctx = new Context()
  contexts.push(ctx)
  const dshHome = input.dshHome ?? await mkdtemp(join(tmpdir(), 'dsh-upload-edge-'))
  if (input.dshHome === undefined) homes.push(dshHome)
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(LocalAttachmentStore, { dshHome })
  const session = ctx.sessions.create(SessionId(input.sessionId ?? 'edge-session'), {
    meta: { cwd: '/workspace' },
  })
  const agent = {
    id: session.id,
    session,
    inbox: {},
    status: 'idle',
    ctx: undefined,
  } as unknown as Agent
  ;(agent as { ctx: Context }).ctx = createScope(ctx, agent).ctx
  ctx.agents.register(agent)
  let route: ((request: Request) => Promise<Response>) | undefined
  ctx.provide('connection', {
    fetch: {
      register: (registered: { readonly fetch: (request: Request) => Promise<Response> }) => {
        route = registered.fetch
        return () => {}
      },
    },
  } as never)
  const uploads = new FileUploads(ctx)
  if (route === undefined) throw new Error('file upload route was not registered')
  return { ctx, uploads, route, agent, root: join(dshHome, 'attachments', 'v1') }
}

async function postUpload(
  route: (request: Request) => Promise<Response>,
  sessionId: string,
  body: Uint8Array<ArrayBuffer> | ReadableStream<Uint8Array>,
  name?: string,
): Promise<RouteUploadResult> {
  const query = new URLSearchParams({ sessionId })
  if (name !== undefined) query.set('name', name)
  const response = await route(new Request(
    `http://harness.test/api/session/uploadFileBinary?${query.toString()}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      ...(body instanceof ReadableStream
        ? { body, duplex: 'half' as const }
        : { body: new Blob([body]) }),
    },
  ))
  expect(response.status).toBe(200)
  return await response.json() as RouteUploadResult
}

describe('streamed file upload edges over the real local attachment store', () => {
  it('round-trips exact bytes containing NUL and high bytes through the registered route', async () => {
    const { ctx, uploads, route, agent, root } = await storeHarness()
    const bytes = Uint8Array.of(0, 1, 0x7f, 0x80, 0xfd, 0xfe, 0xff, 0, 0)
    const hex = sha256Hex(bytes)
    const value = stored(await postUpload(route, 'edge-session', bytes, 'blob.bin'))
    expect(value.file).toEqual({
      attachmentId: `sha256:${hex}`, name: 'blob.bin', bytes: bytes.byteLength,
    })
    expect(uploads.resolve(agent, value.receiptId as FileUploadReceiptId)).toEqual(value.file)
    const alias = hostPath(ctx.attachments, value.file)
    expect(alias).toBe(join(root, 'files', hex.slice(0, 2), hex, 'blob.bin'))
    expect(new Uint8Array(await readFile(alias))).toEqual(bytes)
    await expect(readdir(join(root, 'tmp'))).resolves.toEqual([])
  })

  it('stores a zero-byte body and keeps the default leaf for an absent name', async () => {
    const { ctx, route, root } = await storeHarness()
    const value = stored(await postUpload(route, 'edge-session', new Uint8Array(0)))
    expect(value.file).toEqual({
      attachmentId: `sha256:${sha256Hex(new Uint8Array(0))}`, name: 'file', bytes: 0,
    })
    expect((await readFile(hostPath(ctx.attachments, value.file))).byteLength).toBe(0)
    await expect(readdir(join(root, 'tmp'))).resolves.toEqual([])
  })

  it('round-trips encoded display names: CJK and emoji stay, path stems and reserved characters are sanitized', async () => {
    const { ctx, route, root } = await storeHarness()
    const unicode = stored(await postUpload(route, 'edge-session', Uint8Array.of(1), '报告 📊 final v2.pdf'))
    const windowsPath = stored(await postUpload(
      route, 'edge-session', Uint8Array.of(2), 'C:\\Users\\ieme\\file<1>:v2.txt',
    ))
    expect(unicode.file.name).toBe('报告 📊 final v2.pdf')
    expect(windowsPath.file.name).toBe('file_1__v2.txt')
    const unicodeHex = sha256Hex(Uint8Array.of(1))
    const unicodeAlias = hostPath(ctx.attachments, unicode.file)
    expect(unicodeAlias).toBe(join(root, 'files', unicodeHex.slice(0, 2), unicodeHex, '报告 📊 final v2.pdf'))
    expect(new Uint8Array(await readFile(unicodeAlias))).toEqual(Uint8Array.of(1))
    expect(new Uint8Array(await readFile(hostPath(ctx.attachments, windowsPath.file)))).toEqual(Uint8Array.of(2))
  })

  it('streams a 96 MiB patterned body once and reads it back with matching bytes and digest', async () => {
    const { ctx, route } = await storeHarness()
    const chunk = new Uint8Array(1024 * 1024)
    for (let i = 0; i < chunk.byteLength; i++) chunk[i] = (i * 31 + 7) & 0xff
    const repetitions = 96
    const expected = createHash('sha256')
    for (let i = 0; i < repetitions; i++) expected.update(chunk)
    const hex = expected.digest('hex')
    let remaining = repetitions
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining > 0) {
          remaining -= 1
          controller.enqueue(chunk)
        } else {
          controller.close()
        }
      },
    })
    const value = stored(await postUpload(route, 'edge-session', body, 'pattern-96mib.bin'))
    expect(value.file).toEqual({
      attachmentId: `sha256:${hex}`, name: 'pattern-96mib.bin', bytes: 96 * 1024 * 1024,
    })
    const readHash = createHash('sha256')
    let readBytes = 0
    const observed = new Map<number, number | undefined>()
    const probes = [0, 1024 * 1024 - 1, 50_000_000]
    for await (const part of ctx.attachments.readFileStream(value.file)) {
      readHash.update(part)
      const base = readBytes
      readBytes += part.byteLength
      for (const offset of probes) {
        const local = offset - base
        if (local >= 0 && local < part.byteLength) observed.set(offset, part[local])
      }
    }
    expect(readBytes).toBe(96 * 1024 * 1024)
    expect(readHash.digest('hex')).toBe(hex)
    expect(observed).toEqual(new Map([
      [0, chunk[0]],
      [1024 * 1024 - 1, chunk[1024 * 1024 - 1]],
      [50_000_000, chunk[50_000_000 % (1024 * 1024)]],
    ]))
  })

  it('keeps a failed mid-stream upload unpublished with an empty staging area', async () => {
    const { route, root } = await storeHarness()
    const delivered = Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8)
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(delivered)
        controller.error(new Error('connection reset mid-upload'))
      },
    })
    const result = await postUpload(route, 'edge-session', body, 'interrupted.bin')
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'session/attachment-invalid', details: { reason: 'ATTACHMENT_WRITE_FAILED' } },
    })
    const hex = sha256Hex(delivered)
    await expect(readdir(join(root, 'files', hex.slice(0, 2), hex))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(join(root, 'file-objects', hex.slice(0, 2), hex))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readdir(join(root, 'tmp'))).resolves.toEqual([])
    expect(stored(await postUpload(route, 'edge-session', Uint8Array.of(9), 'after-failure.bin')).file.bytes).toBe(1)
  })

  it('treats receipts from an earlier service instance as foreign and deduplicates identical bytes by digest', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-upload-restart-'))
    homes.push(home)
    const bytes = Uint8Array.of(10, 20, 30)
    const hex = sha256Hex(bytes)
    const first = await storeHarness({ sessionId: 'restart-a', dshHome: home })
    const uploaded = stored(await postUpload(first.route, 'restart-a', bytes, 'persist.bin'))
    const second = await storeHarness({ sessionId: 'restart-b', dshHome: home })
    expect(second.uploads.resolve(second.agent, uploaded.receiptId as FileUploadReceiptId)).toBeUndefined()
    const resumed = stored(await postUpload(second.route, 'restart-b', bytes, 'copy.bin'))
    expect(resumed.file.attachmentId).toBe(uploaded.file.attachmentId)
    const digestShard = join(second.root, 'files', hex.slice(0, 2), hex)
    expect((await readdir(digestShard)).sort()).toEqual(['copy.bin', 'persist.bin'])
    expect((await readdir(join(second.root, 'file-objects', hex.slice(0, 2)))).sort()).toEqual([hex])
    const stagedAgain = await second.uploads.uploadDedupe(
      second.agent, { digest: hex, name: 'staged.bin' }, new AbortController().signal,
    )
    expect(stagedAgain.file).toEqual({
      attachmentId: `sha256:${hex}`, name: 'staged.bin', bytes: bytes.byteLength,
    })
    expect((await readdir(digestShard)).sort()).toEqual(['copy.bin', 'persist.bin', 'staged.bin'])
    const renamed = await second.ctx.attachments.ensureFileByDigest(hex, 'renamed.txt')
    expect(renamed).toMatchObject({
      attachmentId: `sha256:${hex}`, name: 'renamed.txt', bytes: bytes.byteLength,
    })
  })
})
