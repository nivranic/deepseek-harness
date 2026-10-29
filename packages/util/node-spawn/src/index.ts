/**
 * Zero-dependency spawn facts for running a script under a plain Node
 * runtime from the current process: `process.execPath`, plus
 * `ELECTRON_RUN_AS_NODE` when the host process is an Electron binary (the
 * packaged desktop exe), where that executable only runs scripts in its
 * Node CLI mode. A library, not a plugin — no ctx, no state, no events.
 * @module @deepseek-ai/dsh-node-spawn
 */

/** How to re-execute a JavaScript file as plain Node from the current process. */
export interface NodeSpawnCommand {
  /**
   * The executable that runs the script: `process.execPath` (a plain `node`
   * or the Electron binary, which the env entry below turns into one).
   */
  command: string
  /**
   * Environment entries the command REQUIRES before the script argument:
   * `ELECTRON_RUN_AS_NODE=1` under Electron, none under plain Node (the
   * variable is inert there, so omitting it keeps unrelated children
   * unaffected). Merge these into the child environment; an inherited
   * Electron-mode parent value is always overwritten.
   */
  env: Readonly<Record<string, string>>
}

/** Injectable process facts for deterministic tests. */
export interface NodeSpawnInternals {
  /** Overrides `process.execPath`. */
  execPath?: string
  /** Overrides `process.versions.electron` (set only inside an Electron binary). */
  electron?: string | undefined
}

/**
 * Resolve the command and environment additions that run a script as plain
 * Node from the current process.
 * @param internals - Executable and Electron-version overrides for tests.
 * @returns the spawn facts; stable for the process lifetime.
 */
export function nodeSpawnCommand(internals: NodeSpawnInternals = {}): NodeSpawnCommand {
  const command = internals.execPath ?? process.execPath
  const electron = internals.electron ?? process.versions.electron
  return electron === undefined
    ? { command, env: {} }
    : { command, env: { ELECTRON_RUN_AS_NODE: '1' } }
}
