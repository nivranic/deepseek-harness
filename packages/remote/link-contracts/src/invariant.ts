/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-link-contracts`.
 * @module @deepseek-ai/dsh-link-contracts/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-link-contracts'

/** Cordis companion plugin name. */
export const name = 'link-contracts-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the package is a pure contract library — schemas,
 * fixtures, and a generator with no Cordis registrations, so no runtime
 * relation exists for a companion to assert.
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
