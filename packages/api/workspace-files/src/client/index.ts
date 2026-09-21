/**
 * Browser half: the `file` resource provider over `remote.workspaceFiles`.
 *
 * `types.ts` is what the protocol publishes, `change-feed.ts` shares one Host
 * `changes` stream per session, `provider.ts` turns it and `stat` into a value
 * stream, and this module only wires them into `ctx.resources`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import { ChangeFeed } from './change-feed.ts'
import { createFileResourceProvider } from './provider.ts'

export type { WorkspaceFileParams } from './types.ts'

/** Required browser services: the resource model, the Remote carrier and its namespace. */
export const inject = ['resources', 'remote', 'remote.workspaceFiles']

/**
 * Register metadata only for an admitted Host with stat support; replacement
 * aborts the old registration and reopens held resources with fresh metadata.
 * @param ctx - client root context carrying `resources` and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const changes = new ChangeFeed(ctx.remote)
  ctx.effect(() => {
    // admitted-Host lifecycle scaffold is deliberately self-contained (client bundle purity forbids cross-plugin client-face value imports)
    /* jscpd:ignore-start */
    let host: typeof ctx.remote.$host | undefined
    let remove: (() => void) | undefined
    const refresh = (): void => {
      const next = ctx.remote.$host
      if (next === host) return
      host = next
      remove?.()
      remove = undefined
      if (next.capabilities?.includes('workspace-files.stat.v1') !== true) return
      const lifetime = new AbortController()
      const provider = createFileResourceProvider(ctx.remote, changes, lifetime.signal)
      const release = ctx.resources.register(provider)
      remove = () => { lifetime.abort(); release() }
    }
    /* jscpd:ignore-end */
    refresh()
    const stop = ctx.on('connection/reset', refresh)
    return async () => {
      stop()
      remove?.()
      await changes.settle()
    }
  }, 'workspace-files: admitted Host file provider')
}
