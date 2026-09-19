/** Delayed log durability preserves checkpoint order in the shipped Web composition. */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-storage'
import { normalizeSessionSnapshots } from '@deepseek-ai/dsh-session-snapshot'
import { launchWebScaffold, readPersistedEvents, seedSession, webSnapshotMode } from './scaffold.ts'

const fixturePath = fileURLToPath(new URL('../../../snapshots/web/checkpoint-order/session.v3.jsonl', import.meta.url))

describe.skipIf(webSnapshotMode() === 'record')('checkpoint capture order through the Web Host', () => {
  it.each([false, true])('keeps the final recorded title after an earlier checkpoint waits for log flush (backend close=%s)', async (closeBackend) => {
    const scaffold = await launchWebScaffold()
    const durable = Promise.withResolvers<undefined>()
    let unsubscribe: (() => unknown) | undefined
    try {
      const fixture = await readFile(fixturePath, 'utf8')
      const lines = fixture.trimEnd().split('\n')
      const resumeIndex = lines.findIndex(line => (JSON.parse(line) as Record<string, unknown>)['type'] === 'session/end-seed')
      expect(resumeIndex).toBeGreaterThan(1)
      const closedPrefix = lines.slice(0, resumeIndex).join('\n') + '\n'
      const latestTitle = (JSON.parse(lines.at(-1)!) as { data: { title: string } }).data.title
      const id = await seedSession(scaffold, closedPrefix, 'checkpoint-order', 'standard', { createdAt: 1 })
      const resolved = await scaffold.ctx.sessionController.resolveAgent(id)
      if ('error' in resolved) throw resolved.error
      const session = resolved.agent.session
      const cache = scaffold.ctx.sessionProjectionCache
      await cache.write(session)
      const entered = Promise.withResolvers<undefined>()
      let waiting = true
      unsubscribe = scaffold.ctx.on('session/flush', (candidate) => {
        if (candidate !== session || !waiting) return
        waiting = false
        entered.resolve(undefined)
        return durable.promise
      })
      const earlier = cache.write(session)
      await entered.promise
      scaffold.ctx.sessionTitle.rename(session, latestTitle)
      const latest = cache.write(session)
      const closing = closeBackend ? scaffold.ctx.storage.backend.get('json').close() : Promise.resolve()
      durable.resolve(undefined)
      await Promise.all([earlier, latest, closing])
      const events = await readPersistedEvents(scaffold, id)
      if (closeBackend) {
        const document = JSON.parse(await readFile(join(scaffold.workspaceCwd, '.dsh-storages', 'session_projcache', 'sessions', `${id}.json`), 'utf8')) as {
          record: { rows: { title: { val: string; seq: number } }; identity: Record<string, unknown> }
        }
        expect(document.record.rows.title.val).toBe(latestTitle)
        expect(document.record.rows.title.seq).toBe(events.at(-1)?.seq)
        expect(document.record.identity).toMatchObject({
          formatVersion: session.header.version, inheritedEventCount: session.inheritedEventCount,
        })
      } else {
        expect(cache.cachedSnapshot(session.header, session.inheritedEventCount, ['title'])?.values.title)
          .toBe(latestTitle)
      }
      const actual = [JSON.stringify({ type: 'session', ...session.header }), ...events.map(event => JSON.stringify(event))].join('\n') + '\n'
      const context = { sessionIds: [id], cwd: scaffold.workspaceCwd }
      expect(normalizeSessionSnapshots([actual], context)).toEqual(normalizeSessionSnapshots([fixture], context))
      expect(session.inheritedEventCount).toBe(SessionLogOffset(0))
    } finally {
      durable.resolve(undefined)
      unsubscribe?.()
      await scaffold.close()
    }
  })
})
