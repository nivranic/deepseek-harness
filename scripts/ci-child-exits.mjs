/**
 * Optional CI preload for native test-worker exit diagnostics. Records only
 * Node version, process ids, exit code and signal through Node's child-process
 * channel. Does not capture arguments, environment, paths or child output.
 */
import { channel } from 'node:diagnostics_channel'
import { writeSync } from 'node:fs'

channel('child_process').subscribe(({ process: child }) => {
  child.once('exit', (code, signal) => {
    const record = {
      kind: 'ci-child-exit',
      nodeVersion: process.version,
      parentPid: process.pid,
      childPid: child.pid,
      code,
      signal,
    }
    try { writeSync(2, `${JSON.stringify(record)}\n`) }
    catch { /* Unwritable diagnostic stderr must not change the child's exit result. */ }
  })
})
