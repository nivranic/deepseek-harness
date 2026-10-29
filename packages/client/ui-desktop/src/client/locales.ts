/** Locale bundles for the desktop preference rows. */

/** Locale keys the rows render; the option ids are keys verbatim. */
export type DesktopSettingsKey =
  | 'title' | 'description' | 'tray' | 'quit'
  | 'launchTitle' | 'launchDescription' | 'on' | 'off'
  | 'accessTitle' | 'accessDescription'
  | 'approvalTitle' | 'approvalDescription'
  | 'deviceNameTitle' | 'deviceNameDescription' | 'deviceNamePlaceholder'
  | 'devicesTitle' | 'devicesDescription'
  | 'lanListening' | 'lanStopped' | 'lanBindError'
  | 'pairNewDevice' | 'pairTitle' | 'pairDescription' | 'pairUnavailable' | 'pairManualCode'
  | 'noDevices' | 'revoke' | 'revoked' | 'observer' | 'controller' | 'administrator'
  | 'neverSeen' | 'loadFailed' | 'retry' | 'close'

/** English copy. */
export const en: Record<DesktopSettingsKey, string> = {
  title: 'On window close',
  description: 'What the top-right close button does: hide to the system tray, or quit the app.',
  tray: 'Minimize to tray',
  quit: 'Quit',
  launchTitle: 'Start at login',
  launchDescription: 'Launch the app hidden to the tray when you sign in, so opening it later is instant. Off by default.',
  on: 'On',
  off: 'Off',
  accessTitle: 'Cross-device access',
  accessDescription: 'Let paired phones and tablets reach this machine over the LAN through the remote link carrier. Off by default.',
  approvalTitle: 'Allow remote approval',
  approvalDescription: 'Let paired controllers answer approval and question prompts from their device. Seeing a prompt never implies this; off by default.',
  deviceNameTitle: 'Device name',
  deviceNameDescription: 'The name paired devices see for this machine. Leave empty to use the computer name.',
  deviceNamePlaceholder: 'Computer name',
  devicesTitle: 'Trusted devices',
  devicesDescription: "Phones and tablets paired with this machine. Revoking cuts a device's access on its next request.",
  lanListening: 'Listening for devices',
  lanStopped: 'Not listening — enable cross-device access to pair',
  lanBindError: 'Startup failed',
  pairNewDevice: 'Pair new device',
  pairTitle: 'Pair a device',
  pairDescription: 'Scan the code in the DeepSeek Harness companion app on the device you are pairing. The code works once and expires in five minutes.',
  pairUnavailable: 'Cross-device access is off; enable it before pairing.',
  pairManualCode: 'Manual code',
  noDevices: 'No devices paired yet.',
  revoke: 'Revoke',
  revoked: 'Revoked',
  observer: 'Observer',
  controller: 'Controller',
  administrator: 'Administrator',
  neverSeen: 'Not seen yet',
  loadFailed: 'Could not load the device list.',
  retry: 'Retry',
  close: 'Close',
}

/** Simplified Chinese copy. */
export const zh: Record<DesktopSettingsKey, string> = {
  title: '关闭窗口时',
  description: '点击右上角关闭按钮后的行为：缩小到系统托盘，或直接退出应用。',
  tray: '缩小到托盘',
  quit: '直接退出',
  launchTitle: '开机自启',
  launchDescription: '登录 Windows 时自动在托盘静默启动，之后打开窗口即刻可用。默认关闭。',
  on: '开启',
  off: '关闭',
  accessTitle: '跨设备访问',
  accessDescription: '允许已配对的手机和平板经局域网通过远程 link 载体接入本机。默认关闭。',
  approvalTitle: '允许远程审批',
  approvalDescription: '允许已配对的控制者在设备上回答审批与提问。能看到提示绝不等于能审批；默认关闭。',
  deviceNameTitle: '设备名称',
  deviceNameDescription: '已配对设备看到的本机名称。留空则使用计算机名。',
  deviceNamePlaceholder: '计算机名',
  devicesTitle: '受信设备',
  devicesDescription: '与本机完成配对的手机和平板。吊销后，设备的下一个请求即被拒绝。',
  lanListening: '正在等待设备连接',
  lanStopped: '未在监听——启用跨设备访问后才能配对',
  lanBindError: '启动失败',
  pairNewDevice: '配对新设备',
  pairTitle: '配对设备',
  pairDescription: '在要配对的设备上打开 DeepSeek Harness 伴侣应用并扫描此码。配对码一次性有效，五分钟后过期。',
  pairUnavailable: '跨设备访问已关闭；请先启用再配对。',
  pairManualCode: '手动输入码',
  noDevices: '还没有已配对的设备。',
  revoke: '吊销',
  revoked: '已吊销',
  observer: '观察者',
  controller: '控制者',
  administrator: '管理员',
  neverSeen: '尚未连接过',
  loadFailed: '设备列表加载失败。',
  retry: '重试',
  close: '关闭',
}
