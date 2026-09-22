/** `approval` namespace dictionaries. */

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  waiting: '等待审批',
  'detail.aria': '审批详情',
  escalation: '工具 {toolName} 请求越权执行',
  'fact.operation': '操作',
  'fact.host': 'Host',
  'fact.workspace': '工作区',
  'fact.risk': '风险',
  'fact.escalation': '权限提升',
  'fact.preview': '命令预览',
  'risk.low': '低风险',
  'risk.moderate': '中风险',
  'risk.high': '高风险',
  'risk.critical': '极高风险',
  reject: '拒绝',
  allowOnce: '允许一次',
} satisfies Record<string, string>

/** Approval dictionary key union. */
export type ApprovalKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  waiting: 'Waiting for approval',
  'detail.aria': 'Approval details',
  escalation: 'Tool {toolName} requests privileged execution',
  'fact.operation': 'Operation',
  'fact.host': 'Host',
  'fact.workspace': 'Workspace',
  'fact.risk': 'Risk',
  'fact.escalation': 'Permission escalation',
  'fact.preview': 'Command preview',
  'risk.low': 'Low risk',
  'risk.moderate': 'Moderate risk',
  'risk.high': 'High risk',
  'risk.critical': 'Critical risk',
  reject: 'Reject',
  allowOnce: 'Allow once',
} satisfies Record<ApprovalKey, string>
