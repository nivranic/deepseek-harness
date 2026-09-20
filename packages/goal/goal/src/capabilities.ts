/** Goal operations advertised independently of authorization and revision checks. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Live Goal reads and mutations supported by the composed Remote owner. */
export const GOAL_REMOTE_CAPABILITIES = [
  { id: 'goal.read.v1', methods: ['get'], requiredPermission: 'view' },
  { id: 'goal.create.v1', methods: ['create'], requiredPermission: 'prompt.send' },
  { id: 'goal.edit.v1', methods: ['edit'], requiredPermission: 'prompt.send' },
  { id: 'goal.pause.v1', methods: ['pause'], requiredPermission: 'prompt.send' },
  { id: 'goal.resume.v1', methods: ['resume'], requiredPermission: 'prompt.send' },
  { id: 'goal.complete.v1', methods: ['complete'], requiredPermission: 'prompt.send' },
  { id: 'goal.clear.v1', methods: ['clear'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
