/** Canonical session URI and inline mention encoding. */

import { SessionId, type SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
import { SessionReferenceError } from './config.ts'
import type { SessionReferenceInput } from './types.ts'

/** URI scheme reserved for DeepSeek Harness session snapshots. */
export const SESSION_REFERENCE_SCHEME = 'dsh-session:'

/**
 * Encode any JavaScript session-id string as a canonical lossless URI.
 * @param sessionId - opaque session id to serialize.
 * @returns canonical `dsh-session:` URI.
 */
export function encodeSessionReferenceUri(sessionId: SessionIdType): string {
  const payload = Buffer.from(JSON.stringify(sessionId), 'utf8').toString('base64url')
  return `${SESSION_REFERENCE_SCHEME}${payload}`
}

/**
 * Decode and canonicalize one session-reference URI.
 * @param uri - complete canonical URI.
 * @returns decoded session id.
 */
export function decodeSessionReferenceUri(uri: string): SessionIdType {
  if (!uri.startsWith(SESSION_REFERENCE_SCHEME)) {
    throw invalidUri(uri)
  }
  const payload = uri.slice(SESSION_REFERENCE_SCHEME.length)
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw invalidUri(uri)
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof parsed !== 'string') throw new TypeError('decoded session id is not a string')
    const sessionId = SessionId(parsed)
    if (encodeSessionReferenceUri(sessionId) !== uri) throw new TypeError('URI is not canonical')
    return sessionId
  } catch (error: unknown) {
    throw invalidUri(uri, error)
  }
}

/**
 * Render a host-neutral Markdown mention carrying the canonical URI.
 * @param reference - structured id and optional display label.
 * @returns escaped `@[label](uri)` mention.
 */
export function formatSessionReferenceMention(reference: SessionReferenceInput): string {
  const label = escapeLabel(reference.label ?? reference.sessionId)
  return `@[${label}](${encodeSessionReferenceUri(reference.sessionId)})`
}

/** Result of extracting canonical mentions from plain text. */
export interface ParsedSessionReferenceText {
  /** Text with opaque tokens replaced by readable `@label` spans. */
  text: string
  /** Structured references in first-appearance order, before service deduplication. */
  references: SessionReferenceInput[]
}

/**
 * Extract Markdown mentions and bare canonical URIs from one text value.
 * Explicit Markdown mentions fail on any malformed URI. Bare text is treated
 * as a reference only when it has a non-empty base64url-shaped payload, then
 * still fails if that candidate is not canonical. Token discovery scans each
 * input segment once, including unfinished or nested mention prefixes.
 * @param text - host text to normalize.
 * @returns readable text and structured references in appearance order.
 */
export function parseSessionReferenceText(text: string): ParsedSessionReferenceText {
  const references: SessionReferenceInput[] = []
  const parts: string[] = []
  let copied = 0
  let cursor = 0
  let mention = text.indexOf('@[')
  let bare = text.indexOf(SESSION_REFERENCE_SCHEME)
  let labelEnd = -1
  let uriEnd = -1
  const append = (start: number, end: number, uri: string, rawLabel?: string): void => {
    const sessionId = decodeSessionReferenceUri(uri)
    const label = rawLabel === undefined ? sessionId : unescapeLabel(rawLabel)
    references.push({ sessionId, label })
    parts.push(text.slice(copied, start), `@${label}`)
    copied = end
    cursor = end
  }
  while (mention >= 0 || bare >= 0) {
    if (mention >= 0 && (bare < 0 || mention < bare)) {
      const labelStart = mention + 2
      // Nested starts share the next delimiter. Reusing it prevents rescanning unfinished labels and URIs.
      if (labelEnd < labelStart) labelEnd = findLabelEnd(text, labelStart)
      if (text[labelEnd] === ']' && text.startsWith(`(${SESSION_REFERENCE_SCHEME}`, labelEnd + 1)) {
        const uriStart = labelEnd + 2
        const payloadStart = uriStart + SESSION_REFERENCE_SCHEME.length
        if (uriEnd < payloadStart) {
          uriEnd = payloadStart
          while (uriEnd < text.length && text[uriEnd] !== ')' && !/\s/u.test(text.charAt(uriEnd))) uriEnd++
        }
        if (text[uriEnd] === ')') append(mention, uriEnd + 1, text.slice(uriStart, uriEnd), text.slice(labelStart, labelEnd))
        else cursor = labelStart
      } else cursor = labelStart
    } else {
      const payloadStart = bare + SESSION_REFERENCE_SCHEME.length
      let end = payloadStart
      while (end < text.length && /[A-Za-z0-9_-]/u.test(text.charAt(end))) end++
      if (end === payloadStart) cursor = payloadStart
      else append(bare, end, text.slice(bare, end))
    }
    if (mention >= 0 && mention < cursor) mention = text.indexOf('@[', cursor)
    if (bare >= 0 && bare < cursor) bare = text.indexOf(SESSION_REFERENCE_SCHEME, cursor)
  }
  return { text: parts.length === 0 ? text : [...parts, text.slice(copied)].join(''), references }
}

/** Find the first unescaped `]`, invalid escape, or end of a Markdown mention label. */
function findLabelEnd(text: string, start: number): number {
  let end = start
  while (end < text.length && text[end] !== ']') {
    if (text[end] !== '\\') end++
    else {
      const escaped = text.codePointAt(end + 1)
      if (escaped === undefined || escaped === 10 || escaped === 13 || escaped === 0x2028 || escaped === 0x2029) break
      end += escaped > 0xFFFF ? 3 : 2
    }
  }
  return end
}

function escapeLabel(label: string): string {
  return label.replace(/[\\\]]/gu, match => `\\${match}`)
}

function unescapeLabel(label: string): string {
  return label.replace(/\\(.)/gu, '$1')
}

function invalidUri(uri: string, cause?: unknown): SessionReferenceError {
  return new SessionReferenceError(
    `invalid session reference URI ${JSON.stringify(uri)}`,
    'SESSION_REFERENCE_INVALID_REFERENCE',
    cause === undefined ? undefined : { cause },
  )
}
