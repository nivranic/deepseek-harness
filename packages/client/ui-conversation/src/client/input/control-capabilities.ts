/** Composer operation support over the current Host and optional durable child address. */
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { ComposerControlAvailability } from '../contract/slots.ts'

/** Current application inputs for a session-maybe composer. */
export interface ComposerControlDeps {
  readonly host: () => RemoteHostFacts
  readonly address: () => SubagentAddress | undefined
  readonly subscribe: (listener: () => void) => () => void
  readonly alive: () => boolean
  readonly cancel?: () => Promise<unknown>
}

/**
 * Resolve prompt and interrupt capabilities independently and bind Stop to its originating Host.
 * @param deps - generation, durable target address and Session cancellation callback.
 * @returns a stable observable for the composer's renderer hook.
 */
export function createComposerControlSource(deps: ComposerControlDeps): ObservableSnapshot<ComposerControlAvailability> {
  let previousHost: RemoteHostFacts | undefined
  let previousAddress: SubagentAddress | undefined
  let snapshot: ComposerControlAvailability | undefined
  const getSnapshot = (): ComposerControlAvailability => {
    const host = deps.alive() ? deps.host() : undefined
    const address = deps.alive() ? deps.address() : undefined
    if (snapshot !== undefined && host === previousHost && address === previousAddress) return snapshot
    previousHost = host
    previousAddress = address
    const supports = (capability: string): boolean => host?.capabilities?.includes(capability) === true
    const child = address !== undefined
    const continuable = address?.mode === 'continuable'
    const prompt = child ? continuable && supports('subagent.prompt.v1') : supports('session.control.v1')
    const interrupt = deps.cancel !== undefined && (child
      ? continuable && (supports('subagent.interrupt-turn.v1') || supports('subagent.interrupt.v1'))
      : supports('session.cancel-turn.v1') || supports('session.control.v1'))
    const cancel = deps.cancel
    snapshot = {
      prompt,
      interrupt,
      fileUpload: !child && supports('file-upload.stage.v1'),
      current: () => deps.alive() && deps.host() === host && deps.address() === address,
      stop: !interrupt || cancel === undefined ? undefined : () => {
        if (!deps.alive() || deps.host() !== host || deps.address() !== address) return
        void cancel().catch(() => {
          // The Session owns cancellation failures in promptError; this UI callback must not reject unobserved.
        })
      },
    }
    return snapshot
  }
  return { getSnapshot, subscribe: listener => deps.subscribe(() => { getSnapshot(); listener() }) }
}
