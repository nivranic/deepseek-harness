/** Durable file declarations and native action request fields. */
import type { PresentedFile } from '@deepseek-ai/dsh-tool-present/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'

/** Native file action selected by an explicit user gesture. */
export type PresentedAction = 'open' | 'reveal'

/** Serving Host information; file-manager names never derive from the browser's OS. */
export interface PresentedHost {
  name: string
  available: boolean
  fileManager: 'finder' | 'explorer' | 'directory' | null
}

/**
 * Validate a file declaration read from a Session log.
 * @param value - decoded durable data.
 * @returns whether the declaration contains a path and optional description.
 */
export function isPresentedFile(value: unknown): value is PresentedFile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { path, description } = value as Record<string, unknown>
  return typeof path === 'string' && path.trim().length > 0
    && (description === undefined || typeof description === 'string')
}

/**
 * Identify one declared file in transient Client action state.
 * @param sessionId - owning Session.
 * @param seq - deliverables/presented event sequence.
 * @param index - original index in the event's files array.
 * @returns stable key for the Session event and file index.
 */
export function presentedFileKey(sessionId: SessionId, seq: number, index: number): string {
  return JSON.stringify([sessionId, seq, index])
}

/**
 * Validate a delivery event before reading its turn or file declarations.
 * @param value - decoded durable event data.
 * @returns whether the event identifies a turn, call, and file list.
 */
export function isPresentedData(value: unknown): value is { turn: number; callId: ToolCallId; files: unknown[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { turn, callId, files } = value as Record<string, unknown>
  return typeof turn === 'number' && Number.isSafeInteger(turn) && turn >= 1
    && typeof callId === 'string' && callId.length > 0 && Array.isArray(files)
}

/**
 * Trailing path segment, the part that identifies the file at a glance.
 * @param path - Slash- or backslash-separated path.
 * @returns The final segment, or the whole string when separator-free.
 */
export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

/** Coordinates of a persisted declaration in the viewed Session. */
export interface PresentedFileRequest {
  readonly sessionId: SessionId
  readonly seq: number
  readonly index: number
}

/** Native command completion, without copying or returning file bytes. */
export interface PresentedFileActionValue {
  readonly completed: true
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No presented file matches the requested Session event and file index. */
    'presented-file/not-found': Record<string, never>
    /** The Host does not provide the requested native file action. */
    'presented-file/native-unavailable': Record<string, never>
    /** The presented file has no verified Host path for the requested action. */
    'presented-file/path-unavailable': Record<string, never>
    /** The presented file could not be resolved or the native action failed. */
    'presented-file/action-failed': Record<string, never>
  }
}
