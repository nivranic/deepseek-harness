/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-artifact-local`.
 * @module @deepseek-ai/dsh-artifact-local/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-artifact-local'

/** Cordis companion plugin name. */
export const name = 'artifact-local-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: each filesystem operation validates its portable id;
 * write, read, removal, and retention correctness require filesystem round trips,
 * and this backend owns no event stream or persistent in-memory projection.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
