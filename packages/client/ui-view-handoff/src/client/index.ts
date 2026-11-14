/** Cross-device viewing links, verified against authenticated Host discovery. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { ViewHandoffController } from './controller.ts'
import { HandoffFailure } from './view-location.ts'
import { HandoffAction, type HandoffActionInjected } from './HandoffAction.tsx'
import { HandoffNotice, type HandoffNoticeInjected } from './HandoffNotice.tsx'
import { en, NS, zh, type ViewHandoffKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Viewing-link actions and receive failures. */
    'view-handoff': ViewHandoffKey
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Temporary history retention while opening a received viewing link. */
    viewHandoff: unknown
  }
}

export type { HandoffActionInjected, HandoffActionProps } from './HandoffAction.tsx'

/** Services owning discovery, scoped history, navigation, and presentation. */
export const inject = ['sessions', 'connection', 'remote', 'remote.host', 'uiWorkspace', 'uiConversation', 'slots', 'locale']

/**
 * Register capture and receive operations; the plugin owns every pending discovery and open.
 * @param ctx - Client plugin context.
 */
export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new ViewHandoffController(connection.generation, () => ctx.remote.host.describe(), async (location, signal) => {
    await ctx.sessions.refresh()
    signal.throwIfAborted()
    await ctx.sessions.using(location.sessionId, { source: 'viewHandoff', signal }, async (reference) => {
      const binding = await reference.ready
      signal.throwIfAborted()
      const conversation = ctx.uiConversation.binding(binding)
      conversation.activate('chat')
      await binding.session.loadThrough(location.anchorSeq)
      signal.throwIfAborted()
      const timeline = conversation.snapshot.getSnapshot().views.get('chat')?.timeline
      const turn = timeline === undefined ? undefined : [...timeline.turns.values()].find(item => item.start?.seq === location.anchorSeq)
      if (turn === undefined) throw new HandoffFailure('openFailed')
      ctx.uiConversation.openView(binding, 'chat', `turn:${turn.turn}`)
      ctx.uiWorkspace.openSession(location.sessionId)
    })
  })
  ctx.effect(() => () => { controller.dispose() }, 'view-handoff: lifetime')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'view-handoff: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions', id: 'view-handoff', order: 20, locale: NS,
    inject: (): HandoffActionInjected => ({
      hooks: { admission: controller.admission },
      encode: (sessionId, anchorSeq) => controller.encode(sessionId, anchorSeq),
      buildLink: payload => controller.buildLink(payload),
      copy: text => controller.copy(text),
    }),
  }, HandoffAction))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'view-handoff.notice', locale: NS,
    inject: (): HandoffNoticeInjected => ({ hooks: { failure: controller.failure }, dismiss: () => { controller.failure.set(undefined) } }),
  }, HandoffNotice))
  void controller.receive()
}
