/** Builtin binary metadata and keyed document-body registration. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../index.ts'
import type { DocumentPreviewDefinition } from '../document/registry.ts'
import { BinaryBody } from './BinaryBody.tsx'
import { en, zh } from './locales.ts'

/** Binary implementation identity, shared by metadata and the keyed slot. */
export const BINARY_BODY_ID = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/binary'

/** File suffixes presented by the builtin binary fact card. */
export const BINARY_EXTENSIONS = [
  '7z', 'a', 'aab', 'apk', 'bin', 'class', 'db', 'dll', 'dmg', 'dylib', 'eot', 'exe',
  'gz', 'ipa', 'iso', 'jar', 'lib', 'msix', 'obj', 'otf', 'pak', 'rar', 'so', 'sqlite',
  'tar', 'ttf', 'wasm', 'webarchive', 'woff', 'woff2', 'xz', 'zip',
] as const

/**
 * Describe the builtin binary renderer independently from its keyed body slot.
 * @param title - locale-owned implementation name.
 * @returns metadata for known-binary complete-byte files.
 */
export function binaryBodyDefinition(title: () => string): DocumentPreviewDefinition {
  return {
    id: BINARY_BODY_ID,
    extensions: BINARY_EXTENSIONS,
    priority: 'builtin',
    title,
    loading: 'bytes-complete',
  }
}

/** @param ctx - owning plugin context. Register localized metadata and the matching keyed document body. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('sidebarBinaryPreview', { zh, en }))
  const t = ctx.locale.bind('sidebarBinaryPreview')
  ctx.effect(() => ctx.documentPreviews.register(binaryBodyDefinition(() => t('title'))))
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: BINARY_BODY_ID, locale: 'sidebarBinaryPreview' }, BinaryBody,
  )))
}
