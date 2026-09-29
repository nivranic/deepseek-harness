/** Native diagnostic observations follow actual operation settlement without changing its outcome. */
import { describe, expect, it } from 'vitest'
import { DesktopRuntimeDiagnostics } from '../apps/desktop/src/runtime-diagnostics.ts'

describe('desktop profile lifecycle diagnostics', () => {
  it('records startup and shutdown only after their operations settle', async () => {
    const runtime = new DesktopRuntimeDiagnostics()
    const before = runtime.snapshot()
    expect(before).toEqual({ phase: 'idle' })
    const opened = Promise.withResolvers<object>()
    const starting = runtime.startup(() => {
      expect(runtime.snapshot()).toEqual({ phase: 'starting' })
      return opened.promise
    })
    const value = {}
    opened.resolve(value)
    expect(await starting).toBe(value)
    expect(runtime.snapshot()).toEqual({ phase: 'ready' })
    const closed = Promise.withResolvers<undefined>()
    const stopping = runtime.shutdown(() => closed.promise)
    expect(runtime.snapshot()).toEqual({ phase: 'stopping' })
    closed.resolve(undefined)
    await stopping
    expect(runtime.snapshot()).toEqual({ phase: 'stopped' })
    Object.assign(runtime.snapshot(), { phase: 'starting' })
    expect(runtime.snapshot()).toEqual({ phase: 'stopped' })
  })

  it.each(['startup', 'shutdown'] as const)('retains the original %s rejection without exporting its message', async (kind) => {
    const runtime = new DesktopRuntimeDiagnostics()
    const error = new Error('private profile path')
    const pending = runtime[kind](() => { throw error })
    await expect(pending).rejects.toBe(error)
    expect(runtime.snapshot()).toEqual({ phase: 'failed', operation: kind })
    expect(JSON.stringify(runtime.snapshot())).not.toContain('private')
  })

  it.each(['resolve', 'reject'] as const)('keeps shutdown state when an earlier startup later %ss', async (outcome) => {
    const runtime = new DesktopRuntimeDiagnostics()
    const opened = Promise.withResolvers<undefined>()
    const starting = runtime.startup(() => opened.promise)
    await runtime.shutdown(() => Promise.resolve())
    if (outcome === 'resolve') {
      opened.resolve(undefined)
      await starting
    } else {
      const error = new Error('retired startup failed')
      const rejected = expect(starting).rejects.toBe(error)
      opened.reject(error)
      await rejected
    }
    expect(runtime.snapshot()).toEqual({ phase: 'stopped' })
  })
})
