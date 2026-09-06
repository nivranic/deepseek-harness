import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'

const launcher = resolve(import.meta.dirname, 'release/windows-portable-launch.ts')
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

describe('Portable child debug endpoint discovery', () => {
  async function run(mode: string) {
    const root = await mkdtemp(join(tmpdir(), 'dsh-portable-discovery-'))
    roots.push(root)
    const fixture = join(root, 'child.mjs')
    await writeFile(fixture, `import { createServer } from 'node:http'
import { writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
writeFileSync('observed.json', JSON.stringify(args))
if (process.env.PROBE_MODE === 'early') process.exit(17)
const ports = [Number(args.find(arg => arg.startsWith('--inspect=')).split(':').at(-1)), Number(args.find(arg => arg.startsWith('--remote-debugging-port=')).split('=').at(-1))]
const servers = []
let requests = 0
for (const [index, port] of ports.entries()) {
  const server = createServer((_request, response) => {
    const host = process.env.PROBE_MODE === 'foreign' ? 'example.invalid' : '127.0.0.1'
    const target = { webSocketDebuggerUrl: 'ws://' + host + ':' + port + '/synthetic-' + index }
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(index === 0 ? [target] : target))
    if (++requests === (process.env.PROBE_MODE === 'foreign' ? 1 : 2)) setTimeout(() => {
      for (const server of servers) server.close()
      process.exit(process.env.PROBE_MODE === 'late-failure' ? 23 : 0)
    }, 300)
  })
  servers.push(server)
  server.listen(port, '127.0.0.1')
}
setTimeout(() => process.exit(19), 5000).unref()
`)
    let stdout = '', stderr = '', code = 0
    try {
      const result = await promisify(execFile)(process.execPath, ['--import', import.meta.resolve('tsx/esm'), launcher, fixture, '--inspect=0', '--remote-debugging-port=0', '--user-data-dir=owned-data'], {
        cwd: root, windowsHide: true, timeout: 15_000,
        env: { ...process.env, DSH_RC_PORTABLE_EXECUTABLE: process.execPath, PROBE_MODE: mode },
      })
      stdout = result.stdout; stderr = result.stderr
    } catch (error) {
      const result = error as { stdout: string; stderr: string; code: number }
      stdout = result.stdout; stderr = result.stderr; code = result.code
    }
    const args: unknown = JSON.parse(await readFile(join(root, 'observed.json'), 'utf8'))
    return { stdout, stderr, code, args }
  }

  it('forwards both loopback endpoint announcements and waits for the real child exit', async () => {
    const result = await run('valid')
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/^Debugger listening on ws:\/\/127\.0\.0\.1:\d+\/synthetic-0$/m)
    expect(result.stderr).toMatch(/^DevTools listening on ws:\/\/127\.0\.0\.1:\d+\/synthetic-1$/m)
    expect(result.args).toEqual(expect.arrayContaining(['--user-data-dir=owned-data', '--remote-debugging-address=127.0.0.1']))
    expect(result.args).not.toContain('--inspect=0')
    expect(result.args).not.toContain('--remote-debugging-port=0')
  })

  it('rejects a foreign endpoint without forwarding it or converting the failure to child success', async () => {
    const result = await run('foreign')
    expect(result.code).toBe(1)
    expect(result.stderr).toBe('Portable debug endpoint discovery failed\n')
  })

  it('preserves a child failure before endpoint discovery', async () => {
    const result = await run('early')
    expect(result.code).toBe(17)
    expect(result.stderr).toBe('')
  })

  it('preserves a child failure after both endpoints have been announced', async () => {
    const result = await run('late-failure')
    expect(result.code).toBe(23)
    expect(result.stderr).toContain('Debugger listening on')
    expect(result.stderr).toContain('DevTools listening on')
  })
})
