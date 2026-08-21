/** Locale bundles for the desktop preference rows. */

/** Locale keys the rows render; the option ids are keys verbatim. */
export type DesktopSettingsKey =
  | 'title' | 'description' | 'tray' | 'quit'
  | 'launchTitle' | 'launchDescription' | 'on' | 'off'

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
}
