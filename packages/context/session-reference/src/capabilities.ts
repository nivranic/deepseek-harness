/** Session-reference discovery operations; preparing model context retains its own policy. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Candidate discovery without promising access to a source Session's message contents. */
export const SESSION_REFERENCE_REMOTE_CAPABILITIES = [
  { id: 'session-reference.candidates.v1', methods: ['candidates'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
