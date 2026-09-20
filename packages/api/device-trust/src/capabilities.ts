/**
 * Device-trust operations advertised independently of authorization checks.
 * @module @deepseek-ai/dsh-api-device-trust/capabilities
 */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Live device-trust operations supported by the composed Remote owner. */
export const DEVICE_TRUST_REMOTE_CAPABILITIES = [
  { id: 'device-pair.issue.v1', methods: ['issuePairing'] },
  { id: 'device-pair.redeem.v1', methods: ['redeemPairing'] },
  { id: 'device.list.v1', methods: ['listDevices'] },
  { id: 'device.revoke.v1', methods: ['revokeDevice'] },
] as const satisfies readonly TypertRemoteCapability[]
