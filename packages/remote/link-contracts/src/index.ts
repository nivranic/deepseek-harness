/**
 * @deepseek-ai/dsh-link-contracts — the executable contract for the remote
 * link wire vocabulary. The zod schemas are pinned to the TypeScript protocol
 * types at compile time (`satisfies`), the golden fixtures are pinned to
 * both, and the declarative type table drives the generator that emits the
 * cross-language JSON Schema, manifest, Swift, and Kotlin artifacts under `generated/`.
 * A change to any wire type fails typecheck here first, then the drift gate
 * until the generated artifacts are regenerated.
 * @module @deepseek-ai/dsh-link-contracts
 */

import { LINK_API_PREFIX, LINK_CONTRACT_VERSION, LINK_DESCRIBE_PATH, LINK_DEVICE_ID_HEADER, LINK_PAIR_PATH, LINK_PROTOCOL_VERSION, LINK_SIGNATURE_HEADER, LINK_STREAM_PREFIX, LINK_TIMESTAMP_HEADER, REMOTE_INTERACTION_ANSWER_ENDPOINT, type LinkCarrierStatus, type LinkHostDescription, type LinkPairRequest, type LinkPairValue, type LinkPairingPayload } from '@deepseek-ai/dsh-link-access/protocol'
import type { LinkDeviceValue, LinkStatusValue } from '@deepseek-ai/dsh-api-link-controller/types'
import type { WorkspaceFilesListValue, WorkspaceFilesReadValue } from '@deepseek-ai/dsh-api-workspace-controller'
import type { SessionArtifactValue, SessionAttachmentValue, SessionHandoffArtifactRef, SessionHandoffContextRow, SessionHandoffProvenance, SessionHandoffSnapshot, SessionHandoffTodoRow, SessionHandoffValue, SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { ArtifactId } from '@deepseek-ai/dsh-artifact/types'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { SESSION_FORMAT_VERSION, type SessionEventMap, type SessionId } from '@deepseek-ai/dsh-session/types'
import type { SubagentCatalog, SubagentListEntry } from '@deepseek-ai/dsh-subagent'
import { MessageId, ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { ChunkRow } from '@deepseek-ai/dsh-session/chunk-rows'
import type { GoalId } from '@deepseek-ai/dsh-goal/types'
// Type-only edges that pull each plugin's `SessionEventMap` merge into this
// program, so the session-event fixtures below can pin the merged payloads.
import type { GoalSnapshotChangeMeta } from '@deepseek-ai/dsh-goal'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type {} from '@deepseek-ai/dsh-tool-todo/types'
import { z } from 'zod'
import { LINK_DOMAIN_ASSISTANT_MESSAGE_DATA, LINK_DOMAIN_TOOL_RESULT_DATA } from './companion-scenarios.ts'

export type { CompanionArtifact, CompanionArtifactStatus, CompanionDomainState, CompanionGoal, CompanionImageRef, CompanionItem, CompanionRecord, CompanionTodo, CompanionToolCall, CompanionToolPhase } from './companion-fold.ts'
export { emptyCompanionDomain, foldCompanionDomain, foldCompanionRecord } from './companion-fold.ts'
export type { CompanionScenario, ConformanceArtifact } from './companion-scenarios.ts'
export type { LiteArtifact, LiteConformanceArtifact, LiteDomainState, LiteEvent, LiteFailure, LiteMessage, LiteScenario, LiteToolCall, LiteTurnEnd } from './lite-spec.ts'
export { foldLiteDomain, foldLiteEvent, generateLiteConformance, LITE_SCENARIOS } from './lite-spec.ts'
export { generateConformanceArtifacts, LINK_DOMAIN_SCENARIOS } from './companion-scenarios.ts'

export { LINK_CONTRACT_VERSION }

/** Lossless JSON value carried by RPC, stream, and Remote Event protocol fields. */
export type LinkJsonValue = null | string | number | boolean | readonly LinkJsonValue[] | LinkJsonObject

/** JSON object whose values cross the Link without coercion or omission. */
export interface LinkJsonObject {
  readonly [key: string]: LinkJsonValue
}

/** Named Remote arguments nested below every unary request's `payload` field. */
export interface LinkRpcPayload {
  readonly args: LinkJsonObject
}

/** Complete Connection RPC request carried through the authenticated Link unary route. */
export interface LinkRpcRequestEnvelope {
  readonly type: 'client-request'
  readonly rpcId: string
  readonly method: string
  readonly payload: LinkRpcPayload
}

/** Structured refusal returned by an RPC or NDJSON stream. */
export interface LinkRpcError {
  readonly code: string
  readonly message: string
  readonly details: LinkJsonObject
}

/** Unary result; a successful void method omits `value`. */
export type LinkRpcResult =
  | { readonly ok: true; readonly value?: LinkJsonValue }
  | { readonly ok: false; readonly error: LinkRpcError }

/** Complete Connection RPC response returned through the authenticated Link unary route. */
export interface LinkRpcResponseEnvelope {
  readonly type: 'server-response'
  readonly rpcId: string
  readonly result: LinkRpcResult
}

/** Opening body for one authenticated Link NDJSON stream. */
export interface LinkStreamRequest {
  readonly args: LinkJsonObject
}

/** One Link NDJSON frame: a value, or a terminal structured error. */
export type LinkStreamFrame =
  | { readonly k: 'v'; readonly v?: LinkJsonValue }
  | { readonly k: 'e'; readonly c: string; readonly m: string; readonly d: LinkJsonObject }

/** Stable Host facts delivered with one established Remote Event generation. */
export interface LinkRemoteEventHostInfo {
  readonly home: string
}

/** Opening Remote Event frame carrying the Host-authoritative Client identity. */
export interface LinkRemoteEventReadyFrame {
  readonly type: 'ready'
  readonly clientId: string
  readonly host: LinkRemoteEventHostInfo
}

/** Fire-and-forget Host event delivered to the Native Client. */
export interface LinkRemoteEventEmitFrame {
  readonly type: 'emit'
  readonly event: string
  readonly args: readonly LinkJsonValue[]
}

/** One pending Agent-scoped waterfall delivered to the Native Client. */
export interface LinkRemoteEventWaterfallFrame {
  readonly type: 'waterfall'
  readonly event: string
  readonly eventId: string
  readonly agentId: string
  readonly request: LinkJsonObject
}

/** Cancellation of one pending waterfall delivery. */
export interface LinkRemoteEventCancelFrame {
  readonly type: 'cancel'
  readonly eventId: string
}

/** Error fields retained when a Native listener rejects a Host waterfall. */
export interface LinkRemoteEventRejection {
  readonly name: string
  readonly message: string
  readonly code?: string
  readonly details?: LinkJsonValue
}

/** Native response to one waterfall; a successful void result omits `value`. */
export type LinkRemoteEventOutcome =
  | { readonly kind: 'next' }
  | { readonly kind: 'result'; readonly value?: LinkJsonValue }
  | { readonly kind: 'rejected'; readonly error: LinkRemoteEventRejection }

/** Correlated response submitted through `$events/result`. */
export interface LinkRemoteEventResult {
  readonly clientId: string
  readonly eventId: string
  readonly outcome: LinkRemoteEventOutcome
}

/** One durable Session event carrying its monotonic sequence. */
export interface LinkSessionEventRecord {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: LinkJsonValue
  readonly sourceEventSeqs?: readonly number[]
  readonly surfaceOp?: LinkJsonValue
}

/** Opening follow frame whose cursor is the highest Session sequence it includes. */
export interface LinkSessionSnapshotFrame {
  readonly type: 'snapshot'
  readonly header: LinkJsonObject
  readonly cursor: number
  readonly records: readonly LinkJsonValue[]
  readonly hasMore: boolean
  readonly projections: LinkJsonObject
}

/** Machine-readable compatibility and carrier semantics emitted in the manifest. */
export const LINK_PROTOCOL_SEMANTICS = {
  linkProtocolVersion: LINK_PROTOCOL_VERSION,
  sessionFormatVersion: SESSION_FORMAT_VERSION,
  rpc: {
    requestArguments: 'payload.args',
    voidSuccess: 'ok-with-omitted-value',
    failure: 'structured-error',
  },
  stream: {
    requestArguments: 'args',
    frames: ['value', 'error'],
    cancellation: 'transport-abort',
  },
  remoteEvents: {
    downlink: ['ready', 'emit', 'waterfall', 'cancel'],
    resultOutcomes: ['next', 'result', 'rejected'],
    clientIdentity: 'ready.clientId',
  },
  sequence: {
    event: 'monotonic-seq',
    cursor: 'highest-included-seq',
    replay: 'ignore-seq-at-or-below-cursor',
  },
  compatibility: {
    unknownOptionalFields: 'ignore',
    unknownEventTypes: 'preserve',
    missingRequiredFields: 'reject',
  },
  routes: {
    pair: LINK_PAIR_PATH,
    describe: LINK_DESCRIBE_PATH,
    unaryPrefix: LINK_API_PREFIX,
    streamPrefix: LINK_STREAM_PREFIX,
    remoteEventStream: '$events',
    remoteEventResult: REMOTE_INTERACTION_ANSWER_ENDPOINT,
  },
  authenticationHeaders: {
    deviceId: LINK_DEVICE_ID_HEADER,
    timestamp: LINK_TIMESTAMP_HEADER,
    signature: LINK_SIGNATURE_HEADER,
  },
} as const

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
  | { readonly name: string; readonly kind: 'json' | 'json-object' | 'json-array'; readonly optional?: boolean }
  | { readonly name: string; readonly kind: 'enum'; readonly ref: string; readonly optional?: boolean }

/** One wire type in the declarative table. */
export interface ContractType {
  /** Language-neutral type name used by every emitted artifact. */
  readonly name: string
  /** Union values when the type is an enum, `object` for a struct, or `json` for the recursive value. */
  readonly shape: readonly string[] | 'object' | 'json'
  readonly fields: readonly ContractField[]
  /** Which fixture exercises this type, when one exists. */
  readonly fixture?: string
  /** Additional fixtures exercising semantic variants of the same wire type. */
  readonly additionalFixtures?: readonly string[]
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

/** Message fields shared by user-authored and tool-result user messages. */
const LINK_USER_MESSAGE_FIELDS = [
  { name: 'id', kind: 'string' },
  { name: 'role', kind: 'const', value: 'user' },
  { name: 'content', kind: 'object-array', ref: 'LinkContentBlock' },
  { name: 'source', kind: 'object', ref: 'LinkMessageSource' },
] as const satisfies readonly ContractField[]

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
    name: 'LinkJsonValue',
    shape: 'json',
    fields: [],
  },
  {
    name: 'LinkPairRequest',
    shape: 'object',
    fixture: 'pair-request',
    fields: [
      { name: 'code', kind: 'string' },
      { name: 'deviceName', kind: 'string' },
      { name: 'devicePublicKey', kind: 'string' },
    ],
  },
  {
    name: 'LinkRpcPayload',
    shape: 'object',
    fields: [{ name: 'args', kind: 'json-object' }],
  },
  {
    name: 'LinkRpcRequestEnvelope',
    shape: 'object',
    fixture: 'rpc-request',
    fields: [
      { name: 'type', kind: 'const', value: 'client-request' },
      { name: 'rpcId', kind: 'string' },
      { name: 'method', kind: 'string' },
      { name: 'payload', kind: 'object', ref: 'LinkRpcPayload' },
    ],
  },
  {
    name: 'LinkRpcError',
    shape: 'object',
    fields: [
      { name: 'code', kind: 'string' },
      { name: 'message', kind: 'string' },
      { name: 'details', kind: 'json-object' },
    ],
  },
  {
    name: 'LinkRpcResult',
    shape: 'object',
    fields: [
      { name: 'ok', kind: 'boolean' },
      { name: 'value', kind: 'json', optional: true },
      { name: 'error', kind: 'object', ref: 'LinkRpcError', optional: true },
    ],
  },
  {
    name: 'LinkRpcResponseEnvelope',
    shape: 'object',
    fixture: 'rpc-response-void',
    additionalFixtures: ['rpc-response-value', 'rpc-response-error'],
    fields: [
      { name: 'type', kind: 'const', value: 'server-response' },
      { name: 'rpcId', kind: 'string' },
      { name: 'result', kind: 'object', ref: 'LinkRpcResult' },
    ],
  },
  {
    name: 'LinkStreamRequest',
    shape: 'object',
    fixture: 'stream-request',
    fields: [{ name: 'args', kind: 'json-object' }],
  },
  {
    name: 'LinkStreamFrameKind',
    shape: ['v', 'e'],
    fields: [],
  },
  {
    name: 'LinkStreamFrame',
    shape: 'object',
    fixture: 'stream-error',
    additionalFixtures: ['stream-value'],
    fields: [
      { name: 'k', kind: 'enum', ref: 'LinkStreamFrameKind' },
      { name: 'v', kind: 'json', optional: true },
      { name: 'c', kind: 'string', optional: true },
      { name: 'm', kind: 'string', optional: true },
      { name: 'd', kind: 'json-object', optional: true },
    ],
  },
  {
    name: 'LinkRemoteEventFrameKind',
    shape: ['ready', 'emit', 'waterfall', 'cancel'],
    fields: [],
  },
  {
    name: 'LinkRemoteEventOutcomeKind',
    shape: ['next', 'result', 'rejected'],
    fields: [],
  },
  {
    name: 'LinkRemoteEventHostInfo',
    shape: 'object',
    fields: [{ name: 'home', kind: 'string' }],
  },
  {
    name: 'LinkRemoteEventReadyFrame',
    shape: 'object',
    fixture: 'remote-event-ready',
    fields: [
      { name: 'type', kind: 'const', value: 'ready' },
      { name: 'clientId', kind: 'string' },
      { name: 'host', kind: 'object', ref: 'LinkRemoteEventHostInfo' },
    ],
  },
  {
    name: 'LinkRemoteEventEmitFrame',
    shape: 'object',
    fixture: 'remote-event-emit',
    fields: [
      { name: 'type', kind: 'const', value: 'emit' },
      { name: 'event', kind: 'string' },
      { name: 'args', kind: 'json-array' },
    ],
  },
  {
    name: 'LinkRemoteEventWaterfallFrame',
    shape: 'object',
    fixture: 'remote-event-waterfall',
    fields: [
      { name: 'type', kind: 'const', value: 'waterfall' },
      { name: 'event', kind: 'string' },
      { name: 'eventId', kind: 'string' },
      { name: 'agentId', kind: 'string' },
      { name: 'request', kind: 'json-object' },
    ],
  },
  {
    name: 'LinkRemoteEventCancelFrame',
    shape: 'object',
    fixture: 'remote-event-cancel',
    fields: [
      { name: 'type', kind: 'const', value: 'cancel' },
      { name: 'eventId', kind: 'string' },
    ],
  },
  {
    name: 'LinkRemoteEventRejection',
    shape: 'object',
    fields: [
      { name: 'name', kind: 'string' },
      { name: 'message', kind: 'string' },
      { name: 'code', kind: 'string', optional: true },
      { name: 'details', kind: 'json', optional: true },
    ],
  },
  {
    name: 'LinkRemoteEventOutcome',
    shape: 'object',
    fields: [
      { name: 'kind', kind: 'enum', ref: 'LinkRemoteEventOutcomeKind' },
      { name: 'value', kind: 'json', optional: true },
      { name: 'error', kind: 'object', ref: 'LinkRemoteEventRejection', optional: true },
    ],
  },
  {
    name: 'LinkRemoteEventResult',
    shape: 'object',
    fixture: 'remote-event-result-void',
    additionalFixtures: [
      'remote-event-result-next',
      'remote-event-result-value',
      'remote-event-result-rejected',
    ],
    fields: [
      { name: 'clientId', kind: 'string' },
      { name: 'eventId', kind: 'string' },
      { name: 'outcome', kind: 'object', ref: 'LinkRemoteEventOutcome' },
    ],
  },
  {
    name: 'LinkSessionEventRecord',
    shape: 'object',
    fixture: 'session-event-record',
    fields: [
      { name: 'type', kind: 'string' },
      { name: 'seq', kind: 'number' },
      { name: 'time', kind: 'number' },
      { name: 'data', kind: 'json' },
      { name: 'sourceEventSeqs', kind: 'number-array', optional: true },
      { name: 'surfaceOp', kind: 'json', optional: true },
    ],
  },
  {
    name: 'LinkSessionSnapshotFrame',
    shape: 'object',
    fixture: 'session-snapshot-frame',
    fields: [
      { name: 'type', kind: 'const', value: 'snapshot' },
      { name: 'header', kind: 'json-object' },
      { name: 'cursor', kind: 'number' },
      { name: 'records', kind: 'json-array' },
      { name: 'hasMore', kind: 'boolean' },
      { name: 'projections', kind: 'json-object' },
    ],
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
      { name: 'contractVersion', kind: 'number' },
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
      'artifact/created', 'artifact/status',
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
    name: 'LinkArtifactStatus',
    shape: ['pending', 'ready', 'failed'],
    fields: [],
  },
  {
    name: 'LinkArtifactFormat',
    shape: ['text', 'bytes'],
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
    name: 'LinkArtifactCreatedData',
    shape: 'object',
    sessionEvents: ['artifact/created'],
    fixture: 'event-artifact-created',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'kind', kind: 'string' },
      { name: 'title', kind: 'string' },
      { name: 'format', kind: 'enum', ref: 'LinkArtifactFormat' },
    ],
  },
  {
    name: 'LinkArtifactStatusData',
    shape: 'object',
    sessionEvents: ['artifact/status'],
    fixture: 'event-artifact-status',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'status', kind: 'enum', ref: 'LinkArtifactStatus' },
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
    fields: LINK_USER_MESSAGE_FIELDS,
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
    fields: LINK_USER_MESSAGE_FIELDS,
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
      { name: 'activity', kind: 'enum', ref: 'LinkSubagentActivity', optional: true },
      { name: 'hasChildren', kind: 'boolean', optional: true },
      { name: 'mode', kind: 'enum', ref: 'LinkSubagentMode', optional: true },
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
    name: 'LinkArtifactReadValue',
    shape: 'object',
    fixture: 'artifact-read',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'kind', kind: 'string' },
      { name: 'title', kind: 'string' },
      { name: 'format', kind: 'enum', ref: 'LinkArtifactFormat' },
      { name: 'data', kind: 'string' },
      { name: 'truncated', kind: 'boolean' },
      { name: 'size', kind: 'number' },
    ],
  },
  {
    name: 'LinkHandoffContextRole',
    shape: ['user', 'assistant'],
    fields: [],
  },
  {
    name: 'LinkHandoffContextRow',
    shape: 'object',
    fixture: 'handoff-context-row',
    fields: [
      { name: 'role', kind: 'enum', ref: 'LinkHandoffContextRole' },
      { name: 'text', kind: 'string' },
    ],
  },
  {
    name: 'LinkHandoffTodo',
    shape: 'object',
    fixture: 'handoff-todo',
    fields: [
      { name: 'content', kind: 'string' },
      { name: 'status', kind: 'string' },
    ],
  },
  {
    name: 'LinkHandoffArtifactRef',
    shape: 'object',
    fixture: 'handoff-artifact-ref',
    fields: [
      { name: 'id', kind: 'string' },
      { name: 'kind', kind: 'string' },
      { name: 'title', kind: 'string' },
      { name: 'status', kind: 'enum', ref: 'LinkArtifactStatus' },
    ],
  },
  {
    name: 'LinkHandoffProvenance',
    shape: 'object',
    fixture: 'handoff-provenance',
    fields: [
      { name: 'deviceId', kind: 'string' },
      { name: 'platform', kind: 'string' },
      { name: 'at', kind: 'number' },
    ],
  },
  {
    name: 'LinkHandoffRuntime',
    shape: ['lite'],
    fields: [],
  },
  {
    name: 'LinkHandoffSnapshot',
    shape: 'object',
    fixture: 'handoff-snapshot',
    fields: [
      { name: 'sourceSessionId', kind: 'string' },
      { name: 'sourceRuntime', kind: 'enum', ref: 'LinkHandoffRuntime' },
      { name: 'requestedCapability', kind: 'string' },
      { name: 'recentContext', kind: 'object-array', ref: 'LinkHandoffContextRow' },
      { name: 'planActive', kind: 'boolean' },
      { name: 'todo', kind: 'object-array', ref: 'LinkHandoffTodo' },
      { name: 'artifactRefs', kind: 'object-array', ref: 'LinkHandoffArtifactRef' },
      { name: 'modelPreference', kind: 'string', optional: true },
      { name: 'provenance', kind: 'object', ref: 'LinkHandoffProvenance' },
    ],
  },
  {
    name: 'LinkHandoffValue',
    shape: 'object',
    fixture: 'handoff-value',
    fields: [
      { name: 'sessionId', kind: 'string' },
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

/** Recursive JSON parser shared by every pass-through Link protocol field. */
export const LinkJsonValueSchema: z.ZodType<LinkJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.string(),
  z.number().refine(value => !Object.is(value, -0)),
  z.boolean(),
  z.array(LinkJsonValueSchema),
  z.record(z.string(), LinkJsonValueSchema),
]))

/** JSON object parser for named Remote arguments and request records. */
export const LinkJsonObjectSchema: z.ZodType<LinkJsonObject> = z.record(z.string(), LinkJsonValueSchema)

const LinkRpcErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: LinkJsonObjectSchema,
}) satisfies z.ZodType<LinkRpcError>

const LinkRpcResultSchema = z.union([
  z.object({ ok: z.literal(true), value: LinkJsonValueSchema.optional() }).superRefine((value, issue) => {
    if (Object.hasOwn(value, 'value') && value.value === undefined) {
      issue.addIssue({ code: 'custom', message: 'an explicit RPC value must be JSON' })
    }
  }),
  z.object({ ok: z.literal(false), error: LinkRpcErrorSchema }),
]) as unknown as z.ZodType<LinkRpcResult>

/** Parser for the complete authenticated Link unary request. */
export const LinkRpcRequestEnvelopeSchema = z.object({
  type: z.literal('client-request'),
  rpcId: z.string().min(1),
  method: z.string().min(1),
  payload: z.object({ args: LinkJsonObjectSchema }),
}) satisfies z.ZodType<LinkRpcRequestEnvelope>

/** Parser for the complete Link unary response, including successful void calls. */
export const LinkRpcResponseEnvelopeSchema = z.object({
  type: z.literal('server-response'),
  rpcId: z.string().min(1),
  result: LinkRpcResultSchema,
}) as unknown as z.ZodType<LinkRpcResponseEnvelope>

/** Parser for the opening body of one authenticated Link NDJSON stream. */
export const LinkStreamRequestSchema = z.object({
  args: LinkJsonObjectSchema,
}) satisfies z.ZodType<LinkStreamRequest>

/** Parser for one value or terminal-error Link NDJSON frame. */
export const LinkStreamFrameSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('v'), v: LinkJsonValueSchema.optional() }),
  z.object({ k: z.literal('e'), c: z.string(), m: z.string(), d: LinkJsonObjectSchema }),
]) as unknown as z.ZodType<LinkStreamFrame>

const LinkRemoteEventHostInfoSchema = z.object({ home: z.string() }) satisfies z.ZodType<LinkRemoteEventHostInfo>
const LinkRemoteEventRejectionSchema = z.object({
  name: z.string().min(1),
  message: z.string(),
  code: z.string().optional(),
  details: LinkJsonValueSchema.optional(),
}) as unknown as z.ZodType<LinkRemoteEventRejection>
const LinkRemoteEventOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('next') }),
  z.object({ kind: z.literal('result'), value: LinkJsonValueSchema.optional() }).superRefine((value, issue) => {
    if (Object.hasOwn(value, 'value') && value.value === undefined) {
      issue.addIssue({ code: 'custom', message: 'an explicit result value must be JSON' })
    }
  }),
  z.object({ kind: z.literal('rejected'), error: LinkRemoteEventRejectionSchema }),
]) as unknown as z.ZodType<LinkRemoteEventOutcome>

/** Parser for every Host-to-Native Remote Event frame. */
export const LinkRemoteEventDownlinkSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), clientId: z.string().min(1), host: LinkRemoteEventHostInfoSchema }),
  z.object({ type: z.literal('emit'), event: z.string().min(1), args: z.array(LinkJsonValueSchema) }),
  z.object({
    type: z.literal('waterfall'),
    event: z.string().min(1),
    eventId: z.string().min(1),
    agentId: z.string().min(1),
    request: LinkJsonObjectSchema,
  }),
  z.object({ type: z.literal('cancel'), eventId: z.string().min(1) }),
]) satisfies z.ZodType<LinkRemoteEventReadyFrame | LinkRemoteEventEmitFrame | LinkRemoteEventWaterfallFrame | LinkRemoteEventCancelFrame>

/** Parser for one Native response submitted through `$events/result`. */
export const LinkRemoteEventResultSchema = z.object({
  clientId: z.string().min(1),
  eventId: z.string().min(1),
  outcome: LinkRemoteEventOutcomeSchema,
}) as unknown as z.ZodType<LinkRemoteEventResult>

/** Parser for one durable Session event with its monotonic sequence. */
export const LinkSessionEventRecordSchema = z.object({
  type: z.string().min(1),
  seq: z.number().int().nonnegative(),
  time: z.number().int(),
  data: LinkJsonValueSchema,
  sourceEventSeqs: z.array(z.number().int().nonnegative()).optional(),
  surfaceOp: LinkJsonValueSchema.optional(),
}) as unknown as z.ZodType<LinkSessionEventRecord>

/** Parser for the opening Session follow frame and its authoritative cursor. */
export const LinkSessionSnapshotFrameSchema = z.object({
  type: z.literal('snapshot'),
  header: LinkJsonObjectSchema,
  cursor: z.number().int().nonnegative(),
  records: z.array(LinkJsonValueSchema),
  hasMore: z.boolean(),
  projections: LinkJsonObjectSchema,
}) satisfies z.ZodType<LinkSessionSnapshotFrame>

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
  | SessionEventMap['artifact/created']
  | SessionEventMap['artifact/status']
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
  readonly value:
    | LinkPairRequest
    | LinkPairingPayload
    | LinkPairValue
    | LinkHostDescription
    | LinkCarrierStatus
    | LinkDeviceValue
    | LinkStatusValue
    | LinkRpcRequestEnvelope
    | LinkRpcResponseEnvelope
    | LinkStreamRequest
    | LinkStreamFrame
    | LinkRemoteEventReadyFrame
    | LinkRemoteEventEmitFrame
    | LinkRemoteEventWaterfallFrame
    | LinkRemoteEventCancelFrame
    | LinkRemoteEventResult
    | LinkSessionEventRecord
    | LinkSessionSnapshotFrame
    | LinkSessionEventPayload
    | LinkChunkRowPayload
    | WorkspaceFilesListValue
    | WorkspaceFilesReadValue
    | SubagentListEntry
    | SubagentCatalog
    | ImageAttachmentRef
    | SessionAttachmentValue
    | SessionArtifactValue
    | SessionHandoffSnapshot
    | SessionHandoffContextRow
    | SessionHandoffTodoRow
    | SessionHandoffArtifactRef
    | SessionHandoffProvenance
    | SessionHandoffValue
    | Extract<SessionPromptRequest['content'][number], { type: 'image' }>
}

/** The golden fixtures; ids match the table's `fixture` rows. */
export const LINK_CONTRACT_FIXTURES: readonly ContractFixture[] = [
  {
    type: 'LinkPairRequest',
    id: 'pair-request',
    value: {
      code: '7Kd9m2Xq4Lp8Rt3Vw6Yy1Zc5Bn8Qf2Hj',
      deviceName: 'iPhone',
      devicePublicKey: 'MCowBQYDK2VwAyEA7Q3b8a4v5gQbK1wOJrj2Hx0iC3y7z4xZ5k6m7n8p9qA=',
    } satisfies LinkPairRequest,
  },
  {
    type: 'LinkRpcRequestEnvelope',
    id: 'rpc-request',
    value: {
      type: 'client-request',
      rpcId: 'rpc-probe/echo',
      method: 'probe/echo',
      payload: { args: { value: 'hi' } },
    } satisfies LinkRpcRequestEnvelope,
  },
  {
    type: 'LinkRpcResponseEnvelope',
    id: 'rpc-response-void',
    value: {
      type: 'server-response',
      rpcId: 'rpc-session-cancel-1',
      result: { ok: true },
    } satisfies LinkRpcResponseEnvelope,
  },
  {
    type: 'LinkRpcResponseEnvelope',
    id: 'rpc-response-value',
    value: {
      type: 'server-response',
      rpcId: 'rpc-session-list-1',
      result: { ok: true, value: { sessions: [] } },
    } satisfies LinkRpcResponseEnvelope,
  },
  {
    type: 'LinkRpcResponseEnvelope',
    id: 'rpc-response-error',
    value: {
      type: 'server-response',
      rpcId: 'rpc-session-open-1',
      result: {
        ok: false,
        error: {
          code: 'session-not-found',
          message: 'Session not found.',
          details: { sessionId: 'session-missing' },
        },
      },
    } satisfies LinkRpcResponseEnvelope,
  },
  {
    type: 'LinkStreamRequest',
    id: 'stream-request',
    value: {
      args: { count: 2 },
    } satisfies LinkStreamRequest,
  },
  {
    type: 'LinkStreamFrame',
    id: 'stream-value',
    value: {
      k: 'v',
      v: { type: 'event', event: { type: 'turn/start', seq: 4, time: 1_759_017_600_000, data: { turn: 1 } } },
    } satisfies LinkStreamFrame,
  },
  {
    type: 'LinkStreamFrame',
    id: 'stream-error',
    value: {
      k: 'e',
      c: 'session-not-found',
      m: 'Session not found.',
      d: { sessionId: 'session-missing' },
    } satisfies LinkStreamFrame,
  },
  {
    type: 'LinkRemoteEventReadyFrame',
    id: 'remote-event-ready',
    value: {
      type: 'ready',
      clientId: 'client-generation-1',
      host: { home: '/Users/example' },
    } satisfies LinkRemoteEventReadyFrame,
  },
  {
    type: 'LinkRemoteEventEmitFrame',
    id: 'remote-event-emit',
    value: {
      type: 'emit',
      event: 'workspace/changed',
      args: [{ workspaceId: 'workspace-1' }],
    } satisfies LinkRemoteEventEmitFrame,
  },
  {
    type: 'LinkRemoteEventWaterfallFrame',
    id: 'remote-event-waterfall',
    value: {
      type: 'waterfall',
      event: 'approval/request',
      eventId: 'event-approval-1',
      agentId: 'agent-1',
      request: {
        toolName: 'bash',
        reason: 'Run the requested command?',
        sessionId: 'session-1',
      },
    } satisfies LinkRemoteEventWaterfallFrame,
  },
  {
    type: 'LinkRemoteEventCancelFrame',
    id: 'remote-event-cancel',
    value: { type: 'cancel', eventId: 'event-approval-1' } satisfies LinkRemoteEventCancelFrame,
  },
  {
    type: 'LinkRemoteEventResult',
    id: 'remote-event-result-next',
    value: {
      clientId: 'client-generation-1',
      eventId: 'event-approval-1',
      outcome: { kind: 'next' },
    } satisfies LinkRemoteEventResult,
  },
  {
    type: 'LinkRemoteEventResult',
    id: 'remote-event-result-value',
    value: {
      clientId: 'client-generation-1',
      eventId: 'event-approval-1',
      outcome: { kind: 'result', value: 'allowed-once' },
    } satisfies LinkRemoteEventResult,
  },
  {
    type: 'LinkRemoteEventResult',
    id: 'remote-event-result-void',
    value: {
      clientId: 'client-generation-1',
      eventId: 'event-question-1',
      outcome: { kind: 'result' },
    } satisfies LinkRemoteEventResult,
  },
  {
    type: 'LinkRemoteEventResult',
    id: 'remote-event-result-rejected',
    value: {
      clientId: 'client-generation-1',
      eventId: 'event-question-1',
      outcome: {
        kind: 'rejected',
        error: {
          name: 'InteractionError',
          message: 'The interaction is no longer pending.',
          code: 'NOT_PENDING',
          details: { retryable: false },
        },
      },
    } satisfies LinkRemoteEventResult,
  },
  {
    type: 'LinkSessionEventRecord',
    id: 'session-event-record',
    value: {
      type: 'assistant/message',
      seq: 12,
      time: 1_759_017_600_000,
      data: { turn: 1, step: 1, message: { role: 'assistant', content: [] } },
      sourceEventSeqs: [10, 11],
    } satisfies LinkSessionEventRecord,
  },
  {
    type: 'LinkSessionSnapshotFrame',
    id: 'session-snapshot-frame',
    value: {
      type: 'snapshot',
      header: { version: 0, id: 'session-1', createdAt: 1_759_017_000_000 },
      cursor: 12,
      records: [{ type: 'event', event: { type: 'turn/start', seq: 4, time: 1_759_017_600_000, data: { turn: 1 } } }],
      hasMore: false,
      projections: { asOfSeq: 12, values: {} },
    } satisfies LinkSessionSnapshotFrame,
  },
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
      contractVersion: LINK_CONTRACT_VERSION,
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
    value: LINK_DOMAIN_ASSISTANT_MESSAGE_DATA,
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
    value: LINK_DOMAIN_TOOL_RESULT_DATA,
  },
  {
    type: 'LinkArtifactCreatedData',
    id: 'event-artifact-created',
    value: { id: ArtifactId('art-0f4c'), kind: 'report', title: '迁移报告', format: 'text' } satisfies SessionEventMap['artifact/created'],
  },
  {
    type: 'LinkArtifactStatusData',
    id: 'event-artifact-status',
    value: { id: ArtifactId('art-0f4c'), status: 'ready' } satisfies SessionEventMap['artifact/status'],
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
    type: 'LinkHandoffContextRow',
    id: 'handoff-context-row',
    value: { role: 'user', text: '帮我跑一遍测试' } satisfies SessionHandoffContextRow,
  },
  {
    type: 'LinkHandoffTodo',
    id: 'handoff-todo',
    value: { content: '在宿主继续执行测试', status: 'pending' } satisfies SessionHandoffTodoRow,
  },
  {
    type: 'LinkHandoffArtifactRef',
    id: 'handoff-artifact-ref',
    value: { id: 'art-lite-1', kind: 'report', title: '本机报告', status: 'ready' } satisfies SessionHandoffArtifactRef,
  },
  {
    type: 'LinkHandoffProvenance',
    id: 'handoff-provenance',
    value: { deviceId: 'dev-phone', platform: 'ios', at: 1_782_000_000_000 } satisfies SessionHandoffProvenance,
  },
  {
    type: 'LinkHandoffSnapshot',
    id: 'handoff-snapshot',
    value: {
      sourceSessionId: 'lite-7f3a',
      sourceRuntime: 'lite',
      requestedCapability: 'run_tests',
      recentContext: [{ role: 'user', text: '帮我跑一遍测试' }],
      planActive: true,
      todo: [{ content: '在宿主继续执行测试', status: 'pending' }],
      artifactRefs: [{ id: 'art-lite-1', kind: 'report', title: '本机报告', status: 'ready' }],
      provenance: { deviceId: 'dev-phone', platform: 'ios', at: 1_782_000_000_000 },
    } satisfies SessionHandoffSnapshot,
  },
  {
    type: 'LinkHandoffValue',
    id: 'handoff-value',
    value: { sessionId: 'session-hnd-1' as SessionId } satisfies SessionHandoffValue,
  },
  {
    type: 'LinkArtifactReadValue',
    id: 'artifact-read',
    value: {
      id: 'art-0f4c',
      kind: 'report',
      title: '迁移报告',
      format: 'text',
      data: Buffer.from('# 迁移报告').toString('base64'),
      truncated: false,
      size: 6,
    } satisfies SessionArtifactValue,
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
