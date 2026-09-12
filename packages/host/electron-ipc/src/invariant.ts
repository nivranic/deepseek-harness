/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-electron-ipc`.
 * @module @deepseek-ai/dsh-host-electron-ipc/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from './support.ts'
import type { DesktopSupportCounts } from './types.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-electron-ipc'

/** Cordis companion plugin name. */
export const name = 'electron-ipc-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * Audit diagnostic counter deltas against live Session append observations.
 * Each Session's first observed event establishes a cursor so an invariant installed
 * after the collector cannot mistake an earlier delivery for a new append.
 */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  const service = ctx.desktopSupport
  const cursors = new WeakMap<Session, number>()
  let previous = service.diagnosticCounts()
  const fields: Readonly<Record<string, keyof DesktopSupportCounts | undefined>> = {
    'turn/start': 'turnsStarted', 'turn/end': 'turnsEnded', 'tool/call': 'toolCalls', 'tool/result': 'toolResults',
  }
  ctx.on('session/event', (session, event) => {
    const cursor = cursors.get(session)
    const current = service.diagnosticCounts()
    if (cursor !== undefined) {
      const changed = event.seq > cursor ? fields[event.type] : undefined
      for (const key of Object.keys(previous) as Array<keyof DesktopSupportCounts>) {
        const expected = key === changed ? Math.min(previous[key] + 1, 0xffff_ffff) : previous[key]
        if (current[key] !== expected) fail('desktop diagnostic counters disagree with Session append observations')
      }
    }
    cursors.set(session, Math.max(cursor ?? -1, event.seq))
    previous = current
  })
}, { inject: ['desktopSupport'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
