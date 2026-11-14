/** Explicit, read-only inspection of legacy Host-owned Desktop settings before Shell import. */
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { JSON_SCHEMA, load } from 'js-yaml'
import type { DesktopShellBehavior } from './shell-behavior.ts'

const MAXIMUM_BYTES = 1024 * 1024

/** Import failures never include settings contents or YAML parser excerpts. */
export type LegacySettingsFailure = 'unreadable' | 'invalid' | 'version' | 'changed'

/** A settings inspection or confirmation failure, translated by the native Shell. */
export class LegacySettingsError extends Error {
  /** @param reason - Safe diagnostic category without document contents. */
  constructor(readonly reason: LegacySettingsFailure) {
    super(`Legacy Desktop settings: ${reason}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readSource(path: string): Promise<Buffer> {
  try {
    const file = await open(path, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile() || stat.size > MAXIMUM_BYTES) throw new LegacySettingsError('invalid')
      const bytes = Buffer.alloc(MAXIMUM_BYTES + 1)
      let length = 0
      while (length < bytes.length) {
        const result = await file.read(bytes, length, bytes.length - length, length)
        if (result.bytesRead === 0) break
        length += result.bytesRead
      }
      if (length > MAXIMUM_BYTES) throw new LegacySettingsError('invalid')
      return bytes.subarray(0, length)
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof LegacySettingsError) throw error
    throw new LegacySettingsError('unreadable')
  }
}

/** A preview tied to selected file bytes; it never modifies the source or OS login registration. */
export class LegacyDesktopSettingsImport {
  private constructor(
    private readonly path: string,
    private readonly digest: string,
    /** Close behavior resolved with the legacy schema's default. */
    readonly closeToTray: boolean,
    /** Legacy preference for display only; OS registration remains authoritative. */
    readonly launchAtLogin: boolean,
  ) {}

  /**
   * Read one explicitly selected JSON/YAML file, at most 1 MiB, without exposing other namespaces.
   * @param path - User-selected source; there is no default path or automatic discovery.
   * @returns A preview for unversioned or formatVersion 1 Desktop settings.
   * @throws LegacySettingsError for unreadable, malformed, or unsupported input.
   */
  static async read(path: string): Promise<LegacyDesktopSettingsImport> {
    if (!['.json', '.yaml', '.yml'].includes(extname(path).toLowerCase())) throw new LegacySettingsError('invalid')
    const bytes = await readSource(path)
    let value: unknown
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      // JSON is a YAML subset; this schema also rejects duplicate keys and non-JSON tags.
      value = load(text, { schema: JSON_SCHEMA })
      if (extname(path).toLowerCase() === '.json') JSON.parse(text)
    } catch {
      throw new LegacySettingsError('invalid')
    }
    if (!isRecord(value)) throw new LegacySettingsError('invalid')
    if (Object.hasOwn(value, 'formatVersion') && value.formatVersion !== 1) throw new LegacySettingsError('version')
    const desktop = value.desktop
    if (!isRecord(desktop) || Object.keys(desktop).some(key => key !== 'closeAction' && key !== 'launchAtLogin')) {
      throw new LegacySettingsError('invalid')
    }
    const closeAction = desktop.closeAction ?? 'tray'
    const launchAtLogin = desktop.launchAtLogin ?? false
    if ((closeAction !== 'tray' && closeAction !== 'quit') || typeof launchAtLogin !== 'boolean'
      || desktop.closeAction === null || desktop.launchAtLogin === null) throw new LegacySettingsError('invalid')
    return new LegacyDesktopSettingsImport(path, createHash('sha256').update(bytes).digest('hex'), closeAction === 'tray', launchAtLogin)
  }

  /**
   * Re-read the confirmed source and atomically apply its close behavior through the Shell owner.
   * @param shell - Existing tray and serialized preference owner; it rejects changes after closing.
   * @returns Completion of persistence; source changes or Shell failures leave the prior preference intact.
   */
  async apply(shell: Pick<DesktopShellBehavior, 'setCloseToTray'>): Promise<void> {
    const bytes = await readSource(this.path)
    if (createHash('sha256').update(bytes).digest('hex') !== this.digest) throw new LegacySettingsError('changed')
    await shell.setCloseToTray(this.closeToTray)
  }
}
