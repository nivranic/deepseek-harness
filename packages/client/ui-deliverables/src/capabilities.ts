/** Independent native file APIs; desktop configuration and path checks remain authoritative. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Operation declarations for the persisted-delivery Remote owner. */
export const PRESENTED_FILE_REMOTE_CAPABILITIES = [
  { id: 'presented-file.desktop.v1', methods: ['desktop'], requiredPermission: 'view' },
  { id: 'presented-file.open.v1', methods: ['open'], requiredPermission: 'view' },
  { id: 'presented-file.reveal.v1', methods: ['reveal'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
