/** `view-handoff` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'view-handoff'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action': '继续到其他设备',
  'copied': '已复制查看位置链接',
  'copyFailed': '复制失败，链接已显示',
  'scan': '在其他设备上扫码继续查看',
  'invalidLink': '查看位置链接无效，请重新复制链接',
  'wrongHost': '链接属于另一台主机，请打开原主机的页面',
  'unavailable': '连接已变化，请连接后重新打开链接',
  'openFailed': '无法打开查看位置，请确认会话仍可访问后重试',
} satisfies Record<string, string>

/** The view-handoff namespace key union. */
export type ViewHandoffKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<ViewHandoffKey, string> = {
  'action': 'Continue on another device',
  'copied': 'View-location link copied',
  'copyFailed': 'Copy failed; link shown instead',
  'scan': 'Scan on another device to continue viewing',
  'invalidLink': 'This view link is invalid. Copy a new link.',
  'wrongHost': 'This link belongs to another Host. Open its original page.',
  'unavailable': 'The connection changed. Connect and reopen the link.',
  'openFailed': 'The viewing position could not open. Check Session access and try again.',
}
