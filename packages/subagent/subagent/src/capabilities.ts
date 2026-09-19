/** Parent-addressed discovery and control promises owned by the Subagent Remote. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Operation support does not replace durable parent ownership or live delivery policy. */
export const SUBAGENT_REMOTE_CAPABILITIES = [
  { id: 'subagent.catalog.v1', methods: ['list'] },
  { id: 'subagent.prompt.v1', methods: ['prompt'] },
  { id: 'subagent.interrupt.v1', methods: ['interruptByParent'] },
  { id: 'subagent.interrupt-turn.v1', methods: ['interruptTurnByParent'] },
] as const satisfies readonly TypertRemoteCapability[]
