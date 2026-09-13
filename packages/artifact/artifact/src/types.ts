/**
 * Pure types of the artifact domain: the branded reference identity plus the
 * `SessionEventMap` members that put artifacts on the host journal. Free of
 * host-side value imports beyond the branding primitive, so every consumer
 * face (host plugins, client mirrors, contract fixtures) can take a type-only
 * edge.
 *
 * Chapter 56's minimization holds structurally: journal events carry the
 * reference, its kind and title, and its lifecycle status — never content
 * bytes, which live in the resource channel the consumer resolves the
 * reference against.
 *
 * @module @deepseek-ai/dsh-artifact/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'

/** Identifies one artifact across the journal and the resource channel. */
export type ArtifactId = Branded<'ArtifactId'>

/** Maximum portable artifact-id length, including the `art-` prefix. */
const ARTIFACT_ID_MAX_LENGTH = 128

/** Portable filename-safe body after the `art-` prefix. */
const ARTIFACT_ID_BODY = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u

/**
 * Brand a string as an {@link ArtifactId}.
 * @param id - the raw artifact id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 * @remarks Use {@link parseArtifactId} at model, wire, durable, and filesystem
 * boundaries; typed same-process callers use this cast after their owner has
 * validated or minted the id.
 */
export function ArtifactId(id: string): ArtifactId {
  return id as ArtifactId
}

/**
 * Whether a value is one portable artifact id. Valid ids start with `art-`,
 * contain one through 124 ASCII letters, digits, or hyphens after it, and fit
 * in 128 characters. The body starts and ends with a letter or digit.
 * Excluding all other punctuation keeps the id a single filename on Windows,
 * macOS, and Linux, including against dot segments, alternate-data-stream
 * colons, separators, and NUL characters.
 * @param value - candidate crossing an untyped or persistent boundary.
 * @returns whether the candidate satisfies the portable artifact-id grammar.
 */
export function isArtifactId(value: unknown): value is ArtifactId {
  if (typeof value !== 'string' || value.length > ARTIFACT_ID_MAX_LENGTH || !value.startsWith('art-')) return false
  return ARTIFACT_ID_BODY.test(value.slice(4))
}

/**
 * Validate and brand one artifact id crossing an untyped or persistent boundary.
 * @param value - candidate artifact id.
 * @returns the validated branded id.
 * @throws when the candidate is not portable across supported filesystems.
 */
export function parseArtifactId(value: unknown): ArtifactId {
  if (!isArtifactId(value)) {
    throw new Error('artifact id must be "art-" plus 1 to 124 ASCII letters, digits, or hyphens, starting and ending with a letter or digit')
  }
  return value
}

/** Lifecycle of one artifact reference, in the portable three-state vocabulary. */
export type ArtifactStatus = 'pending' | 'ready' | 'failed'

/** How the artifact's content bytes were authored: model text, or raw bytes
 * (base64 on every text-hostile face); paging units follow it — UTF-16 code
 * units for text, bytes for raw. */
export type ArtifactFormat = 'text' | 'bytes'

/**
 * The artifact members this package merges onto the session map — the
 * typed self-description of the merge below.
 */
export type ArtifactEvents = Pick<SessionEventMap, 'artifact/created' | 'artifact/status'>

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One artifact first appears on the journal: its reference identity,
     * coarse `kind`, and human-facing `title` — references and metadata
     * only, content bytes never ride the event (chapter 56). Log-only UI
     * state; never derived history. A repeat creation for an id already on
     * the log pushes a fresh pending reference, mirroring the Lite fold's
     * arrival semantics.
     */
    'artifact/created': { id: ArtifactId; kind: string; title: string; format: ArtifactFormat }
    /**
     * The lifecycle status of one artifact reference moved; consumers apply
     * last-write-wins by id, and a status for a reference that never
     * arrived is an absent referent (no-op). Log-only UI state.
     */
    'artifact/status': { id: ArtifactId; status: ArtifactStatus }
  }
}
