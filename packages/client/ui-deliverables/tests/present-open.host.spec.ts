/** Native delivery actions resolve the viewed Session's current workspace files. */
import { mkdtemp, rm, readFile, writeFile, mkdir, realpath, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'
import { Context } from '@deepseek-ai/cordis'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import TypertGateway from '@deepseek-ai/dsh-api-gateway'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import type { SessionEventReadRequest } from '@deepseek-ai/dsh-session-query'
import { afterEach, expect, it, vi } from 'vitest'
import { PresentedFiles } from '../src/present-open.ts'
import type { PresentedFileRequest } from '../src/presented.ts'

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup()
  cleanups.length = 0
  vi.restoreAllMocks()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-present-open-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const cwd = join(root, 'workspace')
  await mkdir(cwd)
  const file = { path: '日记模板.docx' }
  await writeFile(join(cwd, file.path), Uint8Array.of(80, 75, 0, 255))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  const session: { cwd?: string } = { cwd }
  await ctx.plugin(LocalFileSystem, { cwd })
  ctx.provide('sandboxPolicy', { workspaceRoot: cwd } as never)
  await ctx.plugin({
    inject: ['fs', 'sandboxPolicy'],
    apply: (scope) => { new WorkspaceFiles(scope, { maxBytes: 1024, maxFileBytes: 1024, maxLines: 100, maxEntries: 100 }) },
  })
  const resolveAgent = vi.fn<Context['sessionController']['resolveAgent']>(() => { throw new Error('Agent activation is unavailable') })
  const readEvent = vi.fn(async (request: SessionEventReadRequest) => {
    if (request.sessionId !== 'owner') throw new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND')
    if (request.seq !== 7) throw new SessionQueryError('missing', 'SESSION_QUERY_EVENT_NOT_FOUND')
    return { session, target: { type: 'deliverables/presented', data: { turn: 1, callId: 'present-call', files: [file] } } as SessionEvent }
  })
  ctx.provide('sessionQuery', { readEvent } as never)
  const opener = vi.fn(async (_request: { path: string; action?: 'reveal' }, _signal: AbortSignal) => ({ opened: true as const }))
  ctx.provide('sessionController', { resolveAgent, openWorkspacePath: opener, workspaceDesktop: () => ({ name: 'desktop', available: true, fileManager: 'finder' }) } as never)
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(TypertGateway)
  const fiber = ctx.plugin({ apply(scope: Context) { new PresentedFiles(scope) } })
  await fiber
  const actions = ctx.presentedFiles
  const request: PresentedFileRequest = { sessionId: SessionId('owner'), seq: 7, index: 0 }
  const open = (coordinates = request, signal = new AbortController().signal) => actions.open(coordinates, signal)
  return { root, cwd, ctx, fiber, file, session, readEvent, open, opener, actions, request, resolveAgent }
}

it('advertises independent methods and withdraws the binding on disposal', async () => {
  const { ctx, fiber } = await fixture()
  expect(ctx.typertGateway.capabilities()).toEqual(expect.arrayContaining([
    'presented-file.desktop.v1', 'presented-file.open.v1', 'presented-file.reveal.v1',
  ]))
  await fiber.dispose()
  expect(ctx.typertGateway.capabilities().filter(id => id.startsWith('presented-file.'))).toEqual([])
})

it('opens current source bytes without creating an attachment or deleting the source', async () => {
  const { cwd, open, file, fiber, opener, ctx } = await fixture()
  const source = await realpath(join(cwd, file.path))
  for (const contents of ['current source', 'edited source']) {
    await writeFile(source, contents)
    await expect(open()).resolves.toEqual({ completed: true })
    expect(opener.mock.lastCall?.[0].path).toBe(source)
    expect(await readFile(opener.mock.lastCall![0].path, 'utf8')).toBe(contents)
  }
  expect(ctx.get('attachments')).toBeUndefined()
  await fiber.dispose()
  expect(await readFile(source, 'utf8')).toBe('edited source')
  await expect(open()).rejects.toThrow()
})

it('resolves inherited declarations in the viewed fork workspace without activating an Agent', async () => {
  const { root, file, readEvent, session, open, opener, resolveAgent, request } = await fixture()
  const fork = join(root, 'fork')
  await mkdir(fork)
  await writeFile(join(fork, file.path), 'child source')
  session.cwd = fork
  readEvent.mockResolvedValueOnce({ session, target: { type: 'deliverables/presented', data: { turn: 1, callId: 'inherited', files: [file] } } as SessionEvent })
  await expect(open({ ...request, sessionId: SessionId('child') })).resolves.toEqual({ completed: true })
  expect(opener.mock.lastCall?.[0].path).toBe(await realpath(join(fork, file.path)))
  expect(resolveAgent).not.toHaveBeenCalled()
})

it.each([
  { sessionId: SessionId('') }, { seq: -1 }, { seq: 0.5 }, { index: -1 }, { index: 0.1 },
  { seq: Number.MAX_SAFE_INTEGER + 1 }, { index: Number.MAX_SAFE_INTEGER + 1 },
])('rejects invalid coordinates before lookup: %j', async (invalid) => {
  const { open, request, readEvent } = await fixture()
  await expect(open({ ...request, ...invalid })).rejects.toMatchObject({ code: 'gateway/bad-request' })
  expect(readEvent).not.toHaveBeenCalled()
})

it('refuses absent Sessions, events, indices and unrelated recorded events', async () => {
  const { open, request, readEvent, session, opener } = await fixture()
  for (const missing of [{ sessionId: SessionId('other') }, { seq: 8 }, { index: 1 }]) {
    await expect(open({ ...request, ...missing })).rejects.toMatchObject({ code: 'presented-file/not-found' })
  }
  readEvent.mockResolvedValueOnce({ session, target: { type: 'turn/start' } as SessionEvent })
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/not-found' })
  expect(opener).not.toHaveBeenCalled()
})

it.each([null, [], 'invalid', {}, { turn: 1, callId: 'call', files: null },
  { turn: 1, callId: 'call', files: [null] }, { turn: 1, callId: 'call', files: [{ path: '' }] },
  { turn: 1, callId: 'call', files: [{ path: 'a', description: 1 }] },
])('refuses malformed durable declarations: %j', async (data) => {
  const { open, readEvent, session, opener } = await fixture()
  readEvent.mockResolvedValueOnce({ session, target: { type: 'deliverables/presented', data } as unknown as SessionEvent })
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/not-found' })
  expect(opener).not.toHaveBeenCalled()
})

it('refuses missing files and directories without launching', async () => {
  const { cwd, file, open, opener } = await fixture()
  await unlink(join(cwd, file.path))
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/not-found' })
  file.path = '.'
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/not-found' })
  expect(opener).not.toHaveBeenCalled()
})

it('opens external regular files through absolute and relative paths', async () => {
  const { root, file, open, opener } = await fixture()
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'outside')
  for (const path of ['../outside.txt', outside]) {
    file.path = path
    await expect(open()).resolves.toEqual({ completed: true })
    expect(opener.mock.lastCall?.[0].path).toBe(await realpath(outside))
  }
})

it('refuses a final symlink before native launch', async () => {
  const { root, cwd, file, open, opener } = await fixture()
  const outside = join(root, 'outside.txt')
  await writeFile(outside, 'outside')
  const source = join(cwd, file.path)
  await unlink(source)
  await symlink(outside, source)
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/not-found' })
  expect(opener).not.toHaveBeenCalled()
})

it('redacts query and launcher failures and permits a fresh retry', async () => {
  const { open, readEvent, opener } = await fixture()
  readEvent.mockRejectedValueOnce(new SessionQueryError('/private/host/path', 'SESSION_QUERY_CORRUPT_SESSION'))
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/action-failed', message: 'Presented file unavailable.' })
  opener.mockRejectedValueOnce(new Error('/private/host/path'))
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/action-failed', message: 'Presented file unavailable.' })
  await expect(open()).resolves.toEqual({ completed: true })
})

it('honors cancellation before lookup', async () => {
  const { open, readEvent } = await fixture()
  const controller = new AbortController()
  controller.abort(new Error('cancelled'))
  await expect(open(undefined, controller.signal)).rejects.toThrow('cancelled')
  expect(readEvent).not.toHaveBeenCalled()
})

it('disposal cancels and awaits a pending native launch', async () => {
  const entered = Promise.withResolvers<undefined>()
  const aborted = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const { open, fiber, opener } = await fixture()
  opener.mockImplementation(async (_request, signal) => {
    signal.addEventListener('abort', () => { aborted.resolve(undefined) }, { once: true })
    entered.resolve(undefined)
    await release.promise
    return { opened: true }
  })
  const pending = open().catch((error: unknown) => error)
  await entered.promise
  let disposed = false
  const disposal = fiber.dispose().then(() => { disposed = true })
  await aborted.promise
  expect(disposed).toBe(false)
  release.resolve(undefined)
  await Promise.all([pending, disposal])
  expect(await pending).toMatchObject({ name: 'AbortError' })
})

it('reports the serving desktop and reveals the verified declared file', async () => {
  const { cwd, file, request, actions, opener } = await fixture()
  const signal = new AbortController().signal
  expect(actions.desktop(signal)).toEqual({ name: 'desktop', available: true, fileManager: 'finder' })
  await expect(actions.reveal(request, signal)).resolves.toEqual({ completed: true })
  expect(opener).toHaveBeenCalledWith({ path: await realpath(join(cwd, file.path)), action: 'reveal' }, expect.any(AbortSignal))
})

it('refuses both actions when native policy disables the desktop', async () => {
  const { ctx, request, actions, opener } = await fixture()
  vi.spyOn(ctx.sessionController, 'workspaceDesktop').mockReturnValue({ name: 'desktop', available: false, fileManager: 'finder' })
  for (const action of ['open', 'reveal'] as const) {
    await expect(actions[action](request, new AbortController().signal)).rejects.toMatchObject({ code: 'presented-file/native-unavailable' })
  }
  expect(opener).not.toHaveBeenCalled()
})

it('refuses a missing or mismatched filesystem-to-Host mapping', async () => {
  const { ctx, open, opener } = await fixture()
  const mapping = vi.spyOn(ctx.fs, 'processPathFromHostPath').mockReturnValue(undefined)
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/path-unavailable' })
  mapping.mockReturnValue('/another-filesystem/file')
  await expect(open()).rejects.toMatchObject({ code: 'presented-file/path-unavailable' })
  expect(opener).not.toHaveBeenCalled()
})

it('uses the deployment workspace root when the viewed Session has no cwd', async () => {
  const { session, open, cwd, file, opener } = await fixture()
  delete session.cwd
  await expect(open()).resolves.toEqual({ completed: true })
  expect(opener.mock.lastCall?.[0].path).toBe(await realpath(join(cwd, file.path)))
})
