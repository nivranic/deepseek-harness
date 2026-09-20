/**
 * The device_trust storage domain: one durable `grants` table keyed by
 * {@link DeviceId}. The spec object is the single source of the domain's
 * identity, version, layout, and record schema; the storage-domain routing
 * decides the medium (the shipped composition's json backend stores the
 * domain `single`: one complete document under `<root>/device_trust/`, right
 * for a grant set that rewrites wholesale on each ceremony step). Grants are
 * authoritative access data, so an invalid stored record rejects the open
 * instead of being skipped. Pending pairing codes stay process-local by
 * design: a one-time expiring secret must not survive a Host restart, and
 * the ceremony simply reissues after one.
 * @module @deepseek-ai/dsh-api-device-trust/src/spec
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { DeviceId } from './types.ts'

/**
 * One stored grant record: the full grant view minus the identity the table
 * key already carries. Values were semantically validated at the redemption
 * ceremony; the schema here enforces the durable boundary.
 */
export const deviceGrantRecord = z.object({
  deviceName: z.string().min(1),
  role: z.enum(['viewer', 'collaborator', 'controller', 'owner']),
  /** Base64 SPKI DER of the device's Ed25519 key, registered at redemption. */
  devicePublicKey: z.string().min(1),
  /** Lowercase hex SHA-256 of the SPKI DER. */
  keyFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  /** Epoch ms when the pairing was redeemed. */
  pairedAt: z.number().int().nonnegative(),
  /** Epoch ms of the newest accepted admission; the replay high-water mark. */
  lastAdmittedAt: z.number().int().nonnegative().optional(),
  /** Nonce of the newest accepted admission; exact-replay guard across restarts. */
  lastAdmittedNonce: z.string().min(1).optional(),
  /** Epoch ms when the grant was revoked; absent while active. */
  revokedAt: z.number().int().nonnegative().optional(),
})

/** One stored grant record, inferred from {@link deviceGrantRecord}. */
export type DeviceGrantRecord = z.infer<typeof deviceGrantRecord>

/** The device_trust domain spec: durable, schema-validated, rejecting open. */
export const deviceTrustDomainSpec = defineDomain({
  name: 'device_trust',
  version: 1,
  layout: 'single',
  tables: { grants: domainTable<DeviceId, DeviceGrantRecord>(deviceGrantRecord) },
})
