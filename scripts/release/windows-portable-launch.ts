/** Discover loopback debugging endpoints for an NSIS child whose stderr is not inherited. */
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'

const executable = process.env.DSH_RC_PORTABLE_EXECUTABLE
if (!executable) throw new Error('Portable executable is required')
const args = process.argv.slice(2)
const nodeFlag = args.indexOf('--inspect=0'), browserFlag = args.indexOf('--remote-debugging-port=0')
if (nodeFlag < 0 || browserFlag < 0) throw new Error('Portable launch requires both dynamic debugging flags')

async function reservePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Loopback port reservation failed')
  return { port: address.port, close: () => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error) reject(error); else resolve() })
  }) }
}

const node = await reservePort()
let browser: Awaited<ReturnType<typeof reservePort>>
try { browser = await reservePort() } catch (error) { await node.close(); throw error }
args[nodeFlag] = `--inspect=127.0.0.1:${node.port}`
args[browserFlag] = `--remote-debugging-port=${browser.port}`
args.push('--remote-debugging-address=127.0.0.1')
await Promise.all([node.close(), browser.close()])
const env = { ...process.env }
delete env.DSH_RC_NODE
delete env.DSH_RC_TSX_HOOK
delete env.DSH_RC_PORTABLE_EXECUTABLE
const child = spawn(executable, args, { cwd: process.cwd(), env, stdio: 'ignore', windowsHide: true })
const stopped = new AbortController()
const exited = new Promise<number | null>((resolve, reject) => {
  child.once('error', (error) => { stopped.abort(); reject(error) })
  child.once('exit', (code) => { stopped.abort(); resolve(code) })
})
// Attach rejection handling before endpoint discovery can await an unavailable child.
const outcome = exited.then(code => ({ code }), () => ({ code: 1 }))

async function reportEndpoint(port: number, route: string, label: string, nodeTarget: boolean): Promise<boolean> {
  while (!stopped.signal.aborted) {
    let response: Response | undefined
    try {
      response = await fetch(`http://127.0.0.1:${port}${route}`, {
        signal: AbortSignal.any([stopped.signal, AbortSignal.timeout(1000)]), redirect: 'error',
      })
    } catch {
      // Connection refusal, request timeout and child shutdown can precede debug-server readiness.
    }
    if (response?.ok) {
      const value: unknown = await response.json()
      const target: unknown = nodeTarget ? (Array.isArray(value) && value.length === 1 ? value[0] as unknown : null) : value
      const endpoint = target !== null && typeof target === 'object' && 'webSocketDebuggerUrl' in target ? target.webSocketDebuggerUrl : undefined
      if (typeof endpoint !== 'string') throw new Error('Portable debug endpoint is missing')
      const url = new URL(endpoint)
      if (url.protocol !== 'ws:' || url.hostname !== '127.0.0.1' || url.port !== String(port)
        || url.username || url.password || url.search || url.hash) throw new Error('Portable debug endpoint is not the requested loopback server')
      process.stderr.write(`${label} ${url.href}\n`)
      return true
    }
    await response?.body?.cancel()
    try { await delay(100, undefined, { signal: stopped.signal }) } catch {
      // Child shutdown cancels only the discovery wait.
    }
  }
  return false
}

let discoveryFailed = false
try {
  const ready = await Promise.all([
    reportEndpoint(node.port, '/json/list', 'Debugger listening on', true),
    reportEndpoint(browser.port, '/json/version', 'DevTools listening on', false),
  ])
  discoveryFailed = ready.some(value => !value)
} catch {
  // The owning Playwright launch sees a fixed failure and terminates this entire process tree.
  discoveryFailed = true
  stopped.abort()
  process.stderr.write('Portable debug endpoint discovery failed\n')
}
const result = await outcome
process.exitCode = result.code === 0 ? (discoveryFailed ? 1 : 0) : (result.code ?? 1)
