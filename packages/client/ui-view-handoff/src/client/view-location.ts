/** Versioned, browser-local link payload; it grants no access to the addressed Session. */
import type { HostId } from '@deepseek-ai/dsh-api-remotes/client'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** Durable identity and turn anchor carried between authenticated pages. */
export interface SessionViewLocation {
  readonly hostId: HostId
  readonly sessionId: SessionId
  readonly anchorSeq: SessionSeq
}

/** Failure categories localized by the receiving page. */
export type HandoffFailureKind = 'invalidLink' | 'wrongHost' | 'unavailable' | 'openFailed'

/** Expected link or admission failure; no payload contents enter its message. */
export class HandoffFailure extends Error {
  /** @param kind - localized failure category. */
  constructor(readonly kind: HandoffFailureKind) { super(`View handoff: ${kind}`) }
}

const PREFIX = 'dsh-session-view.v1.'

/**
 * Encode the existing v1 grammar as an ASCII base64url fragment value.
 * @param location - validated Host, Session, and durable anchor.
 * @returns link-safe payload without credentials or session content.
 */
export function encodeSessionViewLocation(location: SessionViewLocation): string {
  const json = JSON.stringify(location)
  if (!/^[\x20-\x7E]*$/u.test(json)) throw new HandoffFailure('invalidLink')
  return PREFIX + btoa(json).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

/**
 * Decode untrusted link data before any Session lookup.
 * @param encoded - prefixed v1 base64url payload.
 * @returns branded identities and a nonnegative durable sequence.
 * @throws HandoffFailure when the payload does not match the v1 grammar.
 */
export function decodeSessionViewLocation(encoded: string): SessionViewLocation {
  if (!encoded.startsWith(PREFIX)) throw new HandoffFailure('invalidLink')
  const body = encoded.slice(PREFIX.length)
  if (!/^[A-Za-z0-9_-]+$/u.test(body)) throw new HandoffFailure('invalidLink')
  let json: string
  try {
    json = atob(body.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - body.length % 4) % 4))
  } catch (_invalidBase64) {
    throw new HandoffFailure('invalidLink')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (_invalidJson) {
    throw new HandoffFailure('invalidLink')
  }
  if (typeof parsed !== 'object' || parsed === null) throw new HandoffFailure('invalidLink')
  const record = parsed as Record<string, unknown>
  if (Object.keys(record).length !== 3
    || typeof record.hostId !== 'string' || record.hostId === ''
    || typeof record.sessionId !== 'string' || record.sessionId === ''
    || typeof record.anchorSeq !== 'number' || !Number.isSafeInteger(record.anchorSeq)
    || record.anchorSeq < 0 || Object.is(record.anchorSeq, -0)) throw new HandoffFailure('invalidLink')
  return { hostId: record.hostId as HostId, sessionId: SessionId(record.sessionId), anchorSeq: SessionSeq(record.anchorSeq) }
}
