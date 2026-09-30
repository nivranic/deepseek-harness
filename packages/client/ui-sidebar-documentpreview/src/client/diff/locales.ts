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
  copy: '复制差异',
  copyLoaded: '复制已加载的差异',
  copied: '已复制',
  copyFailed: '无法复制到剪贴板',
  openFile: '打开文件 {path}',
  viewSplit: '分屏视图',
  viewUnified: '统一视图',
}

/** English dictionary with the same keys. */
export const en = {
  title: 'Diff',
  empty: 'Empty diff file',
  copy: 'Copy diff',
  copyLoaded: 'Copy loaded diff',
  copied: 'Copied',
  copyFailed: 'Could not copy to clipboard',
  openFile: 'Open file {path}',
  viewSplit: 'Split view',
  viewUnified: 'Unified view',
} satisfies Record<keyof typeof zh, string>
