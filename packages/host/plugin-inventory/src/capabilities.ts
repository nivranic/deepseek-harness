/** Read-only Loader and preset composition discovery support. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Inventory visibility does not authorize Loader or preset mutation. */
export const PLUGIN_INVENTORY_REMOTE_CAPABILITIES = [
  { id: 'plugin.inventory.v1', methods: ['list'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
