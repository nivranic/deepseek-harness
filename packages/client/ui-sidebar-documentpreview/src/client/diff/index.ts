/** Builtin unified-diff metadata and keyed document-body registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { DiffBody, type DiffBodyInjected } from './DiffBody.tsx'
import { grammarLoadCount, subscribeGrammarLoaded } from '@deepseek-ai/dsh-client-ui-primitives'
import { en, zh } from './locales.ts'

/** Diff implementation identity, shared by metadata and the keyed slot. */
export const DIFF_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/diff'

/** File suffixes rendered by the builtin diff body. */
export const DIFF_EXTENSIONS = ['diff', 'patch'] as const

/**
 * Describe the builtin diff renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns metadata for unified-diff text files.
 */
export function diffBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return {
    id: DIFF_BODY_ID,
    extensions: DIFF_EXTENSIONS,
    priority: 'builtin',
    title,
    loading: 'text-pages',
  }
}

/** @param ctx - owning plugin context. Register localized metadata and the matching keyed document body. */
export function apply(ctx: Context): void {
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() })
  ctx.effect(() => ctx.locale.register('sidebarDiffPreview', { zh, en }))
  const t = ctx.locale.bind('sidebarDiffPreview')
  const grammars = { getSnapshot: grammarLoadCount, subscribe: subscribeGrammarLoaded }
  const fileOpeners = {
    getSnapshot: () => ctx.sidebarRightTabs.entries(),
    subscribe: (listener: () => void) => ctx.sidebarRightTabs.subscribe(listener),
  }
  ctx.effect(() => ctx.documentPreviews.register(diffBodyDefinition(() => t('title'))))
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    {
      name: 'sidebar.right.tab.document', key: DIFF_BODY_ID, locale: 'sidebarDiffPreview',
      inject: (): DiffBodyInjected => {
        const host = ctx.remote.$host
        return {
          hooks: { grammars, fileOpeners },
          canOpenFile: address => !lifetime.signal.aborted && ctx.remote.$host === host
            && ctx.sidebarRightTabs.candidates(address).length > 0,
        }
      },
    }, DiffBody,
  )))
}
