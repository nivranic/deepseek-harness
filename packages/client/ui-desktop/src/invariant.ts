/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-desktop`.
 * @module @deepseek-ai/dsh-client-ui-desktop/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-desktop'

/** Cordis companion plugin name. */
export const name = 'client-ui-desktop-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the namespace this package registers is governed by
 * the settings seam's own commit lifecycle, and the close behavior is a
 * shell-side read at window-close time with no event stream or mutable
 * registry to audit.
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
