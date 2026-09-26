/** ADB-owned socket driver for the isolated Android acceptance application. */
import { spawn, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { open, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { DriverFrame } from './android-gateway-driver.ts'

const exec = promisify(execFile)

/**
 * Start instrumentation through a private forwarded socket on an explicitly selected emulator.
 * @param adb - Android platform-tools executable.
 * @param target - emulator serial; physical devices are refused.
 * @param hostPort - test-owned native Host TLS port, reversed into the emulator.
 * @param resetData - clear this isolated application's test data; false preserves credentials for restart acceptance.
 * @param additionalHostPorts - other test-owned Host TLS ports used by saved-Host switching.
 * @returns command access, controlled Host reachability, and awaited instrumentation/forward retirement.
 */
export async function startAndroidCompanionUiDriver(
  adb: string, target: string, hostPort: number, resetData = true, additionalHostPorts: readonly number[] = [],
) {
  if (!/^emulator-\d+$/.test(target)) throw new Error('UI acceptance requires an explicit emulator')
  const args = ['-s', target]
  const leasePath = join(tmpdir(), `dsh-native-acceptance-${target}.lock`)
  const lease = await open(leasePath, 'wx', 0o600)
  let released = false
  const release = async () => {
    if (released) return
    released = true
    await lease.close(); await unlink(leasePath)
  }
  const socketName = `dsh-native-${randomUUID()}`
  const run = (...command: string[]) => exec(adb, [...args, ...command], { windowsHide: true })
  let port: number
  const reversed = new Set<number>()
  const removeReverses = async () => {
    const results = await Promise.allSettled([...reversed].map(async (value) => {
      await run('reverse', '--remove', `tcp:${value}`)
      reversed.delete(value)
    }))
    const failures = results.filter(item => item.status === 'rejected').map(item => item.reason as unknown)
    if (failures.length) throw new AggregateError(failures, 'Android reverse forwarding cleanup failed')
  }
  try {
    if (resetData) await run('shell', 'pm', 'clear', 'com.deepseek.harness.companion.nativeacceptance')
    for (const value of new Set([hostPort, ...additionalHostPorts])) {
      await run('reverse', `tcp:${value}`, `tcp:${value}`)
      reversed.add(value)
    }
    const forward = await run('forward', 'tcp:0', `localabstract:${socketName}`)
    port = Number(forward.stdout.trim())
  } catch (error) {
    try { await removeReverses() } finally { await release() }
    throw error
  }
  const child = spawn(adb, [...args, 'shell', 'am', 'instrument', '-w', '-e', 'class',
    'ai.deepseek.dsh.companion.NativeCompanionAcceptanceTest', '-e', 'dshSocket', socketName,
    'com.deepseek.harness.companion.nativeacceptance.test/androidx.test.runner.AndroidJUnitRunner'],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let passed = false
  let transcript = ''
  child.stdout.on('data', (bytes: Buffer) => { transcript = (transcript + bytes.toString('utf8')).slice(-16384); passed ||= transcript.includes('OK (1 test)') })
  child.stderr.resume()
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', resolve) })
  let socket: Socket | undefined
  try {
    const deadline = Date.now() + 30_000
    while (socket === undefined) {
      const candidate = connect({ host: '127.0.0.1', port })
      try {
        await new Promise<void>((resolve, reject) => {
          let greeting = ''
          const timer = setTimeout(() => { reject(new Error('Android UI not ready')) }, 1000)
          const fail = () => { clearTimeout(timer); reject(new Error('Android UI not ready')) }
          candidate.once('error', fail); candidate.once('close', fail)
          const receive = (bytes: Buffer) => {
            greeting += bytes.toString('utf8')
            if (!greeting.includes('\n') && greeting.length < 64) return
            clearTimeout(timer); candidate.off('data', receive)
            if (greeting.trim() === '{"ready":true}') resolve()
            else reject(new Error('Android UI readiness differed'))
          }
          candidate.on('data', receive)
        })
        socket = candidate
      } catch (error) {
        candidate.destroy()
        if (Date.now() >= deadline || child.exitCode !== null) throw error
        await delay(100)
      }
    }
    const lines = createInterface({ input: socket })
    const pending = new Map<string, { resolve: (frame: DriverFrame) => void; reject: (error: Error) => void }>()
    const fail = () => { for (const item of pending.values()) item.reject(new Error('Android UI socket ended')); pending.clear() }
    socket.on('error', fail); socket.on('close', fail)
    lines.on('line', (line) => {
      try {
        const frame = JSON.parse(line) as DriverFrame
        pending.get(frame.id)?.resolve(frame); pending.delete(frame.id)
      } catch { fail() }
    })
    let sequence = 0
    let retired = false
    let hostReachable = true
    const cleanup = async () => {
      if (retired) return
      retired = true
      socket?.destroy(); lines.close()
      try {
        await run('forward', '--remove', `tcp:${port}`)
      } finally {
        try { await removeReverses() } finally { await release() }
      }
    }
    return {
      setHostReachable: async (reachable: boolean) => {
        if (retired) throw new Error('Android UI driver is retired')
        if (reachable === hostReachable) return
        if (reachable) {
          await run('reverse', `tcp:${hostPort}`, `tcp:${hostPort}`)
          reversed.add(hostPort)
        } else {
          await run('reverse', '--remove', `tcp:${hostPort}`)
          reversed.delete(hostPort)
        }
        hostReachable = reachable
      },
      request: (command: object): Promise<DriverFrame> => new Promise((resolve, reject) => {
        const id = String(++sequence)
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Android UI command timed out')) }, 40_000)
        pending.set(id, {
          resolve: (frame) => { clearTimeout(timer); resolve(frame) },
          reject: (error) => { clearTimeout(timer); reject(error) },
        })
        socket!.write(JSON.stringify({ ...command, id }) + '\n')
      }),
      stop: async () => {
        const code = await exited
        try { await run('shell', 'am', 'force-stop', 'com.deepseek.harness.companion.nativeacceptance') }
        finally { await cleanup() }
        return passed && code === 0 ? 0 : 1
      },
      kill: async () => {
        socket?.destroy()
        if (child.exitCode === null) {
          await run('shell', 'am', 'force-stop', 'com.deepseek.harness.companion.nativeacceptance')
          child.kill()
        }
        await exited; await cleanup()
      },
    }
  } catch (error) {
    socket?.destroy(); child.kill(); await exited
    try { await run('forward', '--remove', `tcp:${port}`) }
    finally { try { await removeReverses() } finally { await release() } }
    throw error
  }
}
