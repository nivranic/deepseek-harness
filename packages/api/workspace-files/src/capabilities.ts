/** Versioned file operation sets owned by the Workspace Files Remote service. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** API support; filesystem access and Session scope remain Host-owned checks. */
export const WORKSPACE_FILES_REMOTE_CAPABILITIES = [
  { id: 'workspace-files.stat.v1', methods: ['stat'] },
  { id: 'workspace-files.list.v1', methods: ['list'] },
  { id: 'workspace-files.read-text.v1', methods: ['read'] },
  { id: 'workspace-files.read-bytes.v1', methods: ['readBytes'] },
  { id: 'workspace-files.read-all.v1', methods: ['readAll'] },
  { id: 'workspace-files.read-related.v1', methods: ['readRelated'] },
  { id: 'workspace-files.changes.v1', methods: ['changes'] },
] as const satisfies readonly TypertRemoteCapability[]
