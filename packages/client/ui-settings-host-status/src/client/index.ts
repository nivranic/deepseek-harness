/**
 * §41 Host readiness section registered into Web Settings. hostDiagnostics
 * is the one service every Settings-face Host composes, so the section
 * registers unconditionally and renders read failures itself.
 *
 * ctx.remote.hostDiagnostics arrives only through the dsh-api-remotes
 * aggregation; this package does not import the remote artifact.
 */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the Context `remote` service merge and every aggregated
// Remote namespace into the program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { HostStatusSection, type HostStatusSectionInjected, type HostStatusSectionProps } from './HostStatusSection.tsx'
import { en, zh, type HostStatusLocaleKey } from './locales.ts'

export type { HostStatusSectionInjected, HostStatusSectionProps } from './HostStatusSection.tsx'
export type { HostStatusLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Host readiness copy; one name and one state key per health component. */
    'settings.hostStatus': HostStatusLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.hostStatus'

/** Services required by the Settings registration and the Remote face. */
export const inject = ['slots', 'locale', 'remote']

/**
 * Contribute the Host status section. The registration is unconditional:
 * a Host that cannot answer `health` surfaces through the section's error
 * state, not through a missing nav entry.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-host-status: dictionaries')

  const t = ctx.locale.bind(NS)
  ctx.slots.inject('settings.section', () => {
    const remote = ctx.remote.hostDiagnostics
    // The generated Remote face answers RemoteResult-wrapped; a refused call
    // surfaces as a rejection so the section's error state owns it.
    const injectFace: HostStatusSectionInjected = {
      health: async () => {
        const result = await remote.health()
        if (!result.ok) throw result.error
        return result.value
      },
    }
    // A new component identity discards the previous document's gesture state.
    const HostStatusForDocument = (props: HostStatusSectionProps) => createElement(HostStatusSection, props)
    return ctx.slots.register({
      name: 'settings.section',
      id: 'host-status',
      order: 16,
      label: () => t('nav'),
      locale: NS,
      inject: () => injectFace,
    }, HostStatusForDocument)
  })
}
