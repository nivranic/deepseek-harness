/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-electron-ipc`.
 * @module @deepseek-ai/dsh-host-electron-ipc/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-electron-ipc'

/** Cordis companion plugin name. */
export const name = 'electron-ipc-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/**
 * No runtime invariant: the gateway is a stateless dispatch over services
 * whose mutable relationships (session logs, registries) are audited by their
 * owning packages, and the plugin registers no effect outside its fiber.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
