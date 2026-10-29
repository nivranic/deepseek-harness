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
 * No runtime invariant: schema-version and pairing atomicity are open-time
 * and unit-test checks that reject before a device exists, and the store
 * exposes no continuously observable in-process relation a companion could
 * assert without mutating durable trust state as a side effect.
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
