/**
 * Zero-dependency spawn facts for running a script under a plain Node
 * runtime from the current process: `process.execPath`, plus
 * `ELECTRON_RUN_AS_NODE` when the host process is an Electron binary (the
 * packaged desktop exe), where that executable only runs scripts in its
 * Node CLI mode. A library, not a plugin — no ctx, no state, no events.
 * @module @deepseek-ai/dsh-node-spawn
 */
/**
 * Resolve the command and environment additions that run a script as plain
 * Node from the current process.
 * @param internals - Executable and Electron-version overrides for tests.
 * @returns the spawn facts; stable for the process lifetime.
 */
export function nodeSpawnCommand(internals = {}) {
    const command = internals.execPath ?? process.execPath;
    const electron = internals.electron ?? process.versions.electron;
    return electron === undefined
        ? { command, env: {} }
        : { command, env: { ELECTRON_RUN_AS_NODE: '1' } };
}
//# sourceMappingURL=index.js.map