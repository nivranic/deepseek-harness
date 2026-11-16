/** Shell-only preferences, serialized by the application's single-instance owner. */
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

interface PreferencesDocument {
  readonly schemaVersion: 1
  readonly closeToTray: boolean
}

function readPreferences(path: string): PreferencesDocument {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, closeToTray: false }
    throw error
  }
  const value: unknown = JSON.parse(text)
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || !('schemaVersion' in value) || value.schemaVersion !== 1
    || !('closeToTray' in value) || typeof value.closeToTray !== 'boolean'
    || Object.keys(value).length !== 2) {
    throw new Error(`Desktop preferences require schemaVersion 1 and closeToTray: ${path}`)
  }
  return { schemaVersion: 1, closeToTray: value.closeToTray }
}

/** Persist close behavior without sharing the Host's settings namespace or OS login state. */
export class DesktopShellPreferences {
  private current: PreferencesDocument
  private pending: Promise<void> = Promise.resolve()
  private closed = false

  /** @param path - Shell-owned JSON file, read after the single-instance lock is acquired. */
  constructor(private readonly path: string) {
    this.current = readPreferences(path)
  }

  /** Whether closing the primary window hides it after creating a usable tray icon. */
  get closeToTray(): boolean { return this.current.closeToTray }

  /** @returns Completion of currently admitted writes without closing the preference owner. */
  flush(): Promise<void> { return this.pending }

  /**
   * Serialize a preference write and publish its value only after replacement succeeds.
   * @param enabled - Requested close behavior.
   * @returns Completion of the atomic replacement; rejects after shutdown or on write failure.
   */
  setCloseToTray(enabled: boolean): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Desktop preferences are closed'))
    const operation = this.pending.then(async () => {
      const next: PreferencesDocument = { schemaVersion: 1, closeToTray: enabled }
      await writeFileAtomic(this.path, `${JSON.stringify(next)}\n`, { mode: 0o600, dirMode: 0o700 })
      this.current = next
    })
    // Each caller receives its own write error; a later request can still repair the setting.
    this.pending = operation.catch(() => {})
    return operation
  }

  /** @returns Completion of admitted writes after refusing further changes. */
  close(): Promise<void> {
    this.closed = true
    return this.pending
  }
}
