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
import type { WorkspaceFilesListValue, WorkspaceFilesReadValue } from '@deepseek-ai/dsh-api-workspace-controller'
import type { SessionAttachmentValue, SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentCatalog, SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type { ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
// Type-only edges that pull each plugin's `SessionEventMap` merge into this
// program, so the session-event fixtures below can pin the merged payloads.
import type { GoalSnapshotChangeMeta } from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-tool-todo/types'
import { z } from 'zod'

export type { CompanionDomainState, CompanionGoal, CompanionImageRef, CompanionItem, CompanionRecord, CompanionTodo, CompanionToolCall, CompanionToolPhase } from './companion-fold.ts'
export { emptyCompanionDomain, foldCompanionDomain, foldCompanionRecord } from './companion-fold.ts'
export type { CompanionScenario, ConformanceArtifact } from './companion-scenarios.ts'
export type { LiteArtifact, LiteConformanceArtifact, LiteDomainState, LiteEvent, LiteFailure, LiteMessage, LiteScenario, LiteToolCall, LiteTurnEnd } from './lite-spec.ts'
export { foldLiteDomain, foldLiteEvent, generateLiteConformance, LITE_SCENARIOS } from './lite-spec.ts'
export { generateConformanceArtifacts, LINK_DOMAIN_SCENARIOS } from './companion-scenarios.ts'

/**
 * One field row in the declarative type table: a scalar, a reference to an
 * enum or object table row (single or array), a literal constant, or a
 * primitive array. The discriminated union keeps constants and references
 * non-optional where they belong, so the emitter switches without fallbacks.
 */
export type ContractField =
  | { readonly name: string; readonly kind: 'string' | 'number' | 'boolean'; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'const'; readonly value: string | number; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'object'; readonly ref: string; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'object-array'; readonly ref: string; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'string-array' | 'number-array'; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'enum'; readonly ref: string; readonly optional?: boolean }

/** One wire type in the declarative table. */
export interface ContractType {
  /** Language-neutral type name used by every emitted artifact. */
  readonly name: string
  /** Union values when the type is an enum, or `object` for a struct. */
  readonly shape: readonly string[] | 'object'
  readonly fields: readonly ContractField[]
  /** Which fixture exercises this type, when one exists. */
  readonly fixture?: string
  /**
   * Session event type tags whose `data` payload this object models. The
   * companion-rendered subset of the merge-extensible `SessionEventMap`; tags
   * must be values of the `LinkSessionEventKind` row.
   */
  readonly sessionEvents?: readonly string[]
  /**
   * Packed chunk-row tags whose `data` payload this object models; tags must
   * be values of the `LinkChunkRowKind` row.
   */
  readonly chunkRows?: readonly string[]
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
      { name: 'role', kind: 'enum', ref: 'LinkDeviceRole' },
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
      { name: 'role', kind: 'enum', ref: 'LinkDeviceRole' },
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
  {
    name: 'LinkSessionEventKind',
    shape: [
      'turn/start', 'turn/end', 'step/start', 'step/end',
      'user/message', 'assistant/chunk', 'assistant/message',
      'tool/call', 'tool/result',
      'plan/mode', 'todo/write', 'goal/change', 'session/end-seed',
    ],
    fields: [],
  },
  {
    name: 'LinkChunkRowKind',
    shape: ['chunkrow/text-chunks', 'chunkrow/reasoning-chunks', 'chunkrow/tool-call-chunks'],
    fields: [],
  },
  {
    name: 'LinkTodoStatus',
    shape: ['pending', 'in_progress', 'completed'],
    fields: [],
  },
  {
    name: 'LinkTurnEndReasonKind',
    shape: ['completed', 'aborted', 'blocked', 'error', 'max-tokens', 'interrupted'],
    fields: [],
  },
  {
    name: 'LinkGoalOperation',
    shape: ['create', 'edit', 'pause', 'resume', 'complete', 'block', 'clear'],
    fields: [],
  },
  {
    name: 'LinkGoalPhase',
    shape: ['active', 'paused', 'blocked', 'complete'],
    fields: [],
  },
  {
    name: 'LinkTodoItem',
    shape: 'object',
    fields: [
      { name: 'content', kind: 'string' },
      { name: 'status', kind: 'enum', ref: 'LinkTodoStatus' },
    ],
  },
  {
    name: 'LinkTodoWriteData',
    shape: 'object',
    sessionEvents: ['todo/write'],
    fixture: 'event-todo-write',
    fields: [
      { name: 'todos', kind: 'object-array', ref: 'LinkTodoItem' },
    ],
  },
  {
    name: 'LinkPlanModeData',
    shape: 'object',
    sessionEvents: ['plan/mode'],
    fixture: 'event-plan-mode',
    fields: [
      { name: 'active', kind: 'boolean' },
    ],
  },
  {
    name: 'LinkGoalBlockReason',
    shape: 'object',
    fields: [
      { name: 'code', kind: 'string' },
      { name: 'message', kind: 'string' },
    ],
  },
  {
    name: 'LinkGoalSnapshot',
    shape: 'object',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'revision', kind: 'number' },
      { name: 'objective', kind: 'string' },
      { name: 'phase', kind: 'enum', ref: 'LinkGoalPhase' },
      { name: 'blockedReason', kind: 'object', ref: 'LinkGoalBlockReason', optional: true },
      { name: 'maxGoalRounds', kind: 'number' },
    ],
  },
  {
    name: 'LinkGoalChangeData',
    shape: 'object',
    sessionEvents: ['goal/change'],
    fixture: 'event-goal-change',
    fields: [
      { name: 'kind', kind: 'const', value: 'goal/change' },
      { name: 'version', kind: 'const', value: 1 },
      { name: 'operation', kind: 'enum', ref: 'LinkGoalOperation' },
      { name: 'goal', kind: 'object', ref: 'LinkGoalSnapshot', optional: true },
      { name: 'roundsStarted', kind: 'number', optional: true },
      { name: 'createdAt', kind: 'number', optional: true },
      { name: 'updatedAt', kind: 'number', optional: true },
      { name: 'clearedAt', kind: 'number', optional: true },
    ],
  },
  {
    name: 'LinkTurnStartData',
    shape: 'object',
    sessionEvents: ['turn/start'],
    fixture: 'event-turn-start',
    fields: [
      { name: 'turn', kind: 'number' },
    ],
  },
  {
    name: 'LinkTurnEndReason',
    shape: 'object',
    fields: [
      { name: 'kind', kind: 'enum', ref: 'LinkTurnEndReasonKind' },
    ],
  },
  {
    name: 'LinkTurnEndData',
    shape: 'object',
    sessionEvents: ['turn/end'],
    fixture: 'event-turn-end',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'reason', kind: 'object', ref: 'LinkTurnEndReason' },
    ],
  },
  {
    name: 'LinkStepSpanData',
    shape: 'object',
    sessionEvents: ['step/start', 'step/end'],
    fixture: 'event-step-start',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'step', kind: 'number' },
    ],
  },
  {
    name: 'LinkMessageSource',
    shape: 'object',
    fields: [
      { name: 'kind', kind: 'string' },
      { name: 'plugin', kind: 'string', optional: true },
      { name: 'provider', kind: 'string', optional: true },
      { name: 'model', kind: 'string', optional: true },
      { name: 'callId', kind: 'string', optional: true },
    ],
  },
  {
    name: 'LinkContentBlock',
    shape: 'object',
    fields: [
      { name: 'type', kind: 'string' },
      { name: 'text', kind: 'string', optional: true },
      { name: 'toolCallId', kind: 'string', optional: true },
      { name: 'isError', kind: 'boolean', optional: true },
      { name: 'attachment', kind: 'object', ref: 'LinkImageAttachmentRef', optional: true },
      { name: 'content', kind: 'object-array', ref: 'LinkContentBlock', optional: true },
    ],
  },
  {
    name: 'LinkUserMessageData',
    shape: 'object',
    sessionEvents: ['user/message'],
    fixture: 'event-user-message',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'role', kind: 'const', value: 'user' },
      { name: 'content', kind: 'object-array', ref: 'LinkContentBlock' },
      { name: 'source', kind: 'object', ref: 'LinkMessageSource' },
    ],
  },
  {
    name: 'LinkStreamChunk',
    shape: 'object',
    fields: [
      { name: 'type', kind: 'string' },
      { name: 'index', kind: 'number', optional: true },
      { name: 'text', kind: 'string', optional: true },
    ],
  },
  {
    name: 'LinkAssistantChunkData',
    shape: 'object',
    sessionEvents: ['assistant/chunk'],
    fixture: 'event-assistant-chunk',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'step', kind: 'number' },
      { name: 'chunk', kind: 'object', ref: 'LinkStreamChunk' },
    ],
  },
  {
    name: 'LinkTokenUsage',
    shape: 'object',
    fields: [
      { name: 'inputTokens', kind: 'number' },
      { name: 'outputTokens', kind: 'number' },
      { name: 'totalTokens', kind: 'number', optional: true },
    ],
  },
  {
    name: 'LinkAssistantMessage',
    shape: 'object',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'role', kind: 'const', value: 'assistant' },
      { name: 'content', kind: 'object-array', ref: 'LinkContentBlock' },
      { name: 'source', kind: 'object', ref: 'LinkMessageSource' },
    ],
  },
  {
    name: 'LinkAssistantMessageData',
    shape: 'object',
    sessionEvents: ['assistant/message'],
    fixture: 'event-assistant-message',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'step', kind: 'number' },
      { name: 'message', kind: 'object', ref: 'LinkAssistantMessage' },
      { name: 'usage', kind: 'object', ref: 'LinkTokenUsage', optional: true },
      { name: 'interrupted', kind: 'boolean', optional: true },
    ],
  },
  {
    name: 'LinkToolCallData',
    shape: 'object',
    sessionEvents: ['tool/call'],
    fixture: 'event-tool-call',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'step', kind: 'number' },
      { name: 'callId', kind: 'string' },
      { name: 'name', kind: 'string' },
      { name: 'arguments', kind: 'string' },
    ],
  },
  {
    name: 'LinkToolError',
    shape: 'object',
    fields: [
      { name: 'name', kind: 'string' },
      { name: 'code', kind: 'string' },
    ],
  },
  {
    name: 'LinkToolResultMessage',
    shape: 'object',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'role', kind: 'const', value: 'user' },
      { name: 'content', kind: 'object-array', ref: 'LinkContentBlock' },
      { name: 'source', kind: 'object', ref: 'LinkMessageSource' },
    ],
  },
  {
    name: 'LinkToolResultData',
    shape: 'object',
    sessionEvents: ['tool/result'],
    fixture: 'event-tool-result',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'step', kind: 'number' },
      { name: 'message', kind: 'object', ref: 'LinkToolResultMessage' },
      { name: 'error', kind: 'object', ref: 'LinkToolError', optional: true },
    ],
  },
  {
    name: 'LinkTextChunksData',
    shape: 'object',
    chunkRows: ['chunkrow/text-chunks', 'chunkrow/reasoning-chunks'],
    fixture: 'chunkrow-text-chunks',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'step', kind: 'number' },
      { name: 'index', kind: 'number' },
      { name: 'dt', kind: 'number-array' },
      { name: 'texts', kind: 'string-array' },
    ],
  },
  {
    name: 'LinkToolCallChunksData',
    shape: 'object',
    chunkRows: ['chunkrow/tool-call-chunks'],
    fixture: 'chunkrow-tool-call-chunks',
    fields: [
      { name: 'turn', kind: 'number' },
      { name: 'step', kind: 'number' },
      { name: 'index', kind: 'number' },
      { name: 'dt', kind: 'number-array' },
      { name: 'id', kind: 'string' },
      { name: 'name', kind: 'string', optional: true },
      { name: 'args', kind: 'string-array' },
    ],
  },
  {
    name: 'LinkFileEntryType',
    shape: ['file', 'directory', 'other'],
    fields: [],
  },
  {
    name: 'LinkFileEntry',
    shape: 'object',
    fields: [
      { name: 'name', kind: 'string' },
      { name: 'type', kind: 'enum', ref: 'LinkFileEntryType' },
      { name: 'size', kind: 'number', optional: true },
    ],
  },
  {
    name: 'LinkFileListValue',
    shape: 'object',
    fixture: 'file-list',
    fields: [
      { name: 'path', kind: 'string' },
      { name: 'entries', kind: 'object-array', ref: 'LinkFileEntry' },
    ],
  },
  {
    name: 'LinkSubagentActivity',
    shape: ['running', 'inactive'],
    fields: [],
  },
  {
    name: 'LinkSubagentMode',
    shape: ['one-shot', 'continuable'],
    fields: [],
  },
  {
    name: 'LinkSubagentDiagnosticReason',
    shape: ['corrupt', 'unsupported', 'unavailable'],
    fields: [],
  },
  {
    name: 'LinkSubagentEntry',
    shape: 'object',
    fixture: 'subagent-entry',
    fields: [
      { name: 'kind', kind: 'const', value: 'child' },
      { name: 'id', kind: 'string' },
      { name: 'activity', kind: 'enum', ref: 'LinkSubagentActivity' },
      { name: 'hasChildren', kind: 'boolean' },
      { name: 'mode', kind: 'enum', ref: 'LinkSubagentMode' },
      { name: 'label', kind: 'string', optional: true },
      { name: 'reason', kind: 'enum', ref: 'LinkSubagentDiagnosticReason', optional: true },
    ],
  },
  {
    name: 'LinkSubagentCatalog',
    shape: 'object',
    fixture: 'subagent-catalog',
    fields: [
      { name: 'entries', kind: 'object-array', ref: 'LinkSubagentEntry' },
      { name: 'parentAvailable', kind: 'boolean' },
    ],
  },
  {
    name: 'LinkFileReadValue',
    shape: 'object',
    fixture: 'file-read',
    fields: [
      { name: 'content', kind: 'string' },
      { name: 'truncated', kind: 'boolean' },
      { name: 'size', kind: 'number' },
      { name: 'mediaType', kind: 'string' },
    ],
  },
  {
    name: 'LinkImageMediaType',
    shape: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    fields: [],
  },
  {
    name: 'LinkImageDimensions',
    shape: 'object',
    fields: [
      { name: 'width', kind: 'number' },
      { name: 'height', kind: 'number' },
    ],
  },
  {
    name: 'LinkImageAttachmentRef',
    shape: 'object',
    fixture: 'image-attachment-ref',
    fields: [
      { name: 'attachmentId', kind: 'string' },
      { name: 'mediaType', kind: 'enum', ref: 'LinkImageMediaType' },
      { name: 'bytes', kind: 'number' },
      { name: 'width', kind: 'number' },
      { name: 'height', kind: 'number' },
      { name: 'name', kind: 'string', optional: true },
      { name: 'originalDimensions', kind: 'object', ref: 'LinkImageDimensions', optional: true },
    ],
  },
  {
    name: 'LinkAttachmentReadValue',
    shape: 'object',
    fixture: 'attachment-read',
    fields: [
      { name: 'attachment', kind: 'object', ref: 'LinkImageAttachmentRef' },
      { name: 'data', kind: 'string' },
    ],
  },
  {
    name: 'LinkPromptImagePart',
    shape: 'object',
    fixture: 'prompt-image-part',
    fields: [
      { name: 'type', kind: 'const', value: 'image' },
      { name: 'mediaType', kind: 'enum', ref: 'LinkImageMediaType' },
      { name: 'data', kind: 'string' },
      { name: 'name', kind: 'string', optional: true },
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

/**
 * Payloads of the companion-rendered session events the table models. The
 * `SessionEventMap` is merge-extensible on the host; this union is the closed
 * subset a companion renders, so unknown event tags stay wire-valid and render
 * generically. Each member is pinned to the real payload type, so a host-side
 * change to any modeled payload fails typecheck here first.
 */
export type LinkSessionEventPayload =
  | SessionEventMap['turn/start']
  | SessionEventMap['turn/end']
  | SessionEventMap['step/start']
  | SessionEventMap['step/end']
  | SessionEventMap['user/message']
  | SessionEventMap['assistant/chunk']
  | SessionEventMap['assistant/message']
  | SessionEventMap['tool/call']
  | SessionEventMap['tool/result']
  | SessionEventMap['plan/mode']
  | SessionEventMap['todo/write']
  | SessionEventMap['goal/change']

/** `data` payloads of the packed chunk-row records the table models. */
export type LinkChunkRowPayload =
  | Extract<ChunkRow, { type: 'text-chunks' }>['data']
  | Extract<ChunkRow, { type: 'tool-call-chunks' }>['data']

/** One golden fixture: the wire bytes every language decodes identically. */
export interface ContractFixture {
  /** Table name this fixture exercises. */
  readonly type: string
  /** Fixture id, unique across the set. */
  readonly id: string
  /** The exact JSON the wire carries, pinned to the owning protocol type. */
  readonly value: LinkPairingPayload | LinkPairValue | LinkHostDescription | LinkCarrierStatus | LinkDeviceValue | LinkStatusValue
  | LinkSessionEventPayload | LinkChunkRowPayload | WorkspaceFilesListValue | WorkspaceFilesReadValue
  | SubagentListEntry | SubagentCatalog
  | ImageAttachmentRef | SessionAttachmentValue | Extract<SessionPromptRequest['content'][number], { type: 'image' }>
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
  {
    type: 'LinkTurnStartData',
    id: 'event-turn-start',
    value: { turn: 1 } satisfies SessionEventMap['turn/start'],
  },
  {
    type: 'LinkTurnEndData',
    id: 'event-turn-end',
    value: { turn: 1, reason: { kind: 'completed' } } satisfies SessionEventMap['turn/end'],
  },
  {
    type: 'LinkStepSpanData',
    id: 'event-step-start',
    value: { turn: 1, step: 1 } satisfies SessionEventMap['step/start'],
  },
  {
    type: 'LinkUserMessageData',
    id: 'event-user-message',
    value: {
      id: MessageId('m-user-1'),
      role: 'user',
      content: [{ type: 'text', text: '帮我把登录页改成液态玻璃风格' }],
      source: { kind: 'user' },
    } satisfies SessionEventMap['user/message'],
  },
  {
    type: 'LinkAssistantChunkData',
    id: 'event-assistant-chunk',
    value: {
      turn: 1,
      step: 1,
      chunk: { type: 'text-delta', index: 0, text: '你好' },
    } satisfies SessionEventMap['assistant/chunk'],
  },
  {
    type: 'LinkAssistantMessageData',
    id: 'event-assistant-message',
    value: {
      turn: 1,
      step: 1,
      message: {
        id: MessageId('m-assist-1'),
        role: 'assistant',
        content: [{ type: 'text', text: '已完成：登录页液态玻璃样式落地。' }],
        source: { kind: 'model', provider: 'deepseek', model: 'deepseek-chat' },
      },
      usage: { inputTokens: 120, outputTokens: 36, totalTokens: 156 },
    } satisfies SessionEventMap['assistant/message'],
  },
  {
    type: 'LinkToolCallData',
    id: 'event-tool-call',
    value: {
      turn: 1,
      step: 1,
      callId: ToolCallId('call-1'),
      name: 'write_file',
      arguments: '{"path":"Login.swift"}',
    } satisfies SessionEventMap['tool/call'],
  },
  {
    type: 'LinkToolResultData',
    id: 'event-tool-result',
    value: {
      turn: 1,
      step: 1,
      message: {
        id: MessageId('m-tool-1'),
        role: 'user',
        content: [{
          type: 'tool-result',
          toolCallId: ToolCallId('call-1'),
          content: [{ type: 'text', text: '已写入 42 行。' }],
        }],
        source: { kind: 'tool', callId: ToolCallId('call-1') },
      },
    } satisfies SessionEventMap['tool/result'],
  },
  {
    type: 'LinkPlanModeData',
    id: 'event-plan-mode',
    value: { active: true } satisfies SessionEventMap['plan/mode'],
  },
  {
    type: 'LinkTodoWriteData',
    id: 'event-todo-write',
    value: {
      todos: [
        { content: '编译伴侣应用', status: 'in_progress' },
        { content: '跑契约回放测试', status: 'pending' },
      ],
    } satisfies SessionEventMap['todo/write'],
  },
  {
    type: 'LinkGoalChangeData',
    id: 'event-goal-change',
    value: {
      kind: 'goal/change',
      version: 1,
      operation: 'create',
      // The brand constructor sits behind the heavy package root; a local
      // literal keeps this fixture free of that runtime edge.
      goal: { id: 'goal-1' as GoalId, revision: 1, objective: '发布 0.2 伴侣版', phase: 'active', maxGoalRounds: 12 },
      roundsStarted: 0,
      createdAt: 1_759_017_600_000,
      updatedAt: 1_759_017_600_000,
    } satisfies GoalSnapshotChangeMeta,
  },
  {
    type: 'LinkTextChunksData',
    id: 'chunkrow-text-chunks',
    value: {
      turn: 1,
      step: 1,
      index: 0,
      dt: [4, 6],
      texts: ['你好', '，构建'],
    } satisfies Extract<ChunkRow, { type: 'text-chunks' }>['data'],
  },
  {
    type: 'LinkToolCallChunksData',
    id: 'chunkrow-tool-call-chunks',
    value: {
      turn: 1,
      step: 1,
      index: 0,
      dt: [5],
      id: ToolCallId('call-1'),
      name: 'write_file',
      args: ['{"path"', ':["Log'],
    } satisfies Extract<ChunkRow, { type: 'tool-call-chunks' }>['data'],
  },
  {
    type: 'LinkFileListValue',
    id: 'file-list',
    value: {
      path: 'src',
      entries: [
        { name: 'app.ts', type: 'file', size: 24 },
        { name: 'lib', type: 'directory' },
      ],
    } satisfies WorkspaceFilesListValue,
  },
  {
    type: 'LinkSubagentEntry',
    id: 'subagent-entry',
    value: {
      kind: 'child',
      id: 'sa-1' as SessionId,
      activity: 'running',
      hasChildren: false,
      mode: 'continuable',
      label: '检索合约文档',
    } satisfies SubagentListEntry,
  },
  {
    type: 'LinkSubagentCatalog',
    id: 'subagent-catalog',
    value: {
      entries: [
        {
          kind: 'child',
          id: 'sa-1' as SessionId,
          activity: 'running',
          hasChildren: false,
          mode: 'continuable',
          label: '检索合约文档',
        },
      ],
      parentAvailable: true,
    } satisfies SubagentCatalog,
  },
  {
    type: 'LinkFileReadValue',
    id: 'file-read',
    value: {
      content: 'export const x = 1\n',
      truncated: false,
      size: 20,
      mediaType: 'text/typescript',
    } satisfies WorkspaceFilesReadValue,
  },
  {
    type: 'LinkImageAttachmentRef',
    id: 'image-attachment-ref',
    value: {
      attachmentId: AttachmentId('att-8f14e45fceea167a5a36dedd4bea2543'),
      mediaType: 'image/png',
      bytes: 52_444,
      width: 800,
      height: 600,
      name: 'screenshot.png',
      originalDimensions: { width: 1600, height: 1200 },
    } satisfies ImageAttachmentRef,
  },
  {
    type: 'LinkAttachmentReadValue',
    id: 'attachment-read',
    value: {
      attachment: {
        attachmentId: AttachmentId('att-8f14e45fceea167a5a36dedd4bea2543'),
        mediaType: 'image/png',
        bytes: 52_444,
        width: 800,
        height: 600,
        name: 'screenshot.png',
        originalDimensions: { width: 1600, height: 1200 },
      },
      data: 'iVBORw0KGgo=',
    } satisfies SessionAttachmentValue,
  },
  {
    type: 'LinkPromptImagePart',
    id: 'prompt-image-part',
    value: {
      type: 'image',
      mediaType: 'image/png',
      data: 'iVBORw0KGgo=',
      name: 'screenshot.png',
    } satisfies Extract<SessionPromptRequest['content'][number], { type: 'image' }>,
  },
]
