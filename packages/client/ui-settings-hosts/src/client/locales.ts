/** Saved-Host roster section copy; the section owns its whole page. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '主机',
  'title': '已保存的主机',
  'subtitle': '本页到达过的 Host。切换后单次调用与流载体都指向所选 Host；回到本页 Host 可随时撤销选择。',
  'empty': '尚无已保存的主机',
  'current': '已选择',
  'currentPage': '当前使用本页 Host',
  'useLocal': '回到本页 Host',
  'switch': '切换',
  'switchedTo': '已选择 {name}',
  'pairingHint': '首次连接前，请使用目标主机当前的启动链接完成浏览器授权。此链接仅打开主机页面。',
  'openHost': '打开主机页面',
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
  'current': 'Selected',
  'currentPage': 'Using the page Host',
  'useLocal': 'Back to the page Host',
  'switch': 'Switch',
  'switchedTo': 'Selected {name}',
  'pairingHint': 'Before connecting for the first time, authorize this browser using the target Host’s current launch link. This link only opens its page.',
  'openHost': 'Open Host page',
  'forget': 'Forget',
  'inProcess': 'In-page session',
  'lastConnectedAt': 'Last connected {time}',
}
