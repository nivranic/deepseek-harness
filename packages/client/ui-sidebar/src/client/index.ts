/** Registers the sidebar shell and global panel navigation. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session root standard-props merge.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: declares the composer's input seats the drawer opener fills.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarPanelMetadata, SidebarRootInjected } from './contract/slots.ts'
import { PhoneDrawerButton } from './PhoneDrawerButton.tsx'
import { SessionsBackButton } from './SessionsBackButton.tsx'
import { SidebarRoot } from './SidebarRoot.tsx'
import { en, zh, type SidebarKey } from './locales.ts'

export type {
  SidebarBrandMarkOwnerProps, SidebarBrandNameOwnerProps, SidebarFooterActionOwnerProps,
  SidebarPanelIconOwnerProps, SidebarPanelMetadata,
  SidebarRootComponentProps, SidebarRootInjected, SidebarSectionOwnerProps, SidebarSettingsOwnerProps,
} from './contract/slots.ts'
export type { SidebarKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Sidebar controls and global panel copy. */
    sidebar: SidebarKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'sidebar'

interface WorkspaceNavigation {
  startSession(workspaceId?: Parameters<SidebarRootInjected['startSession']>[0]): void
}

/** Services required by the sidebar plugin. */
export const inject = ['slots', 'layout', 'uiWorkspace', 'locale', 'remote']

/** Registers the sidebar shell and its service callbacks.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const workspaceNavigation = ctx.get('uiWorkspace') as unknown as WorkspaceNavigation
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar: dictionaries')
  const panels = createSnapshotStore<readonly SidebarPanelMetadata[]>([])
  const sessionManagement: SidebarRootInjected['hooks']['sessionManagement'] = {
    getSnapshot: () => ctx.remote.$host.capabilities?.includes('session.manage.v1') === true,
    subscribe: listener => ctx.on('connection/reset', listener),
  }
  const syncPanels = (): void => {
    const next = ctx.slots.entriesOfSlot('sidebar.panellist').map(({ options }) => {
      // The list registration requires an id; StoredEntry erases the slot kind.
      const id = options.id as MainPanelId
      return { id, order: options.order ?? 0, label: resolveSlotLabel(options.label) ?? id }
    }).sort((a, b) => a.order - b.order)
    const previous = panels.getSnapshot()
    if (previous.length === next.length && previous.every((panel, index) => {
      const candidate = next[index] as SidebarPanelMetadata
      return panel.id === candidate.id && panel.order === candidate.order && panel.label === candidate.label
    })) return
    panels.set(next)
  }
  ctx.effect(() => ctx.slots.subscribe('sidebar.panellist', syncPanels), 'ui-sidebar: panel entries')
  ctx.effect(() => ctx.locale.subscribe(syncPanels), 'ui-sidebar: panel labels')

  const injectProps = (): SidebarRootInjected => ({
    // The shell's New Session button rides the Workspace UI's shared action
    // (current Session Workspace, then recent Workspace).
    startSession: (workspaceId) => {
      if (sessionManagement.getSnapshot()) workspaceNavigation.startSession(workspaceId)
    },
    toggleSidebar: () => { ctx.layout.toggleSidebar() },
    selectPanel: (id) => { ctx.layout.selectPanel(id) },
    hooks: { panels, sessionManagement },
  })
  ctx.slots.inject('sidebar', () => ctx.slots.register({
    name: 'sidebar',
    locale: NS,
    children: {
      'sidebar.brand.mark': { kind: 'single', scope: 'root' },
      'sidebar.brand.name': { kind: 'single', scope: 'root' },
      'sidebar.panellist': { kind: 'list', scope: 'root' },
      'sidebar.workspaces': { kind: 'single', scope: 'root' },
      'sidebar.settings': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
    inject: injectProps,
  }, SidebarRoot))
  // Phone-tier drawer opener (specification §7): the composer's left edge is
  // the one seat mounted in every state — blank hero and active conversation
  // alike — so the drawer stays reachable after the frame drops the rail.
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'sidebar.phoneDrawer',
    locale: NS,
    inject: () => ({ toggleSidebar: () => { ctx.layout.toggleSidebar() } }),
  }, PhoneDrawerButton))
  // Phone-tier conversation-page back affordance (specification §10 top
  // bar): the session header's leading seat, opening the same drawer.
  ctx.slots.inject('conversation.session.header.leading', () => ctx.slots.register({
    name: 'conversation.session.header.leading',
    id: 'sidebar.phoneBack',
    locale: NS,
    inject: () => ({ toggleSidebar: () => { ctx.layout.toggleSidebar() } }),
  }, SessionsBackButton))
  syncPanels()
}
