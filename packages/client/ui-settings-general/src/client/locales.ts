/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'about.nav': '关于',
  'about.product': '产品',
  'about.version': '版本',
  'about.kernel': '内核',
  'about.electron': 'Electron',
  'about.node': 'Node.js',
  'about.os': '操作系统',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
  'about.nav': 'About',
  'about.product': 'Product',
  'about.version': 'Version',
  'about.kernel': 'Kernel',
  'about.electron': 'Electron',
  'about.node': 'Node.js',
  'about.os': 'Operating System',
} satisfies Record<SettingsKey, string>
