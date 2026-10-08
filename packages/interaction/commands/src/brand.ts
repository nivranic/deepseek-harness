/**
 * Command definition identities, execution ids, and client mutation ids for
 * discovery, lifecycle pairing, and retry replay.
 *
 * The `Branded<B>` primitive lives in `@deepseek-ai/dsh-brand`; this module
 * is a pure type/constructor outlet (no cordis imports, no module
 * augmentation) so wire and client programs can name the brand without
 * loading the host plugin's Context merges — the `dsh-llm/brand` shape.
 *
 * @module @deepseek-ai/dsh-commands/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Stable, plugin-owned identity of a command definition, independent of its name and copy. */
export type CommandDefinitionId = Branded<'CommandDefinitionId'>

/**
 * Brand a plugin-namespaced command definition identity.
 * @param id - stable identity chosen by the registering plugin.
 * @returns the same string, branded; no validation is performed.
 */
export function CommandDefinitionId(id: string): CommandDefinitionId {
  return id as CommandDefinitionId
}

/**
 * Pairs one command execution's `command/run`/`command/done` lifecycle
 * records with each other and with the `command.execute` admission response.
 * Minted by the executor, monotonic per service instance.
 */
export type CommandId = Branded<'CommandId'>

/**
 * Brand a string as a {@link CommandId}.
 * @param id - the executor-minted pairing id.
 * @returns the same string, branded; no validation is performed.
 */
export function CommandId(id: string): CommandId {
  return id as CommandId
}

/**
 * Opaque client-minted retry identity for one command submission. When
 * carried, a resend that reaches the same live Host process returns the
 * first execution's {@link CommandExecution} without re-running the handler;
 * receipts are process-local, so a restart admits the resend as fresh.
 */
export type CommandMutationId = Branded<'command-mutation-id'>

/**
 * Brand a string as a {@link CommandMutationId}.
 * @param id - the client-minted retry identity; the executor validates it at
 *   its wire boundary (non-empty, no leading/trailing whitespace, at most
 *   128 characters).
 * @returns the same string, branded; no validation is performed.
 */
export function CommandMutationId(id: string): CommandMutationId {
  return id as CommandMutationId
}
