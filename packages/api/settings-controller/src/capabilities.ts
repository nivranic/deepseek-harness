/** Versioned Settings operation sets shared by Host advertisement and Client admission. */

import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Required Remote methods; provider availability and permission are checked by each operation. */
export const SETTINGS_REMOTE_CAPABILITIES = [
  { id: 'settings.read.v1', methods: ['describe'] },
  { id: 'settings.write.v1', methods: ['update', 'replace', 'mutate'] },
  { id: 'settings.document-open.v1', methods: ['openSettingsDocument'] },
  { id: 'settings.agent-preset-directory.v1', methods: ['canOpenAgentPresetDirectory', 'openAgentPresetDirectory'] },
] as const satisfies readonly TypertRemoteCapability[]

/** Credential metadata and write-only value operations; no capability exposes secret reads. */
export const CREDENTIAL_REMOTE_CAPABILITIES = [
  { id: 'credentials.describe.v1', methods: ['describe'] },
  { id: 'credentials.write.v1', methods: ['set', 'unset'] },
] as const satisfies readonly TypertRemoteCapability[]
