/** Observes the native owner's profile operations without controlling their execution or errors. */
import type { DesktopRuntimeSnapshot } from '@deepseek-ai/dsh-host-electron-ipc/types'

/** Latest profile lifecycle observation; an earlier operation cannot replace a later one's state. */
export class DesktopRuntimeDiagnostics {
  private current: object | undefined
  private value: DesktopRuntimeSnapshot = { phase: 'idle' }

  /** @returns a value copy without profile paths, errors or service objects. */
  snapshot(): DesktopRuntimeSnapshot { return { ...this.value } }

  /**
   * Observe the application's existing startup operation and preserve its result or rejection.
   * @param operation - the native owner's profile startup.
   * @returns the same startup result after recording settlement.
   */
  startup<T>(operation: () => Promise<T>): Promise<T> { return this.observe('startup', operation) }

  /**
   * Observe the application's existing shutdown operation without changing its completion semantics.
   * @param operation - shutdown owned by the booted profile handle.
   * @returns completion after the operation settles, retaining its original rejection.
   */
  shutdown(operation: () => Promise<void>): Promise<void> { return this.observe('shutdown', operation) }

  private async observe<T>(kind: 'startup' | 'shutdown', operation: () => Promise<T>): Promise<T> {
    const owner = {}
    this.current = owner
    this.value = { phase: kind === 'startup' ? 'starting' : 'stopping' }
    try {
      const result = await operation()
      if (this.current === owner) this.value = { phase: kind === 'startup' ? 'ready' : 'stopped' }
      return result
    } catch (error) {
      if (this.current === owner) this.value = { phase: 'failed', operation: kind }
      throw error
    }
  }
}
