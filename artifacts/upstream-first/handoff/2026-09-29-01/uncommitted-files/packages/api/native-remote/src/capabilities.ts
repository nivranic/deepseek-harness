/** Operations exposed by an explicitly mounted native listener. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Listener body budgets require viewing permission; pairing metadata remains administrator-only. */
export const NATIVE_REMOTE_CAPABILITIES = [
  { id: 'native-remote.info.v1', methods: ['describe'], requiredPermission: 'device.admin' },
  { id: 'native-remote.http-request-budget.v1', methods: ['httpRequestBudget'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
