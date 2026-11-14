/** Versioned LLM configuration operations shared by Host advertisement and Client admission. */

import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** API support; adapter availability and endpoint access remain operation-owned checks. */
export const LLM_REMOTE_CAPABILITIES = [
  { id: 'llm.providers.v1', methods: ['listProviders', 'listConfigurableProviders'], requiredPermission: 'view' },
  { id: 'llm.discover-models.v1', methods: ['discoverModels'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
