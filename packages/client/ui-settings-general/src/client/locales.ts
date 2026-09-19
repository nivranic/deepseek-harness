/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'trigger': '设置',
  'title': '设置',
  'close': '关闭',
  'openDocument': '打开配置文件',
  'openDocument.error': '无法打开配置文件',
  'general.nav': '通用设置',
  'connection.hostNotReady': '等待 Host 就绪',
  'connection.waitAction': '尚未收到 Host 就绪响应，将继续等待并自动重试，也可点击立即重连',
  'connection.authExpired': '认证已失效',
  'connection.authenticateAction': '请通过此 Host 当前的启动链接重新认证，然后点击重连',
  'connection.incompatible': '版本不兼容',
  'connection.fatal': 'Host 数据不可用',
  'connection.updateAction': 'Host 与客户端不兼容，请更新应用后点击重连',
  'connection.repairAction': 'Host 数据无效或不可用，自动重试已暂停；请检查 Host 后点击重连',
  'connection.offline': '网络离线',
  'connection.retry': '立即重连',
  'connection.connecting': '正在连接',
  'connection.authenticating': '正在验证身份',
  'connection.authenticatingAction': '正在向 Host 验证身份，可点击立即重连',
  'connection.reconnecting': '自动重连中',
  'connection.startAction': '正在连接 Host，可点击立即重连',
  'connection.connected': '连接成功',
  'connection.reconnect': '网络离线，点击立即重连',
  'connection.restart': '连接中断，正在自动重试，点击立即重连',
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
  'connection.hostNotReady': 'Waiting for Host',
  'connection.waitAction': 'Host readiness is delayed. Waiting and retrying automatically; reconnect now',
  'connection.authExpired': 'Not authenticated',
  'connection.authenticateAction': 'Open this Host using its current launch link to authenticate, then reconnect',
  'connection.incompatible': 'Update required',
  'connection.fatal': 'Host data unavailable',
  'connection.updateAction': 'Host and Client are incompatible. Update the application, then reconnect',
  'connection.repairAction': 'Host data is invalid or unavailable. Automatic retries are paused; check Host, then reconnect',
  'connection.offline': 'Offline',
  'connection.retry': 'Reconnect now',
  'connection.connecting': 'Connecting',
  'connection.authenticating': 'Authenticating',
  'connection.authenticatingAction': 'Checking authentication with Host, reconnect now',
  'connection.reconnecting': 'Reconnecting',
  'connection.startAction': 'Connecting to Host, reconnect now',
  'connection.connected': 'Connected',
  'connection.reconnect': 'Offline, reconnect now',
  'connection.restart': 'Reconnecting automatically, reconnect now',
} satisfies Record<SettingsKey, string>
