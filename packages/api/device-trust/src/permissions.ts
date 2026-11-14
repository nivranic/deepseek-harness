/**
 * The section 21 role → permission table. Roles stay flat on purpose — the
 * first version does no arithmetic RBAC; each role names exactly the columns
 * the spec table checks for it.
 * @module @deepseek-ai/dsh-api-device-trust/permissions
 */

import type { DevicePermission, DeviceRole } from './types.ts'

/** Section 21 table: which permission columns each role holds. */
export const DEVICE_ROLE_PERMISSIONS: Readonly<Record<DeviceRole, readonly DevicePermission[]>> = {
  viewer: ['view'],
  collaborator: ['view', 'prompt.send', 'question.respond'],
  controller: ['view', 'prompt.send', 'question.respond', 'approval.respond'],
  owner: ['view', 'prompt.send', 'question.respond', 'approval.respond', 'device.admin'],
}
