/** Versioned file operation sets owned by the Workspace Files Remote service. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** API support; filesystem access and Session scope remain Host-owned checks. */
export const WORKSPACE_FILES_REMOTE_CAPABILITIES = [
  { id: 'workspace-files.stat.v1', methods: ['stat'], requiredPermission: 'view' },
  { id: 'workspace-files.list.v1', methods: ['list'], requiredPermission: 'view' },
  { id: 'workspace-files.read-text.v1', methods: ['read'], requiredPermission: 'view' },
  { id: 'workspace-files.read-bytes.v1', methods: ['readBytes'], requiredPermission: 'view' },
  { id: 'workspace-files.read-all.v1', methods: ['readAll'], requiredPermission: 'view' },
  { id: 'workspace-files.read-related.v1', methods: ['readRelated'], requiredPermission: 'view' },
  { id: 'workspace-files.changes.v1', methods: ['changes'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
