/** Builtin unified-diff metadata and keyed document-body registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { DiffBody } from './DiffBody.tsx'
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
  ctx.effect(() => ctx.locale.register('sidebarDiffPreview', { zh, en }))
  const t = ctx.locale.bind('sidebarDiffPreview')
  ctx.effect(() => ctx.documentPreviews.register(diffBodyDefinition(() => t('title'))))
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: DIFF_BODY_ID, locale: 'sidebarDiffPreview' }, DiffBody,
  )))
}
