/**
 * Browser half: register `files` as a right-Sidebar tab type.
 *
 * The public two-stage path, unmodified: the type into `ctx.sidebarRightTabs`,
 * the body into the keyed `sidebar.right.pane.tab` seat and the chip title into
 * the keyed `sidebar.right.pane.tab.title` seat, both under the type's `id`.
 *
 * The file split is this package's layering: what the type IS
 * (`definition.tsx`), what it keeps (`store.ts`), how it lists (`face.ts`), what
 * it draws (`FilesBody.tsx`, `FilesTitle.tsx`), what it says (`locales.ts`),
 * and this module, which only wires them together.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { FILES_ID, filesDefinition } from './definition.tsx'
import type { FilesInjected } from './face.ts'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { createList, filesFace } from './face.ts'
import { FilesBody } from './FilesBody.tsx'
import { FilesTitle } from './FilesTitle.tsx'
import { en, zh } from './locales.ts'
import { createFilesStore } from './store.ts'

export type { SidebarFilesKey } from './locales.ts'
export type { DirLevel, FilesState, FilesTabState, LevelState } from './store.ts'
export type { FilesInjected, ListWorkspaceDirectory, WorkspaceFilesListRemote } from './face.ts'
export type { FilesBodyProps } from './FilesBody.tsx'

/** Registration inputs for file routing and observable viewer availability. */
export interface FilesRegistrationInjected extends FilesInjected {
  /**
   * Whether a currently registered viewer claims this resource.
   * @param address - Session file address.
   * @returns whether an open action is available.
   */
  readonly canOpenFile: (address: string) => boolean
  /** Viewer registrations; changes invalidate file-row actions. */
  readonly hooks: { readonly fileOpeners: ObservableSnapshot<readonly SidebarRightTabDefinition[]> }
}

/** This package's copy namespace. */
const NS = 'sidebarFiles'

/**
 * Required browser services: the tab registry, the keyed seat, the Remote
 * carrier and its namespace, and copy.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

/**
 * Client plugin body: register the type, its dictionaries, its body, and its chip title.
 * @param ctx - client root context carrying the registry, the slots, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(NS)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-files: dictionaries')
  ctx.effect(() => {
    let host: typeof ctx.remote.$host | undefined
    let remove: (() => void) | undefined
    const refresh = (): void => {
      const next = ctx.remote.$host
      if (host === next) return
      host = next
      remove?.()
      remove = undefined
      if (next.capabilities?.includes('workspace-files.list.v1') !== true) return
      const lifetime = new AbortController()
      const store = createFilesStore()
      const face = filesFace(createList(ctx.remote), lifetime.signal)
      const fileOpeners = {
        getSnapshot: () => ctx.sidebarRightTabs.entries(),
        subscribe: (listener: () => void) => ctx.sidebarRightTabs.subscribe(listener),
      }
      const dispose = ctx.effect(function* () {
        yield () => { lifetime.abort() }
        yield ctx.sidebarRightTabs.register(filesDefinition(t))
        yield ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab', key: FILES_ID, locale: NS, store,
            inject: (sessionId, actions): FilesRegistrationInjected => ({
              ...face(sessionId, actions), hooks: { fileOpeners },
              canOpenFile: address => !lifetime.signal.aborted && ctx.remote.$host === next
                && ctx.sidebarRightTabs.candidates(address).length > 0,
            }),
          }, FilesBody,
        ))
        yield ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: FILES_ID }, FilesTitle,
        ))
      }, 'ui-sidebar-files: admitted Host entries')
      remove = () => { lifetime.abort(); void dispose() }
    }
    refresh()
    const stop = ctx.on('connection/reset', refresh)
    return () => { stop(); remove?.() }
  }, 'ui-sidebar-files: Host lifecycle')
}
