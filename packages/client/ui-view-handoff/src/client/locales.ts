/** `view-handoff` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'view-handoff'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action': '继续到其他设备',
  'copied': '已复制查看位置链接',
  'copyFailed': '复制失败，链接已显示',
} satisfies Record<string, string>

/** The view-handoff namespace key union. */
export type ViewHandoffKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<ViewHandoffKey, string> = {
  'action': 'Continue on another device',
  'copied': 'View-location link copied',
  'copyFailed': 'Copy failed; link shown instead',
}
