/** Operations exposed by an explicitly mounted native listener. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Only device administrators may read pairing transport metadata. */
export const NATIVE_REMOTE_CAPABILITIES = [
  { id: 'native-remote.info.v1', methods: ['describe'], requiredPermission: 'device.admin' },
] as const satisfies readonly TypertRemoteCapability[]
