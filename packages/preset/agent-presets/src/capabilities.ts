/** Versioned Agent Preset operation sets shared by Host advertisement and Client admission. */

import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Live Remote methods required to advertise each Agent Preset operation set. */
export const AGENT_PRESET_REMOTE_CAPABILITIES = [
  { id: 'agent-preset.catalog.v1', methods: ['list', 'read'], requiredPermission: 'view' },
  { id: 'agent-preset.select.v1', methods: ['select'], requiredPermission: 'prompt.send' },
  { id: 'agent-preset.manage.v1', methods: ['copy', 'deletePreset'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
