/** Telemetry consent section copy; the section owns its whole page. */

import type { TelemetryDataKind } from '@deepseek-ai/dsh-session-telemetry'

/** Section-level copy keys plus one name and one description key per data kind. */
export type TelemetrySettingsLocaleKey =
  | 'nav'
  | 'title'
  | 'subtitle'
  | 'restartHint'
  | 'loading'
  | 'readonlyHint'
  | 'writeNotApplied'
  | `kind.${TelemetryDataKind}`
  | `desc.${TelemetryDataKind}`

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '遥测',
  'title': '遥测共享',
  'subtitle': '选择此宿主可以共享哪些数据类别。每一类都是独立开关，且在你打开之前始终保持关闭。',
  'restartHint': '更改在应用重启后生效。',
  'loading': '正在读取遥测同意设置',
  'readonlyHint': '此宿主的设置文档不接受更改。',
  'writeNotApplied': '开关未移动：存储的同意状态已在别处变化，此处显示宿主当前值。',
  'kind.sessionTelemetry': '会话遥测',
  'kind.providerMetadata': '提供商元数据',
  'kind.relayMetadata': '中继元数据',
  'kind.deviceTrustMetadata': '设备信任元数据',
  'kind.crashDiagnostics': '崩溃诊断',
  'desc.sessionTelemetry': '镜像自会话日志的会话记录，按已配置的上报后端共享。',
  'desc.providerMetadata': '每次请求使用的 LLM 提供商与模型。',
  'desc.relayMetadata': '请求在客户端与宿主之间的中继方式。',
  'desc.deviceTrustMetadata': '已配对设备的身份事实，例如设备名称与密钥指纹。',
  'desc.crashDiagnostics': '应用崩溃时产生的诊断记录。',
} satisfies Record<TelemetrySettingsLocaleKey, string>

/** English dictionary, checked complete against the zh key set. */
export const en: Record<TelemetrySettingsLocaleKey, string> = {
  'nav': 'Telemetry',
  'title': 'Telemetry sharing',
  'subtitle': 'Choose which data categories this Host may share. Each category is a separate switch, and every category stays off until you switch it on.',
  'restartHint': 'Changes take effect after the application restarts.',
  'loading': 'Reading telemetry consent',
  'readonlyHint': 'The settings document of this Host does not accept changes.',
  'writeNotApplied': 'The switch did not move: the stored consent changed elsewhere, and the current Host value is shown.',
  'kind.sessionTelemetry': 'Session telemetry',
  'kind.providerMetadata': 'Provider metadata',
  'kind.relayMetadata': 'Relay metadata',
  'kind.deviceTrustMetadata': 'Device Trust metadata',
  'kind.crashDiagnostics': 'Crash diagnostics',
  'desc.sessionTelemetry': 'Session records mirrored from the session log, shared through the configured reporting backend.',
  'desc.providerMetadata': 'Which LLM provider and model each request used.',
  'desc.relayMetadata': 'How requests were relayed between the Client and the Host.',
  'desc.deviceTrustMetadata': 'Paired-device identity facts, such as device names and key fingerprints.',
  'desc.crashDiagnostics': 'Diagnostic records produced when the application crashes.',
}
