/** Locale-owned diff renderer name and row labels. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Diff document implementation name and empty-state copy. */
    sidebarDiffPreview: keyof typeof zh
  }
}

/** Simplified Chinese dictionary and key source. */
export const zh = {
  title: '差异',
  empty: '空的差异文件',
}

/** English dictionary with the same keys. */
export const en = {
  title: 'Diff',
  empty: 'Empty diff file',
} satisfies Record<keyof typeof zh, string>
