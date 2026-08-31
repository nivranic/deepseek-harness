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
import type { SessionEvent } from '@deepseek-ai/dsh-session'
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

  ctx.tools.register(defineTool({
    name: 'artifact_read',
    description: 'Read one artifact back by its reference id. Returns the COMPLETE content exactly as created, plus the kind and title when the calling session journaled the artifact. Reading does not modify the artifact.',
    parameters: {
      id: { type: 'string', required: true, description: 'The artifact reference id an artifact_create result reported.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          kind: { type: 'string' },
          title: { type: 'string' },
          content: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.title === undefined
          ? `Artifact ${value.id}:`
          : `Artifact ${value.title} (${value.kind}) — ${value.id}:`,
      }, {
        type: 'text',
        text: value.content,
      }],
    },
    async execute(args, exec) {
      const id = ArtifactId(args.id.trim())
      if (id.length === 0) {
        throw new Error('artifact_read requires a non-empty id')
      }
      const stored = await ctx.artifacts.get(id)
      if (stored === null) {
        // An id the channel never stored (or whose bytes were removed) has
        // nothing to read; say so instead of returning an empty content.
        throw new Error(`artifact_read found no content stored under id "${id}"`)
      }
      const agent = exec.agent
      const created = agent === undefined
        ? undefined
        : agent.session.events.findLast((event): event is SessionEvent<'artifact/created'> =>
          event.type === 'artifact/created' && event.data.id === id)
      return {
        id,
        content: new TextDecoder().decode(stored),
        ...(created === undefined ? {} : { kind: created.data.kind, title: created.data.title }),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Read artifact', kind: 'other', rawInput: args }),
  }))
}
