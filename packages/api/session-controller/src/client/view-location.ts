/** §26 view-location handoff: reopen one durable Session at an anchored position on any device. */
import { brandString } from '@deepseek-ai/dsh-brand'
import type { HostId } from '@deepseek-ai/dsh-api-host-description/types'
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'

/** One §26 view-location handoff payload: transfer the viewing position, never the runtime. */
export interface SessionViewLocation {
  /** Host the payload was captured from; opening against any other connected Host fails loud. */
  readonly hostId: HostId
  readonly sessionId: SessionId
  /** Inclusive durable seq the receiving UI reveals; within-window anchors load nothing. */
  readonly anchorSeq: SessionSeq
}


/** Structural check for the v1 wire grammar: exactly the three known keys with validated values. */
function isViewLocationShape(value: unknown): value is { hostId: string; sessionId: string; anchorSeq: number } {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === 3
    && typeof record.hostId === 'string' && record.hostId !== ''
    && typeof record.sessionId === 'string' && record.sessionId !== ''
    && typeof record.anchorSeq === 'number'
    && Number.isSafeInteger(record.anchorSeq)
    && record.anchorSeq >= 0
    && !Object.is(record.anchorSeq, -0)
}

/** Wire form prefix pinning the payload grammar for future revisions. */
const PREFIX = 'dsh-session-view.v1.'

/** ASCII-only characters the base64 stage accepts; ids and numbers never need more. */
const ASCII_ONLY = /^[\x20-\x7E]*$/u
const BASE64URL = /^[A-Za-z0-9_-]*$/u

function asciiToBase64url(text: string): string {
  const base64 = btoa(text)
  return base64.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64urlToAscii(value: string): string {
  const padded = value + '='.repeat((4 - value.length % 4) % 4)
  try {
    return atob(padded.replaceAll('-', '+').replaceAll('_', '/'))
  } catch {
    throw new Error('session view location is not decodable base64url')
  }
}

/**
 * Encode one view location for handoff to another device.
 * @param location - captured viewing position.
 * @returns prefixed base64url string safe for links, clipboards, and QR codes.
 */
export function encodeSessionViewLocation(location: SessionViewLocation): string {
  const json = JSON.stringify(location)
  if (!ASCII_ONLY.test(json)) throw new Error('session view location must be ASCII-encoded')
  return PREFIX + asciiToBase64url(json)
}

/**
 * Decode one handoff payload into a validated view location.
 * @param encoded - string produced by {@link encodeSessionViewLocation}.
 * @returns the captured host, session, and anchor.
 */
export function decodeSessionViewLocation(encoded: string): SessionViewLocation {
  if (!encoded.startsWith(PREFIX)) throw new Error('session view location has an unknown grammar')
  const body = encoded.slice(PREFIX.length)
  if (!BASE64URL.test(body)) throw new Error('session view location is not base64url')
  const json = base64urlToAscii(body)
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new Error('session view location is not valid JSON')
  }
  const value = isViewLocationShape(parsed)
    ? parsed
    : undefined
  if (value === undefined) throw new Error('session view location does not match the v1 grammar')
  // The parse boundary mints the branded ids; every later consumer compares them typed.
  return {
    hostId: brandString<HostId>(value.hostId),
    sessionId: SessionId(value.sessionId),
    anchorSeq: SessionSeq(value.anchorSeq),
  }
}
