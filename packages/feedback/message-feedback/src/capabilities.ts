/** Independent message-feedback operations; Session ownership and CAS remain domain checks. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Support declarations shared by Host discovery and Client admission. */
export const MESSAGE_FEEDBACK_REMOTE_CAPABILITIES = [
  { id: 'feedback.message.read.v1', methods: ['list'] },
  { id: 'feedback.message.put.v1', methods: ['put'] },
  { id: 'feedback.message.delete.v1', methods: ['delete'] },
] as const satisfies readonly TypertRemoteCapability[]
