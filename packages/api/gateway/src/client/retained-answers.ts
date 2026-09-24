/** §15/§38 durable confirmed answers: retained interaction answers that survive a Client restart. */

import type { RemoteInteractionReplyScope } from './preparation.ts'
import { isRemoteJsonValue, type RemoteEventId, type RemoteEventRejection, type RemoteEventResult } from '../stream-protocol.ts'

/** One retained answer in wire shape: everything the replay path matches, nothing more. */
export interface RetainedAnswerRecord {
  /** Application reply scope the answer was given under. */
  readonly scope: RemoteInteractionReplyScope
  /** Delivered interaction revision the answer replied to. */
  readonly revision: number
  /** Completed listener outcome kept for one resend. */
  readonly outcome: RemoteEventResult['outcome']
}

/** Retention bound: the most recently retained answers survive a record. */
export const MAX_RETAINED_ANSWERS = 32

const STORAGE_KEY = 'dsh-retained-answers.v1'

/** Durable sink for retained answers; corrupt contents drop at parse, never crash boot. */
export interface RetainedAnswersPersistence {
  /** @returns the persisted serialized answers, when one exists. */
  read(): string | undefined
  /** @param value - serialized answers to persist. */
  write(value: string): void
}

/**
 * localStorage-backed persistence; compositions without storage (SSR, restricted) get none.
 * @returns the persistence adapter, or undefined when no storage exists.
 */
export function browserRetainedAnswersPersistence(): RetainedAnswersPersistence | undefined {
  const storage = (globalThis as { readonly localStorage?: Storage }).localStorage
  if (storage === undefined) return undefined
  return {
    read: () => storage.getItem(STORAGE_KEY) ?? undefined,
    write: (value) => { storage.setItem(STORAGE_KEY, value) },
  }
}

/**
 * Durable store of retained interaction answers: seeds from persisted records at
 * construction and mirrors every retain and removal back to the sink. Seeded
 * records replay only while the Host's pending snapshot still lists their id at
 * the same scope and revision; the opening-frame sweep clears everything else,
 * so a stored answer left behind by disposal is pruned on the next connection
 * instead of being replayed against a different Host.
 */
export class RetainedAnswersStore {
  private readonly records = new Map<RemoteEventId, RetainedAnswerRecord>()

  /**
   * @param persistence - durable sink; without one retention lives for this page session only.
   */
  constructor(private readonly persistence?: RetainedAnswersPersistence) {
    const raw = persistence?.read()
    if (raw === undefined) return
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Only the persisted answers' own JSON can fail here; a corrupt record set starts empty.
      return
    }
    if (!Array.isArray(parsed)) return
    const loaded = new Map<RemoteEventId, RetainedAnswerRecord>()
    for (const row of parsed) {
      const entry = parseEntry(row)
      if (entry !== undefined) loaded.set(entry[0], entry[1])
    }
    for (const [id, record] of [...loaded].slice(Math.max(0, loaded.size - MAX_RETAINED_ANSWERS))) {
      this.records.set(id, record)
    }
  }

  /** Read the retained answers.
   * @returns the current records keyed by Remote Event id.
   */
  snapshot(): ReadonlyMap<RemoteEventId, RetainedAnswerRecord> {
    return this.records
  }

  /**
   * Keep one answer for a later resend; the oldest entry drops past the cap.
   * @param id - Remote Event id the answer replies to.
   * @param record - scope, revision, and completed outcome to retain.
   */
  retain(id: RemoteEventId, record: RetainedAnswerRecord): void {
    this.records.set(id, record)
    for (const oldest of this.records.keys()) {
      if (this.records.size <= MAX_RETAINED_ANSWERS) break
      this.records.delete(oldest)
    }
    this.persist()
  }

  /**
   * Drop one retained answer; absent ids leave the store unchanged.
   * @param id - Remote Event id whose answer is no longer replayable.
   */
  remove(id: RemoteEventId): void {
    if (!this.records.delete(id)) return
    this.persist()
  }

  private persist(): void {
    this.persistence?.write(`${JSON.stringify([...this.records])}\n`)
  }
}

/** Durable-boundary validation for one persisted [id, record] entry. */
function parseEntry(row: unknown): readonly [RemoteEventId, RetainedAnswerRecord] | undefined {
  if (!Array.isArray(row) || row.length !== 2) return undefined
  const [id, value] = row as unknown as readonly [unknown, unknown]
  if (typeof id !== 'string' || id.length === 0) return undefined
  if (typeof value !== 'object' || value === null) return undefined
  const { scope, revision, outcome } = value as Record<string, unknown>
  if (typeof scope !== 'string' || scope.length === 0) return undefined
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) return undefined
  const parsed = parseOutcome(outcome)
  if (parsed === undefined) return undefined
  return [id as RemoteEventId, { scope: scope as RemoteInteractionReplyScope, revision, outcome: parsed }]
}

/** Durable-boundary validation mirroring the wire outcome vocabulary exactly. */
function parseOutcome(value: unknown): RemoteEventResult['outcome'] | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  if (record.kind === 'next' && hasExactKeys(record, ['kind'])) return { kind: 'next' }
  if (record.kind === 'result'
    && (hasExactKeys(record, ['kind']) || hasExactKeys(record, ['kind', 'value']))
    && (!Object.hasOwn(record, 'value') || isRemoteJsonValue(record.value))) {
    return Object.hasOwn(record, 'value') ? { kind: 'result', value: record.value } : { kind: 'result' }
  }
  if (record.kind === 'rejected' && hasExactKeys(record, ['kind', 'error'])) {
    const error = parseRejection(record.error)
    if (error !== undefined) return { kind: 'rejected', error }
  }
  return undefined
}

/** Durable-boundary validation for the retained rejection fields. */
function parseRejection(value: unknown): RemoteEventRejection | undefined {
  if (typeof value !== 'object' || value === null || !hasOnlyKeys(value, ['name', 'message', 'code', 'details'])) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (typeof record.name !== 'string' || typeof record.message !== 'string') return undefined
  if (record.code !== undefined && typeof record.code !== 'string') return undefined
  if (record.details !== undefined && !isRemoteJsonValue(record.details)) return undefined
  return {
    name: record.name,
    message: record.message,
    ...(record.code === undefined ? {} : { code: record.code }),
    ...(record.details === undefined ? {} : { details: record.details }),
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function hasOnlyKeys(value: object, keys: readonly string[]): boolean {
  return Reflect.ownKeys(value).every(key => typeof key === 'string' && keys.includes(key))
}
