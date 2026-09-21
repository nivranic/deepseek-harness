/**
 * Browser half of the native directory-picker backend: fills ui-workspace's
 * two directory-flow holes with a renderless occupant that answers each
 * `open` by driving `directoryPicker/pick` (the node half's OS chooser) and
 * reporting the one outcome — picked path, cancellation, or failure — back
 * through the owner conversation. Mounting this package therefore composes
 * both sides of the native interaction with one cordis.yml row; no client
 * code branches on a capability kind.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { NativeFlowInjected } from './flow.ts'
import { NativeDirectoryFlow } from './flow.ts'


/** Required services (cordis fiber inject): the slot registry and workspace UI service. */
export const inject = ['slots', 'uiWorkspace', 'remote']

/**
 * Client plugin body: register the renderless native flow into both
 * directory-flow holes through `slots.inject()` because the ui-workspace
 * entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', () => {
      // per-admitted-Host registration restated deliberately (client bundle purity forbids the shared-helper import)
      /* jscpd:ignore-start */
      let currentHost: typeof ctx.remote.$host | undefined
      let remove: (() => void) | undefined
      const refresh = (): void => {
        const host = ctx.remote.$host
        if (host === currentHost) return
        currentHost = host
        remove?.()
        remove = undefined
        if (host.capabilities?.includes('directory-picker.native.v1') !== true) return
        const lifetime = new AbortController()
        const operations = ctx.uiWorkspace.captureDirectoryOperations(lifetime.signal)
        const injected = (): NativeFlowInjected => ({
          pick: operations.pickDirectory,
        })
        const dispose = ctx.effect(function* () {
          yield () => { lifetime.abort() }
          yield ctx.slots.register({
            name: 'conversation.hero.workspace.directoryFlow', inject: injected,
          }, NativeDirectoryFlow)
          yield ctx.slots.register({
            name: 'sidebar.workspaces.directoryFlow', inject: injected,
          }, NativeDirectoryFlow)
        }, 'directory-picker-native: admitted Host entries')
        remove = () => { lifetime.abort(); void dispose() }
      }
      /* jscpd:ignore-end */
      refresh()
      const stop = ctx.on('connection/reset', refresh)
      return () => { stop(); remove?.() }
    }))
}
