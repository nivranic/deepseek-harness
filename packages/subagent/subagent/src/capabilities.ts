/** Parent-addressed discovery and control promises owned by the Subagent Remote. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Operation support does not replace durable parent ownership or live delivery policy. */
export const SUBAGENT_REMOTE_CAPABILITIES = [
  { id: 'subagent.catalog.v1', methods: ['list'], requiredPermission: 'view' },
  { id: 'subagent.prompt.v1', methods: ['prompt'], requiredPermission: 'prompt.send' },
  { id: 'subagent.interrupt.v1', methods: ['interruptByParent'], requiredPermission: 'prompt.send' },
  { id: 'subagent.interrupt-turn.v1', methods: ['interruptTurnByParent'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
