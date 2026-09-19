/** `goal` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'phase.active': '进行中的目标',
  'phase.active.disarmed': '未运行的目标',
  'phase.paused': '已暂停的目标',
  'phase.blocked': '受阻的目标',
  'objective.aria': '目标内容',
  'commandInput.aria': '指令输入',
  'action.save': '保存目标',
  'action.cancel': '取消编辑',
  'action.pause': '暂停目标',
  'action.resume': '恢复目标',
  'action.edit': '编辑目标',
  'action.clear': '清除目标',
  'error.connectionChanged': '连接已变更，请重新选择目标操作',
  'error.requestFailed': '目标操作请求失败，请重试',
} satisfies Record<string, string>

/** The goal namespace key union. */
export type GoalKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'phase.active': 'Ongoing Goal',
  'phase.active.disarmed': 'Inactive Goal',
  'phase.paused': 'Paused Goal',
  'phase.blocked': 'Blocked Goal',
  'objective.aria': 'Goal objective',
  'commandInput.aria': 'Command input',
  'action.save': 'Save goal',
  'action.cancel': 'Cancel edit',
  'action.pause': 'Pause goal',
  'action.resume': 'Resume goal',
  'action.edit': 'Edit goal',
  'action.clear': 'Clear goal',
  'error.connectionChanged': 'The connection changed. Select the goal action again.',
  'error.requestFailed': 'The goal request failed. Retry the action.',
} satisfies Record<GoalKey, string>
