/**
 * Host-diagnostics operations advertised independently of authorization checks.
 * @module @deepseek-ai/dsh-api-host-diagnostics/capabilities
 */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Live host-diagnostics operations supported by the composed Remote owner. */
export const HOST_DIAGNOSTICS_REMOTE_CAPABILITIES = [
  { id: 'host.diagnostics.v1', methods: ['health', 'describe'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
