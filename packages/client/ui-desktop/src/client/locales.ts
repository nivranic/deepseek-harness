/** Locale bundles for the desktop close-button preference row. */

/** Locale keys the row renders; the two option ids are keys verbatim. */
export type DesktopSettingsKey = 'title' | 'description' | 'tray' | 'quit'

/** English copy. */
export const en: Record<DesktopSettingsKey, string> = {
  title: 'On window close',
  description: 'What the top-right close button does: hide to the system tray, or quit the app.',
  tray: 'Minimize to tray',
  quit: 'Quit',
}

/** Simplified Chinese copy. */
export const zh: Record<DesktopSettingsKey, string> = {
  title: '关闭窗口时',
  description: '点击右上角关闭按钮后的行为：缩小到系统托盘，或直接退出应用。',
  tray: '缩小到托盘',
  quit: '直接退出',
}
