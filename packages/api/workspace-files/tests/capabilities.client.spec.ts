/** File resources follow admitted Host generations and independent metadata/feed support. */
import { Context } from '@deepseek-ai/cordis'
import { ResourceRegistry } from '@deepseek-ai/dsh-client-resources/src/client/resources.ts'
import { sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { expect, it, onTestFinished } from 'vitest'
import { apply, inject } from '../src/client/index.ts'
import { ChangeFeed } from '../src/client/change-feed.ts'
import { createFileResourceProvider } from '../src/client/provider.ts'
import { FakeRemote } from './fake-remote.client.ts'

const ADDRESS = sessionFileAddress('files-capability', 'a.txt')
const metadata = (version: string) => ({ ok: true as const, value: { absolutePath: '/host/a.txt', version } })

it('reads metadata without starting an unadvertised changes stream', async () => {
  const remote = new FakeRemote()
  remote.$host = { ...remote.$host, capabilities: ['workspace-files.stat.v1'] }
  const changes = new ChangeFeed(remote)
  const provider = createFileResourceProvider(remote, changes)
  const iterator = provider.open(ADDRESS, { signal: new AbortController().signal })[Symbol.asyncIterator]()
  const first = iterator.next()
  const stat = await remote.waitForStat(0)
  stat.resolve(metadata('v0'))
  await expect(first).resolves.toEqual({ done: false, value: metadata('v0') })
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  expect(remote.calls).toEqual(['stat'])
})

it.each(['capability-absent', 'replaced', 'disposed'] as const)('refuses retained provider calls after %s', async (reason) => {
  const remote = new FakeRemote()
  const lifetime = new AbortController()
  if (reason === 'capability-absent') remote.$host = { ...remote.$host, capabilities: [] }
  const provider = createFileResourceProvider(remote, new ChangeFeed(remote), lifetime.signal)
  if (reason === 'replaced') remote.$host = { ...remote.$host }
  if (reason === 'disposed') lifetime.abort()
  const iterator = provider.open(ADDRESS, { signal: new AbortController().signal })[Symbol.asyncIterator]()
  await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined })
  expect(remote.calls).toEqual([])
})

it('withdraws metadata, drops late old results and resumes held resources against the replacement Host', async () => {
  const ctx = new Context()
  const remote = new FakeRemote()
  remote.$host = { ...remote.$host, capabilities: [] }
  const resources = new ResourceRegistry(ctx)
  ctx.provide('remote', remote as never)
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
  expect(source.getSnapshot().status).toBe('none')
  expect(remote.calls).toEqual([])

  remote.$host = { ...remote.$host, capabilities: ['workspace-files.stat.v1'] }
  ctx.emit('connection/reset')
  const old = await remote.waitForStat(0)
  remote.$host = { ...remote.$host, capabilities: [] }
  ctx.emit('connection/reset')
  expect(old.signal?.aborted).toBe(true)
  old.resolve(metadata('stale'))
  expect(source.getSnapshot().status).toBe('none')

  remote.$host = { ...remote.$host, capabilities: ['workspace-files.stat.v1', 'workspace-files.changes.v1'] }
  ctx.emit('connection/reset')
  const fresh = await remote.waitForStat(1)
  fresh.resolve(metadata('fresh'))
  await expect.poll(() => source.getSnapshot()).toMatchObject({ status: 'live', value: { version: 'fresh' } })
  const watch = await remote.waitForChanges(0)
  await watch.source.deliver({ kind: 'change', change: { absolutePath: '/host/a.txt', version: 'updated' } })
  await expect.poll(() => source.getSnapshot().value).toMatchObject({ version: 'updated' })

  remote.$host = { ...remote.$host, capabilities: ['workspace-files.stat.v1'] }
  ctx.emit('connection/reset')
  const withoutFeed = await remote.waitForStat(2)
  expect(watch.source.aborted).toBe(true)
  withoutFeed.resolve(metadata('metadata-only'))
  await expect.poll(() => source.getSnapshot().value).toMatchObject({ version: 'metadata-only' })
  expect(remote.opened).toHaveLength(1)
})
