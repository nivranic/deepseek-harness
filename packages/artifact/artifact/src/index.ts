/**
 * The artifact host face: the `ctx.artifacts` resource channel plus the
 * model-facing `artifact_create` tool that journals first-class artifact
 * references (chapter 56 — the journal carries the reference, its metadata,
 * and its status; content bytes live in the resource channel behind the
 * seam, never in an event).
 * @module @deepseek-ai/dsh-artifact
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Service } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ArtifactId } from './types.ts'

export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    artifacts: ArtifactStore
  }
}

/**
 * Durable artifact content channel — chapter 56's resource channel. Journal
 * events carry references only; the complete bytes of one artifact live
 * here, keyed by the reference identity `artifact/created` minted.
 */
export abstract class ArtifactStore extends Service {
  constructor(ctx: Context) {
    super(ctx, 'artifacts')
  }

  /**
   * Durably write one artifact's complete content bytes under its id.
   * @param id - the artifact reference identity from `artifact/created`.
   * @param data - the complete content bytes.
   */
  abstract put(id: ArtifactId, data: Uint8Array): Promise<void>

  /**
   * Read one artifact's content bytes back.
   * @param id - the artifact reference identity.
   * @returns the stored bytes, or null when nothing is stored under the id.
   */
  abstract get(id: ArtifactId): Promise<Uint8Array | null>

  /**
   * Remove one artifact's content bytes.
   * @param id - the artifact reference identity to delete.
   */
  abstract remove(id: ArtifactId): Promise<void>
}

export const name = 'artifact'
export const inject = ['tools', 'artifacts']

const DESCRIPTION = 'Create one durable artifact — a first-class output file the user keeps (a report, a design document, a patch, a generated dataset). Give it a short `kind` tag (e.g. markdown, report, patch, json), a human-facing `title`, and the COMPLETE content in this call. The artifact is stored durably and journaled as a reference you can cite by id; do not use it for scratch text that belongs in your reply, and do not split one artifact across calls.'

/**
 * Register the `artifact_create` tool on `ctx.tools`.
 * @param ctx - registrant context carrying the tool registry and the artifact store.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'artifact_create',
    description: DESCRIPTION,
    parameters: {
      kind: { type: 'string', required: true, description: 'Short kind tag, e.g. markdown, report, patch, json.' },
      title: { type: 'string', required: true, description: 'Human-facing artifact title.' },
      content: { type: 'string', required: true, description: 'The COMPLETE artifact content.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string', required: true },
          title: { type: 'string', required: true },
          status: { type: 'string', required: true, enum: ['ready'] },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Artifact ready: ${value.title} (${value.kind}) — ${value.id}`,
      }],
    },
    execute(args, exec) {
      const kind = args.kind.trim()
      const title = args.title.trim()
      if (kind.length === 0 || title.length === 0) {
        throw new Error('artifact_create requires a non-empty kind and title')
      }
      const agent = exec.agent
      if (!agent) {
        // An artifact belongs to an owning agent session; a caller without
        // one has no journal to record the reference on. Reject rather than
        // store orphaned content.
        throw new Error('artifact_create requires an owning agent session')
      }
      const id = ArtifactId(`art-${randomUUID()}`)
      agent.session.append('artifact/created', { id, kind, title })
      const data = new TextEncoder().encode(args.content)
      return ctx.artifacts.put(id, data).then(
        () => {
          agent.session.append('artifact/status', { id, status: 'ready' })
          return { id, kind, title, status: 'ready' as const }
        },
        (error: unknown) => {
          agent.session.append('artifact/status', { id, status: 'failed' })
          throw error
        },
      )
    },
    presentCall: args => ({ card: 'generic', title: 'Create artifact', kind: 'other', rawInput: args }),
  }))
}
