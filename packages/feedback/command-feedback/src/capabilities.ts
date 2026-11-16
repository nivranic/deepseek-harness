/** Session feedback Remote support, independent of slash-command execution. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Recording support does not promise disk flush or idempotent retries. */
export const SESSION_FEEDBACK_REMOTE_CAPABILITIES = [
  { id: 'feedback.session.record.v1', methods: ['record'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
