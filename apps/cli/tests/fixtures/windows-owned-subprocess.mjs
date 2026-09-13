/** Windows Job lifetime exercised through the built dsh profile loader. */
import assert from 'node:assert/strict'

export const name = 'windows-owned-subprocess-fixture'
export const inject = ['subprocess']

export function apply(ctx, config) {
  ctx.effect(() => {
    void ctx.loader.await().then(() => verify(ctx.subprocess, config.node)).then(
      result => { process.stdout.write(JSON.stringify(result) + '\n'); process.exit(0) },
      error => { console.error(error); process.exit(1) },
    )
  })
}

async function verify(subprocess, executable) {
  const target = `
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    process.exitCode = 7;
  `
  const handle = subprocess.spawn({
    argv: [executable, '-e', target], cwd: process.cwd(), graceMs: 100,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 4096 }, stderr: { maxBytes: 4096 } },
  })
  try {
    const outcome = await handle.done
    assert.deepEqual(outcome, { exitCode: 7, signal: null })
    const retained = !await handle.waitForExit(AbortSignal.timeout(100))
    assert.equal(retained, true)
    handle.terminate()
    const terminated = await handle.waitForExit(AbortSignal.timeout(10000))
    assert.equal(terminated, true)
    return { exitCode: outcome.exitCode, retained, terminated }
  } finally { handle.terminate() }
}
