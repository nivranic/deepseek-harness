/** Independent discovery and execution promises owned by the command registry. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Catalog visibility does not authorize command execution or replace handler policy. */
export const COMMAND_REMOTE_CAPABILITIES = [
  { id: 'command.catalog.v1', methods: ['list'] },
  { id: 'command.execute.v1', methods: ['execute'] },
] as const satisfies readonly TypertRemoteCapability[]
