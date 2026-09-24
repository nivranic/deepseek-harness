/** Locale-owned binary renderer name and fact-card copy. */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Binary document implementation name and fact-card copy. */
    sidebarBinaryPreview: keyof typeof zh
  }
}

/** Simplified Chinese dictionary and key source. */
export const zh = {
  title: '二进制',
  binaryFile: '二进制文件，不以文本预览',
  bytes: '{count} 字节',
  emptyFile: '0 字节的空文件',
}

/** English dictionary with the same keys. */
export const en = {
  title: 'Binary',
  binaryFile: 'Binary file; not previewed as text',
  bytes: '{count} bytes',
  emptyFile: 'Empty file, 0 bytes',
} satisfies Record<keyof typeof zh, string>
