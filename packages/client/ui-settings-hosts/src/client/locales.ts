/** Saved-Host roster section copy; the section owns its whole page. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '主机',
  'title': '已保存的主机',
  'subtitle': '本页保存的 Host。其他地址的主机需在其独立页面中访问。',
  'empty': '尚无已保存的主机',
  'current': '已选择',
  'currentPage': '当前使用本页 Host',
  'useLocal': '回到本页 Host',
  'switch': '切换',
  'switchedTo': '已选择 {name}',
  'moveUp': '上移',
  'moveDown': '下移',
  'rename': '重命名',
  'renameSave': '保存',
  'renameCancelled': '取消',
  'renameEmpty': '名称不能为空',
  'renameReset': '恢复原名',
  'pairingHint': '此主机无法在当前页面内连接，请打开它的独立页面。若需授权，请使用该主机当前的启动链接。',
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
  'subtitle': 'Hosts saved by this page. Visit Hosts at other addresses in their own pages.',
  'empty': 'No saved Hosts yet',
  'current': 'Selected',
  'currentPage': 'Using the page Host',
  'useLocal': 'Back to the page Host',
  'switch': 'Switch',
  'switchedTo': 'Selected {name}',
  'moveUp': 'Move up',
  'moveDown': 'Move down',
  'rename': 'Rename',
  'renameSave': 'Save',
  'renameCancelled': 'Cancel',
  'renameEmpty': 'The name cannot be empty',
  'renameReset': 'Reset name',
  'pairingHint': 'This Host cannot connect inside the current page. Open its own page; if authorization is needed, use that Host’s current launch link.',
  'openHost': 'Open Host page',
  'forget': 'Forget',
  'inProcess': 'In-page session',
  'lastConnectedAt': 'Last connected {time}',
}
