/** File and image staging capabilities advertised by the Host. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Upload support does not replace Session ownership or staged-receipt admission. */
export const FILE_UPLOAD_REMOTE_CAPABILITIES = [
  { id: 'file-upload.stage.v1', methods: ['upload'], requiredPermission: 'prompt.send' },
  { id: 'file-upload.dedupe.v1', methods: ['uploadDedupe'], requiredPermission: 'prompt.send' },
  { id: 'image-upload.stage.v1', methods: ['uploadImage'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
