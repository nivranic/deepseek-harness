/** Versioned Workspace operation sets shared by Host advertisement and Client admission. */

import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** API support; directory access and registry membership remain Host-owned checks. */
export const WORKSPACE_REMOTE_CAPABILITIES = [
  { id: 'workspace.follow.v1', methods: ['follow'], requiredPermission: 'view' },
  { id: 'workspace.manage.v1', methods: ['create', 'rename', 'delete', 'insertBefore'], requiredPermission: 'prompt.send' },
  { id: 'workspace.sessions.v1', methods: ['archiveSession', 'insertSessionBefore'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]

/** Directory APIs; the Host advertises only the operation sets served by its composed picker. */
export const DIRECTORY_PICKER_REMOTE_CAPABILITIES = [
  { id: 'directory-picker.native.v1', methods: ['pick'], requiredPermission: 'view' },
  { id: 'directory-picker.browse.v1', methods: ['list'], requiredPermission: 'view' },
  { id: 'directory-picker.create.v1', methods: ['createDirectory'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
