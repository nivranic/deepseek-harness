/** Host readiness section copy; the section owns its whole page. */

import type { ComponentHealth, HealthSnapshot } from '@deepseek-ai/dsh-api-host-diagnostics/client'

/** The six §41 health component names: every `HealthSnapshot` key except the derived `ready` verdict. */
export type HostStatusComponentName = Exclude<keyof HealthSnapshot, 'ready'>

/** Section-level copy keys plus one name key per health component and one state key per component state. */
export type HostStatusLocaleKey =
  | 'nav'
  | 'title'
  | 'subtitle'
  | 'ready'
  | 'notReady'
  | 'loading'
  | 'error'
  | 'retry'
  | `component.${HostStatusComponentName}`
  | `state.${ComponentHealth}`

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'nav': '宿主状态',
  'title': '宿主状态',
  'subtitle': '六个健康组件的当前状态，以及此宿主当前能否接受 Agent 请求的判定。',
  'ready': '可接受 Agent 请求',
  'notReady': '暂不能接受 Agent 请求',
  'loading': '正在读取宿主状态',
  'error': '无法读取宿主状态。',
  'retry': '重试',
  'component.process': '进程',
  'component.runtime': '运行时',
  'component.sessionStore': '会话存储',
  'component.pluginState': '插件状态',
  'component.connection': '连接',
  'component.modelProvider': '模型提供方',
  'state.up': '正常',
  'state.degraded': '降级',
  'state.down': '不可用',
} satisfies Record<HostStatusLocaleKey, string>

/** English dictionary, checked complete against the zh key set. */
export const en: Record<HostStatusLocaleKey, string> = {
  'nav': 'Host status',
  'title': 'Host status',
  'subtitle': 'The six health components and whether this Host can currently accept Agent requests.',
  'ready': 'Accepting agent requests',
  'notReady': 'Not accepting agent requests',
  'loading': 'Reading Host status',
  'error': 'The Host status could not be read.',
  'retry': 'Retry',
  'component.process': 'Process',
  'component.runtime': 'Runtime',
  'component.sessionStore': 'Session store',
  'component.pluginState': 'Plugin state',
  'component.connection': 'Connection',
  'component.modelProvider': 'Model provider',
  'state.up': 'Healthy',
  'state.degraded': 'Degraded',
  'state.down': 'Unavailable',
}
