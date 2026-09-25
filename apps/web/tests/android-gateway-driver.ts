/** Private-pipe Kotlin integration driver; pairing secrets never enter command arguments. */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

/** One driver-owned response or subscription item. */
export interface DriverFrame { id: string; type: string; value: unknown }

/**
 * Start the compiled production-client driver for a Host integration scenario.
 * @param java - Java 17 executable selected by the test environment.
 * @returns command/subscription access and awaitable process retirement.
 */
export async function startAndroidGatewayDriver(java: string) {
  const classpath = await readFile(new URL('../../android/core/build/native-gateway-classpath.txt', import.meta.url), 'utf8')
  const child = spawn(java, ['-cp', classpath, 'ai.deepseek.dsh.gateway.NativeGatewayDriver'], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  const lines = createInterface({ input: child.stdout })
  const frames: DriverFrame[] = []
  const pending = new Map<string, { resolve: (value: DriverFrame) => void; reject: (error: Error) => void }>()
  let failure: Error | undefined
  let sequence = 0
  child.stderr.resume()
  const fail = (error: Error) => {
    failure = error
    for (const request of pending.values()) request.reject(error)
    pending.clear()
  }
  child.on('error', () => { fail(new Error('Kotlin driver failed to launch')) })
  const exited = new Promise<number | null>(resolve => child.once('close', (code) => {
    fail(new Error(`Kotlin driver exited: ${String(code)}`)); resolve(code)
  }))
  lines.on('line', (line) => {
    try {
      const value = JSON.parse(line) as DriverFrame
      const request = pending.get(value.id)
      if (request) { pending.delete(value.id); request.resolve(value) }
      else frames.push(value)
    } catch { fail(new Error('Kotlin driver emitted invalid JSON')) }
  })
  const next = (id: string): Promise<DriverFrame> => {
    const index = frames.findIndex(value => value.id === id)
    if (index >= 0) return Promise.resolve(frames.splice(index, 1)[0]!)
    if (failure) return Promise.reject(failure)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`Kotlin driver response ${id} timed out`)) }, 15_000)
      pending.set(id, {
        resolve: (value) => { clearTimeout(timeout); resolve(value) },
        reject: (error) => { clearTimeout(timeout); reject(error) },
      })
    })
  }
  const send = (command: object): string => {
    const id = String(++sequence)
    child.stdin.write(JSON.stringify({ ...command, id }) + '\n')
    return id
  }
  return {
    send, next,
    request: (value: object) => next(send(value)),
    stop: async () => {
      child.stdin.end()
      return await exited
    },
    kill: async () => {
      lines.close()
      child.stdin.end()
      if (child.exitCode === null) child.kill()
      await exited
    },
  }
}
