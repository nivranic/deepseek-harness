/** Goal operations advertised independently of authorization and revision checks. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Live Goal reads and mutations supported by the composed Remote owner. */
export const GOAL_REMOTE_CAPABILITIES = [
  { id: 'goal.read.v1', methods: ['get'] },
  { id: 'goal.create.v1', methods: ['create'] },
  { id: 'goal.edit.v1', methods: ['edit'] },
  { id: 'goal.pause.v1', methods: ['pause'] },
  { id: 'goal.resume.v1', methods: ['resume'] },
  { id: 'goal.complete.v1', methods: ['complete'] },
  { id: 'goal.clear.v1', methods: ['clear'] },
] as const satisfies readonly TypertRemoteCapability[]
