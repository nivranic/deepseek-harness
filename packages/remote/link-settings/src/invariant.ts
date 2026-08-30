/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-device-trust`.
 * @module @deepseek-ai/dsh-device-trust/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-device-trust'

/** Cordis companion plugin name. */
export const name = 'device-trust-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the bridge is a pure observer — schema validation
 * rejects bad sections at commit time, and the carrier-settings relationship
 * is last-writer-wins by design, so no continuously observable in-process
 * relation exists that a companion could assert without writing settings as
 * a side effect.
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
