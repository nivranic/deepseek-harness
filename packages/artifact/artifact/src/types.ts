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

/**
 * Brand a string as an {@link ArtifactId}.
 * @param id - the raw artifact id string.
 * @returns the same string, branded (a compile-time cast — no runtime cost).
 */
export function ArtifactId(id: string): ArtifactId {
  return id as ArtifactId
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
