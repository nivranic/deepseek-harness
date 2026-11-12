/**
 * Browser half: the `file` resource provider over `remote.workspaceFiles`.
 *
 * `types.ts` is what the protocol publishes, `change-feed.ts` shares one Host
 * `changes` stream per session, `provider.ts` turns it and `stat` into a value
 * stream, and this module registers the provider only while the admitted Host
 * advertises `workspace-files.stat.v1` through `host.describe`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
// Merges the generated `host` namespace into this client face for describe().
import type {} from '@deepseek-ai/dsh-api-host-description/remote'
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
    let remove: (() => void) | undefined
    let refreshToken = 0
    const refresh = async (): Promise<void> => {
      const token = ++refreshToken
      const described = await ctx.remote.host.describe().then(
        result => result.ok ? result.value.capabilities : undefined,
        () => undefined,
      )
      if (token !== refreshToken) return
      remove?.()
      remove = undefined
      if (described === undefined || !described.includes('workspace-files.stat.v1')) return
      const lifetime = new AbortController()
      const provider = createFileResourceProvider(ctx.remote, changes, { capabilities: described, signal: lifetime.signal })
      const release = ctx.resources.register(provider)
      remove = () => { lifetime.abort(); release() }
    }
    void refresh()
    const stop = ctx.on('connection/reset', () => { void refresh() })
    return async () => {
      stop()
      refreshToken++
      remove?.()
      await changes.settle()
    }
  }, 'workspace-files: admitted Host file provider')
}
