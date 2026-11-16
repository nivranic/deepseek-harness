/** Tool catalog promise shared by Host advertisement and Client admission. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/**
 * Descriptor visibility does not authorize tool execution: catalog reads are
 * view-grade, and dispatch still rides the driving prompt's permission plus
 * the full guarded tool pipeline.
 */
export const TOOL_REMOTE_CAPABILITIES = [
  { id: 'tool.catalog.v1', methods: ['list'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
