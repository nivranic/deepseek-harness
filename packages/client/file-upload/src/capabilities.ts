/** File staging support shared by the Remote and authenticated raw-byte carrier. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Upload support does not replace Session ownership or staged-receipt admission. */
export const FILE_UPLOAD_REMOTE_CAPABILITIES = [
  { id: 'file-upload.stage.v1', methods: ['upload'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
