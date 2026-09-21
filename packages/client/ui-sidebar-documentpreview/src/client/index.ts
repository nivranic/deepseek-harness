/**
 * Browser half: register `text` as a right-Sidebar tab type.
 *
 * The type reaches the Sidebar through its public path only: the definition into
 * `ctx.sidebarRightTabs`, the body into the keyed `sidebar.right.pane.tab`
 * seat, and the chip title into `sidebar.right.pane.tab.title`, both under the
 * definition's `id`. Nothing here reaches into the Sidebar's store, its
 * panes, or its sequence. The file's metadata comes from the standard
 * `useResource`, served by the `file` provider; the content is this type's own
 * business, read through its face. Every import from another
 * client plugin is a type.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-resources/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { WorkspaceFileParams } from '@deepseek-ai/dsh-api-workspace-files/client'
import { TextPreview } from './TextPreview.tsx'
import type { TextPreviewInjected } from './TextPreview.tsx'
import { TextTitle } from './TextTitle.tsx'
import { TEXTPREVIEW_ID, textDefinition } from './definition.ts'
import { textFace } from './face.ts'
import { createReadPage } from './rpc.ts'
import { createTextStore } from './store.ts'
import { en, zh } from './locales.ts'
import { admittedDocumentPreviews } from './document/admission.ts'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { DocumentPreviewRegistry, matchingDocumentPreviews } from './document/registry.ts'
import { documentTabInfoFactory } from './document/contract.ts'
import { apply as registerText, PLAIN_BODY_ID } from './text/index.ts'
import { apply as registerMarkdown } from './markdown/index.ts'
import { apply as registerHtml } from './html/index.ts'
import { apply as registerImage } from './image/index.ts'
import { apply as registerPdf } from './pdf/index.ts'
import { apply as registerCode } from './code/index.ts'

// Values stay package-private unless another package needs them; the plugin
// surface is `apply`, `inject`, and the store factory another registration may
// share, plus the types a consumer of the seat or the store names.
export type { SidebarDocumentPreviewKey } from './locales.ts'
export type { TextPreviewProps } from './TextPreview.tsx'
export type { TextInjected } from './face.ts'
export type { ReadWorkspaceFilePage, SessionFile, WorkspaceFilesReadRemote } from './rpc.ts'
export type { TextPage, TextState, TextStore, TextTabState } from './store.ts'
export type { DocumentContent, DocumentPreviewProps, DocumentTextPage } from './document/contract.ts'
export type { DocumentLoadMode, DocumentPreviewDefinition } from './document/registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** File-extension renderer registrations, independent from their keyed document bodies. */
    documentPreviews: DocumentPreviewRegistry
  }
}

/** This package's copy namespace. */
const NS = 'sidebarDocumentPreview'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightResourceParamsMap {
    /** File line navigation supported by the text preview. */
    file: WorkspaceFileParams
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Text-preview progress, paging, change, control, and failure lines. */
    sidebarDocumentPreview: import('./locales.ts').SidebarDocumentPreviewKey
  }
}

/**
 * Required browser services: the tab registry, the slot registry, copy, and the
 * Remote carrier with its `workspaceFiles` namespace.
 */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'remote', 'remote.workspaceFiles']

/**
 * Client plugin body: register the type, its dictionaries, its body, and its chip title.
 * @param ctx - client root context carrying the registry, the slots, copy, and the Remote face.
 */
export function apply(ctx: ClientContext): void {
  const previews = new DocumentPreviewRegistry()
  const disposePreviews = ctx.reflect.provide('documentPreviews', previews)
  ctx.effect(() => disposePreviews)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-sidebar-documentpreview: dictionaries')

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
      if (next.capabilities?.includes('workspace-files.stat.v1') !== true
        || !next.capabilities.includes('workspace-files.read-text.v1') && !next.capabilities.includes('workspace-files.read-all.v1')) return
      const capabilities = next.capabilities
      const lifetime = new AbortController()
      const dispose = ctx.effect(function* () {
        yield () => { lifetime.abort() }
        const store = createTextStore()
        const face = textFace(
          createReadPage(ctx.remote),
          (file, signal) => ctx.remote.workspaceFiles.readAll(file.sessionId, file.path, signal),
          lifetime.signal,
        )
        const source = admittedDocumentPreviews(previews, capabilities)
        yield ctx.sidebarRightTabs.register({
          ...textDefinition(),
          subscribeAvailability: listener => source.subscribe(listener),
          canOpen(address) {
            if (lifetime.signal.aborted || ctx.remote.$host !== next) return false
            const file = parseFileAddress(address)
            if (file?.scope !== 'session') return false
            const definitions = source.getSnapshot()
            return definitions.some(item => item.id === PLAIN_BODY_ID) || matchingDocumentPreviews(definitions, file.path).length > 0
          },
        })
        yield ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
          {
            name: 'sidebar.right.pane.tab', key: TEXTPREVIEW_ID, locale: NS, store,
            children: {
              'sidebar.right.tab.document': { kind: 'keyed', scope: 'session', inject: { hooks: { tabInfo: documentTabInfoFactory } } },
            },
            inject: (sessionId, actions): TextPreviewInjected => ({ ...face(sessionId, actions), hooks: { documentPreviews: source } }),
          },
          TextPreview,
        ))
        yield ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
          { name: 'sidebar.right.pane.tab.title', key: TEXTPREVIEW_ID },
          TextTitle,
        ))

      }, 'ui-sidebar-documentpreview: admitted Host entries')
      remove = () => { lifetime.abort(); void dispose() }
    }
    /* jscpd:ignore-end */
    refresh()
    const stop = ctx.on('connection/reset', refresh)
    return () => { stop(); remove?.() }
  }, 'ui-sidebar-documentpreview: Host lifecycle')
  registerText(ctx)
  registerMarkdown(ctx)
  registerHtml(ctx)
  registerImage(ctx)
  registerPdf(ctx)
  registerCode(ctx)
}
