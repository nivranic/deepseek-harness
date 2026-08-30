/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-link-access`.
 * @module @deepseek-ai/dsh-link-access/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-link-access'

/** Cordis companion plugin name. */
export const name = 'link-access-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the carrier is disabled by default, and its
 * authentication/authorization rejections are exercised per-request by the
 * package's carrier tests; no continuously observable in-process relation
 * exists for a companion to assert without binding a socket as a side
 * effect.
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
