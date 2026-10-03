/**
 * Browser half of the §26 view-location handoff: one Session-header action
 * copying a cross-device link that captures the connected Host, the Session,
 * and the last Turn's anchor; a received link opens on the same Host only
 * after admission, transferring the viewing position — never the runtime.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { ViewHandoffController } from './controller.ts'
import { HandoffAction, type HandoffActionInjected } from './HandoffAction.tsx'
import { en, NS, zh, type ViewHandoffKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** §26 view-location handoff copy. */
    'view-handoff': ViewHandoffKey
  }
}

export type { HandoffActionInjected, HandoffActionProps } from './HandoffAction.tsx'
export { ViewHandoffController, VIEW_HANDOFF_FRAGMENT } from './controller.ts'

/** Required services: the sessions codec, the connection admission signal, slots, locale. */
export const inject = ['sessions', 'connection', 'slots', 'locale']

/**
 * Client plugin body: register the dictionaries, the header capture action,
 * and the one-shot received-link open.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle | undefined
  const sessions = ctx.get('sessions')
  if (connection === undefined || sessions === undefined) {
    throw new Error('view-handoff: sessions and connection services are required')
  }
  const controller = new ViewHandoffController(connection.generation)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'view-handoff: dictionaries')
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'view-handoff',
    order: 20,
    locale: NS,
    inject: (): HandoffActionInjected => ({
      hooks: { admitted: controller.admitted },
      encode: (sessionId: SessionId, anchorSeq: SessionSeq) => sessions.encodeViewLocation(sessionId, anchorSeq),
      buildLink: payload => controller.buildLink(payload),
      copy: text => controller.copy(text),
    }),
  }, HandoffAction))
  void controller.receive(sessions)
}
