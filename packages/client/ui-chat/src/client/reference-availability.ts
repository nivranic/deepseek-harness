/** Chat reference eligibility follows current viewers and optional InputTrigger ownership. */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InputTriggerController } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { ChatReferenceAvailability } from './contract/slots.ts'

/**
 * Bind read-only preview queries to viewer and optional source lifetimes.
 * @param ctx - Chat registration context.
 * @param sessionId - viewed Session.
 * @returns observable queries; subscriptions own and release their source wiring.
 */
export function referenceAvailabilityFor(ctx: Context, sessionId: SessionId): ObservableSnapshot<ChatReferenceAvailability> {
  let owner: { controller?: InputTriggerController } | undefined
  const queries = (): ChatReferenceAvailability => ({
    canOpenFile: (path) => {
      const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
      return ctx.sidebarRightTabs.candidates(fileAddressFor(sessionId, cwd, path)).length > 0
    },
    canOpenSkill: name => owner?.controller?.canOpenReference('skill', { ref: `/${name}` }) === true,
  })
  const store = createSnapshotStore(queries())
  let subscribers = 0
  let release: (() => void) | undefined
  return {
    getSnapshot: () => store.getSnapshot(),
    subscribe: (listener) => {
      const stop = store.subscribe(listener)
      if (subscribers++ === 0) {
        const lifetime: { controller?: InputTriggerController } = {}
        owner = lifetime
        const refresh = (): void => { if (owner === lifetime) store.set(queries()) }
        const stopViewers = ctx.sidebarRightTabs.subscribe(refresh)
        const fiber = ctx.inject(['inputTriggers'], (sourceCtx) => {
          const scope = sourceCtx.sessions.scope(sessionId)
          if (scope === undefined) return
          const current = sourceCtx.inputTriggers.sessionOf(scope)
          lifetime.controller = current
          sourceCtx.effect(() => {
            const stopSource = current.referenceAvailability.subscribe(refresh)
            refresh()
            return () => { stopSource(); delete lifetime.controller; refresh() }
          }, 'ui-chat: reference preview source')
        })
        release = () => { stopViewers(); owner = undefined; void fiber.dispose() }
      }
      return () => {
        stop()
        if (--subscribers === 0) { release?.(); release = undefined }
      }
    },
  }
}
