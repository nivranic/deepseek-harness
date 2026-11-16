import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const built = ['lib/index.js', 'lib/worker.cjs']
  .every(path => existsSync(join(packageRoot, path)))

describe.skipIf(!built)('built migration verifier (plain node)', () => {
  it('publishes V3 recovery records through the bundled codec and verifier', async () => {
    const script = `
      import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { zstdCompressSync, constants } from 'node:zlib'
      import { Context } from '@deepseek-ai/cordis'
      import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
      import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
      const root = await mkdtemp(join(tmpdir(), 'dsh-built-recovery-'))
      const id = 'built-recovery'
      const directory = join(root, '_no-cwd', id)
      const source = join(directory, 'session.v3.jsonl.zstd')
      const intentPath = source + '.repair-intent'
      const ctx = new Context()
      const line = value => JSON.stringify(value) + '\\n'
      const frame = value => zstdCompressSync(Buffer.from(line(value)), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
      const first = { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } }
      const recovered = { type: 'turn/end', seq: 1, time: 3, data: { turn: 1, reason: { kind: 'completed' } } }
      const original = Buffer.concat([
        frame({ type: 'session', version: 3, id, createdAt: 1, delegationDepth: 0, isSeeded: false }), frame(first),
      ])
      const intent = line({ version: 1, id, truncateTo: original.length, events: [recovered] })
      try {
        await mkdir(directory, { recursive: true })
        await writeFile(source, original)
        await writeFile(intentPath, intent)
        await ctx.plugin(JsonlSessionPersistence, { root, compression: 'zstd' })
        const reader = await ctx.sessionPersistence.open(id, 'read')
        let events
        try { events = (await reader.read()).events } finally { await reader.close() }
        const writer = await ctx.sessionPersistence.open(id, 'write')
        await writer.close()
        console.log(JSON.stringify({
          sequences: events.map(event => event.seq),
          sourceRetained: (await readFile(source)).equals(original),
          intentRetained: (await readFile(intentPath, 'utf8')) === intent,
          published: (await readFile(join(directory, 'session.v' + SESSION_FORMAT_VERSION + '.jsonl.zstd'))).length > 0,
        }))
      } finally {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      }
    `
    const { exitCode, stdout, stderr, timedOut, signal } = await execa(process.execPath, ['--input-type=module', '-e', script], {
      cwd: packageRoot, env: { NODE_PATH: undefined, NODE_OPTIONS: undefined },
      stdin: 'ignore', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
    })
    expect(timedOut).toBe(false)
    expect(signal).toBeUndefined()
    expect(exitCode, stderr).toBe(0)
    expect(JSON.parse(stdout.trim())).toEqual({ sequences: [0, 1], sourceRetained: true, intentRetained: true, published: true })
  })

  it('publishes history and verifies it without runtime workspace imports', async () => {
    const script = `
      import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
      import { tmpdir } from 'node:os'
      import { join } from 'node:path'
      import { Worker } from 'node:worker_threads'
      import { Context } from '@deepseek-ai/cordis'
      import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
      import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

      const terminate = Worker.prototype.terminate
      let terminations = 0
      Worker.prototype.terminate = function () {
        terminations += 1
        return terminate.call(this)
      }
      const root = await mkdtemp(join(tmpdir(), 'dsh-built-migration-'))
      const id = 'built-migration-worker'
      const directory = join(root, '_no-cwd', id)
      const ctx = new Context()
      try {
        await mkdir(directory, { recursive: true })
        await writeFile(join(directory, 'session.jsonl'), JSON.stringify({
          type: 'session', version: 0, id, createdAt: 1, delegationDepth: 0,
        }) + '\\n')
        await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
        const handle = await ctx.sessionPersistence.open(id, 'write')
        await handle.close()
        await ctx.sessionPersistence.flush()
        const currentPath = join(directory, 'session.v' + SESSION_FORMAT_VERSION + '.jsonl')
        const header = JSON.parse((await readFile(currentPath, 'utf8')).trim())
        await mkdir(join(root, 'lib'))
        await copyFile('package.json', join(root, 'package.json'))
        const workerPath = join(root, 'lib', 'worker.cjs')
        await copyFile('lib/worker.cjs', workerPath)
        async function verify(expectedEventCount) {
          const worker = new Worker(workerPath, { workerData: {
            path: currentPath, compression: 'none', expectedId: id, expectedEventCount,
          } })
          try {
            return await new Promise((resolve, reject) => {
              let response
              worker.once('message', value => { response = value })
              worker.once('error', reject)
              worker.once('exit', code => {
                if (code === 0 && response !== undefined) resolve(response)
                else reject(new Error('verifier did not complete: ' + code))
              })
            })
          } finally {
            if (worker.threadId !== -1) await worker.terminate()
          }
        }
        const verified = await verify(0)
        const refused = await verify(1)
        console.log(JSON.stringify({ id: header.id, version: header.version,
          verified: verified.ok, refused: refused.ok, refusal: refused.message, terminations }))
      } finally {
        await ctx.fiber.dispose()
        await rm(root, { recursive: true, force: true })
      }
    `
    const { exitCode, stdout, stderr, timedOut, signal } = await execa(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        cwd: packageRoot, env: { NODE_PATH: undefined, NODE_OPTIONS: undefined },
        stdin: 'ignore', timeout: 30_000, killSignal: 'SIGKILL', reject: false,
      },
    )

    expect(timedOut).toBe(false)
    expect(signal).toBeUndefined()
    expect(exitCode, `stderr:\n${stderr}`).toBe(0)
    expect(JSON.parse(stdout.trim())).toEqual({
      id: 'built-migration-worker', version: SESSION_FORMAT_VERSION, verified: true, refused: false,
      refusal: 'current session generation contains 0 events, expected 1', terminations: 0,
    })
  })
})
