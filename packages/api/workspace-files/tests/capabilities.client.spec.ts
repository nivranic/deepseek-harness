/** File resources follow admitted Host generations and independent metadata/feed support. */
import { Context } from '@deepseek-ai/cordis'
import { ResourceRegistry } from '@deepseek-ai/dsh-client-resources/src/client/resources.ts'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { expect, it, onTestFinished } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { ChangeFeed } from '../src/client/change-feed.ts'
import { createFileResourceProvider } from '../src/client/provider.ts'
import { FakeRemote, settle } from './fake-remote.client.ts'

const ADDRESS = sessionFileAddress('files-capability', 'a.txt')
const STAT = 'workspace-files.stat.v1'
const CHANGES = 'workspace-files.changes.v1'
const metadata = (version: string) => ({ ok: true as const, value: { absolutePath: '/host/a.txt', version } })

it('reads metadata without starting an unadvertised changes stream', async () => {
  const remote = new FakeRemote()
  const provider = createFileResourceProvider(remote, new ChangeFeed(remote), { capabilities: [STAT] })
  const iterator = provider.open(ADDRESS, { signal: new AbortController().signal })[Symbol.asyncIterator]()
  const first = iterator.next()
  const stat = await remote.waitForStat(0)
  stat.resolve(metadata('v0'))
  await expect(first).resolves.toEqual({ done: false, value: metadata('v0') })
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  expect(remote.calls).toEqual(['stat'])
})

it.each(['capability-absent', 'disposed'] as const)('refuses retained provider calls after %s', async (reason) => {
  const remote = new FakeRemote()
  const lifetime = new AbortController()
  const provider = createFileResourceProvider(remote, new ChangeFeed(remote), {
    capabilities: reason === 'capability-absent' ? [] : [STAT],
    signal: lifetime.signal,
  })
  if (reason === 'disposed') lifetime.abort()
  const iterator = provider.open(ADDRESS, { signal: new AbortController().signal })[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  expect(remote.calls).toEqual([])
})

it('withdraws metadata, drops late old results and resumes held resources against the replacement Host', async () => {
  const ctx = new Context()
  const remote = new FakeRemote()
  const resources = new ResourceRegistry(ctx)
  ctx.provide('remote', remote as never)
  ctx.provide('remote.host', remote.host as never)
  ctx.provide('remote.workspaceFiles', remote.workspaceFiles as never)
  ctx.provide('resources', resources)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  const source = resources.source(ADDRESS)
  const unwatch = source.subscribe(() => {})
  onTestFinished(async () => {
    unwatch()
    for (const stat of remote.stats) stat.resolve(metadata('teardown'))
    await fiber.dispose()
    await ctx.fiber.dispose()
  })
  await fiber.await()
  await expect.poll(() => source.getSnapshot().status).toBe('none')
  expect(remote.calls).toEqual([])

  remote.admission = [STAT]
  ctx.emit('connection/reset')
  const old = await remote.waitForStat(0)
  remote.admission = []
  ctx.emit('connection/reset')
  // The replacement refresh completes its describe round-trip on microtasks.
  await settle()
  expect(old.signal?.aborted).toBe(true)
  old.resolve(metadata('stale'))
  await expect.poll(() => source.getSnapshot().status).toBe('none')

  remote.admission = [STAT, CHANGES]
  ctx.emit('connection/reset')
  const fresh = await remote.waitForStat(1)
  fresh.resolve(metadata('fresh'))
  await expect.poll(() => source.getSnapshot()).toMatchObject({ status: 'live', value: { version: 'fresh' } })
  const watch = await remote.waitForChanges(0)
  await watch.source.deliver({ kind: 'change', change: { absolutePath: '/host/a.txt', version: 'updated' } })
  const updated = await remote.waitForStat(2)
  updated.resolve(metadata('updated'))
  await expect.poll(() => source.getSnapshot().value).toMatchObject({ version: 'updated' })
  // 'accept' is the target stream's ready acknowledgement; the write notice
  // re-stats rather than trusting the notice version.
  expect(remote.calls).toEqual(['stat', 'changes', 'accept', 'stat', 'stat'])

  remote.admission = [STAT]
  ctx.emit('connection/reset')
  const withoutFeed = await remote.waitForStat(3)
  expect(watch.source.aborted).toBe(true)
  withoutFeed.resolve(metadata('metadata-only'))
  await expect.poll(() => source.getSnapshot().value).toMatchObject({ version: 'metadata-only' })
  expect(remote.opened).toHaveLength(1)
})
