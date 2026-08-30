/**
 * @deepseek-ai/dsh-link-contracts — the executable contract for the remote
 * link wire vocabulary. The zod schemas are pinned to the TypeScript protocol
 * types at compile time (`satisfies`), the golden fixtures are pinned to
 * both, and the declarative type table drives the generator that emits the
 * cross-language manifest, Swift, and Kotlin artifacts under `generated/`.
 * A change to any wire type fails typecheck here first, then the drift gate
 * until the generated artifacts are regenerated.
 * @module @deepseek-ai/dsh-link-contracts
 */

import type { LinkCarrierStatus, LinkHostDescription, LinkPairValue, LinkPairingPayload } from '@deepseek-ai/dsh-link-access/protocol'
import type { LinkDeviceValue, LinkStatusValue } from '@deepseek-ai/dsh-api-link-controller/types'
import { z } from 'zod'

/**
 * One field row in the declarative type table: a scalar, a device-role enum
 * reference, a literal constant, or a reference to another table type. The
 * discriminated union keeps constants and references non-optional where they
 * belong, so the emitter switches without fallbacks.
 */
export type ContractField =
  | { readonly name: string; readonly kind: 'string' | 'number' | 'boolean' | 'role'; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'const'; readonly value: string | number; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'object'; readonly ref: string; readonly optional?: boolean }

/** One wire type in the declarative table. */
export interface ContractType {
  /** Language-neutral type name used by every emitted artifact. */
  readonly name: string
  /** Union values when the type is an enum, or `object` for a struct. */
  readonly shape: readonly string[] | 'object'
  readonly fields: readonly ContractField[]
  /** Which fixture exercises this type, when one exists. */
  readonly fixture?: string
}

/**
 * The link wire vocabulary as one table: enum rows first, then objects in
 * dependency order. Field `kind` values beyond the primitives name the
 * semantic families Swift and Kotlin render with their own doc annotations.
 */
export const LINK_CONTRACT_TYPES: readonly ContractType[] = [
  {
    name: 'LinkDeviceRole',
    shape: ['observer', 'controller', 'administrator'],
    fields: [],
  },
  {
    name: 'LinkError',
    shape: ['link-unavailable', 'link-disabled', 'bad-request'],
    fields: [],
  },
  {
    name: 'LinkPairingPayload',
    shape: 'object',
    fixture: 'pairing-payload',
    fields: [
      { name: 'v', kind: 'const', value: 1 },
      { name: 'kind', kind: 'const', value: 'dsh-link-pairing' },
      { name: 'hostId', kind: 'string' },
      { name: 'hostName', kind: 'string' },
      { name: 'endpoint', kind: 'string' },
      { name: 'spkiFingerprint', kind: 'string' },
      { name: 'code', kind: 'string' },
      { name: 'expiresAt', kind: 'number' },
    ],
  },
  {
    name: 'LinkPairResponse',
    shape: 'object',
    fixture: 'pair-response',
    fields: [
      { name: 'deviceId', kind: 'string' },
      { name: 'hostId', kind: 'string' },
      { name: 'hostName', kind: 'string' },
      { name: 'role', kind: 'role' },
      { name: 'linkProtocolVersion', kind: 'number' },
    ],
  },
  {
    name: 'LinkSessionCapabilities',
    shape: 'object',
    fields: [
      { name: 'list', kind: 'boolean' },
      { name: 'history', kind: 'boolean' },
      { name: 'follow', kind: 'boolean' },
      { name: 'prompt', kind: 'boolean' },
      { name: 'cancel', kind: 'boolean' },
    ],
  },
  {
    name: 'LinkWorkspaceCapabilities',
    shape: 'object',
    fields: [{ name: 'follow', kind: 'boolean' }],
  },
  {
    name: 'LinkInteractionCapabilities',
    shape: 'object',
    fields: [
      { name: 'approval', kind: 'boolean' },
      { name: 'question', kind: 'boolean' },
    ],
  },
  {
    name: 'LinkCapabilities',
    shape: 'object',
    fields: [
      { name: 'session', kind: 'object', ref: 'LinkSessionCapabilities' },
      { name: 'workspace', kind: 'object', ref: 'LinkWorkspaceCapabilities' },
      { name: 'interaction', kind: 'object', ref: 'LinkInteractionCapabilities' },
    ],
  },
  {
    name: 'LinkHostDescription',
    shape: 'object',
    fixture: 'host-description',
    fields: [
      { name: 'linkProtocolVersion', kind: 'number' },
      { name: 'hostVersion', kind: 'string' },
      { name: 'hostId', kind: 'string' },
      { name: 'hostName', kind: 'string' },
      { name: 'runtimeClass', kind: 'string' },
      { name: 'sessionFormatVersion', kind: 'number' },
      { name: 'allowRemoteApproval', kind: 'boolean' },
      { name: 'capabilities', kind: 'object', ref: 'LinkCapabilities' },
    ],
  },
  {
    name: 'LinkCarrierStatus',
    shape: 'object',
    fixture: 'carrier-status',
    fields: [
      { name: 'listening', kind: 'boolean' },
      { name: 'endpoint', kind: 'string', optional: true },
      { name: 'spkiFingerprint', kind: 'string', optional: true },
      { name: 'bindError', kind: 'string', optional: true },
    ],
  },
  {
    name: 'LinkDeviceRecord',
    shape: 'object',
    fixture: 'device-record',
    fields: [
      { name: 'deviceId', kind: 'string' },
      { name: 'name', kind: 'string' },
      { name: 'role', kind: 'role' },
      { name: 'createdAt', kind: 'number' },
      { name: 'lastSeenAt', kind: 'number', optional: true },
      { name: 'revokedAt', kind: 'number', optional: true },
    ],
  },
  {
    name: 'LinkAdminStatus',
    shape: 'object',
    fixture: 'admin-status',
    fields: [
      { name: 'listening', kind: 'boolean' },
      { name: 'endpoint', kind: 'string', optional: true },
      { name: 'spkiFingerprint', kind: 'string', optional: true },
      { name: 'bindError', kind: 'string', optional: true },
      { name: 'hostName', kind: 'string' },
      { name: 'allowRemoteApproval', kind: 'boolean' },
      { name: 'deviceCount', kind: 'number' },
    ],
  },
]

/** Wire schema for a pairing QR payload; the fixture round-trips through it. */
export const LinkPairingPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.literal('dsh-link-pairing'),
  hostId: z.string(),
  hostName: z.string(),
  endpoint: z.string(),
  spkiFingerprint: z.string().regex(/^[0-9a-f]{64}$/u),
  code: z.string(),
  expiresAt: z.number().int(),
}) satisfies z.ZodType<LinkPairingPayload>

/** Wire schema for one trusted-device row; the public key never rides it. */
export const LinkDeviceRecordSchema = z.object({
  deviceId: z.string(),
  name: z.string(),
  role: z.enum(['observer', 'controller', 'administrator']),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int().optional(),
  revokedAt: z.number().int().optional(),
})

/** Wire schema for the local administration status row. */
export const LinkAdminStatusSchema = z.object({
  listening: z.boolean(),
  endpoint: z.string().optional(),
  spkiFingerprint: z.string().optional(),
  bindError: z.string().optional(),
  hostName: z.string(),
  allowRemoteApproval: z.boolean(),
  deviceCount: z.number().int(),
})

/** Stable failure codes the `link` namespace and the carrier share. */
export const LINK_FAILURE_CODES = ['link-unavailable', 'link-disabled', 'bad-request'] as const

/** One golden fixture: the wire bytes every language decodes identically. */
export interface ContractFixture {
  /** Table name this fixture exercises. */
  readonly type: string
  /** Fixture id, unique across the set. */
  readonly id: string
  /** The exact JSON the wire carries, pinned to the owning protocol type. */
  readonly value: LinkPairingPayload | LinkPairValue | LinkHostDescription | LinkCarrierStatus | LinkDeviceValue | LinkStatusValue
}

/** The golden fixtures; ids match the table's `fixture` rows. */
export const LINK_CONTRACT_FIXTURES: readonly ContractFixture[] = [
  {
    type: 'LinkPairingPayload',
    id: 'pairing-payload',
    value: {
      v: 1,
      kind: 'dsh-link-pairing',
      hostId: '9f2c1a44-1e6a-4a5e-b1d0-77c2f4a19a30',
      hostName: 'Studio Desk',
      endpoint: 'https://192.168.1.4:4931',
      spkiFingerprint: 'ab'.repeat(32),
      code: '7Kd9m2Xq4Lp8Rt3Vw6Yy1Zc5Bn8Qf2Hj',
      expiresAt: 1_807_315_200_000,
    } satisfies LinkPairingPayload,
  },
  {
    type: 'LinkPairResponse',
    id: 'pair-response',
    value: ({
      deviceId: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70',
      hostId: '9f2c1a44-1e6a-4a5e-b1d0-77c2f4a19a30',
      hostName: 'Studio Desk',
      role: 'controller',
      linkProtocolVersion: 1,
    }) satisfies LinkPairValue,
  },
  {
    type: 'LinkHostDescription',
    id: 'host-description',
    value: ({
      linkProtocolVersion: 1,
      hostVersion: '0.1.2-alpha.1',
      hostId: '9f2c1a44-1e6a-4a5e-b1d0-77c2f4a19a30',
      hostName: 'Studio Desk',
      runtimeClass: 'full',
      sessionFormatVersion: 0,
      allowRemoteApproval: false,
      capabilities: {
        session: { list: true, history: true, follow: true, prompt: true, cancel: true },
        workspace: { follow: true },
        interaction: { approval: false, question: false },
      },
    }) satisfies LinkHostDescription,
  },
  {
    type: 'LinkCarrierStatus',
    id: 'carrier-status',
    value: {
      listening: true,
      endpoint: 'https://192.168.1.4:4931',
      spkiFingerprint: 'ab'.repeat(32),
    } satisfies LinkCarrierStatus,
  },
  {
    type: 'LinkDeviceRecord',
    id: 'device-record',
    value: {
      deviceId: 'd4e5f6a7-b8c9-4d0e-9f1a-2b3c4d5e6f70',
      name: 'iPhone',
      role: 'controller',
      createdAt: 1_759_017_600_000,
      lastSeenAt: 1_759_106_000_000,
    } satisfies LinkDeviceValue,
  },
  {
    type: 'LinkAdminStatus',
    id: 'admin-status',
    value: {
      listening: false,
      bindError: 'EADDRINUSE listen',
      hostName: 'Studio Desk',
      allowRemoteApproval: false,
      deviceCount: 2,
    } satisfies LinkStatusValue,
  },
]
