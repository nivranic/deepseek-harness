/** ADB-owned socket driver for the isolated Android acceptance application. */
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { open, unlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { DriverFrame } from './android-gateway-driver.ts'

const exec = promisify(execFile)

/**
 * Start instrumentation through a private forwarded socket after matching both installed APKs to current build bytes.
 * @param adb - Android platform-tools executable.
 * @param target - emulator serial; physical devices are refused.
 * @param hostPort - test-owned native Host TLS port, reversed into the emulator.
 * @param resetData - clear this isolated application's test data; false preserves credentials for restart acceptance.
 * @param additionalHostPorts - other test-owned Host TLS ports used by saved-Host switching.
 * @param startupViewLink - explicit VIEW launch for cold-start navigation acceptance; omitted for a normal launcher start.
 * @param notificationPermission - pregrant notifications by default, or exercise the real permission dialog on a fresh application.
 * @returns command access, controlled Host reachability, and awaited instrumentation/forward retirement.
 */
export async function startAndroidCompanionUiDriver(
  adb: string, target: string, hostPort: number, resetData = true, additionalHostPorts: readonly number[] = [],
  startupViewLink?: string,
  notificationPermission: 'pregranted' | 'runtime' = 'pregranted',
) {
  if (!/^emulator-\d+$/.test(target)) throw new Error('UI acceptance requires an explicit emulator')
  if (notificationPermission === 'runtime' && !resetData) throw new Error('Runtime notification permission acceptance requires fresh application data')
  if (startupViewLink !== undefined && (startupViewLink.length > 4125
    || !/^dsh-companion:\/\/session-view\/dsh-session-view\.v1\.[A-Za-z0-9_-]+$/u.test(startupViewLink))) {
    throw new Error('Cold-start acceptance requires a bounded native view link')
  }
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
  const installedApks: { packageName: string; sha256: string }[] = []
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
    for (const [packageName, artifact] of [
      ['com.deepseek.harness.companion.nativeacceptance', '../../android/app/build/outputs/apk/debug/app-debug.apk'],
      ['com.deepseek.harness.companion.nativeacceptance.test', '../../android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'],
    ] as const) {
      const expected = createHash('sha256').update(await readFile(fileURLToPath(new URL(artifact, import.meta.url)))).digest('hex')
      const location = (await run('shell', 'pm', 'path', packageName)).stdout.trim()
      const match = /^package:(\/data\/app\/[A-Za-z0-9_./~+=-]+\/base\.apk)$/u.exec(location)
      if (!match) throw new Error('Expected one installed acceptance APK')
      const observed = (await run('shell', 'sha256sum', match[1]!)).stdout.split(/\s+/u)[0]
      if (observed !== expected) throw new Error(`Installed ${packageName} differs from its current build; install both acceptance APKs before running UI tests`)
      installedApks.push({ packageName, sha256: expected })
    }
    if (resetData) {
      const cleared = await run('shell', 'pm', 'clear', 'com.deepseek.harness.companion.nativeacceptance')
      if (notificationPermission === 'runtime' && cleared.stdout.trim() !== 'Success') throw new Error('Runtime notification permission acceptance could not clear its application')
    }
    if (notificationPermission === 'runtime') {
      await run('shell', 'pm', 'clear-permission-flags', 'com.deepseek.harness.companion.nativeacceptance',
        'android.permission.POST_NOTIFICATIONS', 'user-set', 'user-fixed')
      const details = (await run('shell', 'dumpsys', 'package', 'com.deepseek.harness.companion.nativeacceptance')).stdout
      const permission = /^\s*android\.permission\.POST_NOTIFICATIONS: granted=(true|false), flags=\[([^\]]*)\]/mu.exec(details)
      if (!permission || permission[1] !== 'false' || /USER_SET|USER_FIXED/u.test(permission[2]!)) {
        throw new Error('Runtime notification permission baseline is not fresh')
      }
    }
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
    ...(startupViewLink === undefined ? [] : ['-e', 'dshViewLink', startupViewLink]),
    '-e', 'dshNotificationPermission', notificationPermission,
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
      installedApks,
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
