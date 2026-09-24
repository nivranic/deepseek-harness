/** Saved-Host roster section copy; the section owns its whole page. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '主机',
  'title': '已保存的主机',
  'subtitle': '本页到达过的 Host。切换后单次调用与流载体都指向所选 Host；回到本页 Host 可随时撤销选择。',
  'empty': '尚无已保存的主机',
  'refresh': '刷新',
  'current': '当前',
  'currentPage': '当前使用本页 Host',
  'useLocal': '回到本页 Host',
  'switch': '切换',
  'switchedTo': '已切换到 {name}',
  'forget': '忘记',
  'inProcess': '本页会话',
  'lastConnectedAt': '上次连接 {time}',
} satisfies Record<string, string>

/** The hosts section namespace key union. */
export type HostsLocaleKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en: Record<HostsLocaleKey, string> = {
  'nav': 'Hosts',
  'title': 'Saved Hosts',
  'subtitle': 'Hosts this page has reached. After a switch, unary calls and the stream carrier both target the selected Host; returning to the page Host clears the selection at any time.',
  'empty': 'No saved Hosts yet',
  'refresh': 'Refresh',
  'current': 'Current',
  'currentPage': 'Using the page Host',
  'useLocal': 'Back to the page Host',
  'switch': 'Switch',
  'switchedTo': 'Switched to {name}',
  'forget': 'Forget',
  'inProcess': 'In-page session',
  'lastConnectedAt': 'Last connected {time}',
}
