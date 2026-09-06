/**
 * JSON storage backend: one human-readable document per unit under a
 * configured root — a whole-unit file (`single` layout) or one document per
 * record (`per-record` layout), published by atomic rewrite. Registers as
 * backend `json` on the storage hub.
 * @module @deepseek-ai/dsh-storage-json
 */

import { mkdir } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { StorageError, UNIT_NAME_RE, storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import type { KvFacet, KvUnit, KvUnitDescriptor, StorageBackend } from '@deepseek-ai/dsh-storage'
import { openSingleUnit } from './single-unit.ts'
import { openPerRecordUnit } from './per-record-unit.ts'

/** Cordis plugin name. */
export const name = 'storage-json'
/** The hub must exist before the backend can register. */
export const inject = ['storage']

/**
 * Plugin configuration.
 * `root` has NO default on purpose: a `process.cwd()` fallback would scatter
 * unit files wherever the process happens to start; assemblies state the
 * location explicitly.
 */
export interface Config {
  /** Directory holding one `<unit>.json` file (or `<unit>/` tree) per unit. */
  root: string
}

/** Config schema. */
export const Config: z<Config> = z.object({
  root: z.string().required(),
})

/** JSON backend: owns the file-tree root and serves the `kv` facet. */
export class JsonStorageBackend implements StorageBackend {
  private readonly open = new Map<string, KvUnit>()
  private readonly owners = new Map<string, () => Promise<void>>()
  // Reserved synchronously at open() entry so a concurrent open of the same
  // unit fails, and close() can await opens still in flight.
  private readonly opening = new Map<string, Promise<KvUnit>>()
  private closing?: Promise<void>

  constructor(private readonly root: string) {}

  readonly kv: KvFacet = {
    // The body up to the first await runs synchronously, so the opening-slot
    // reservation below still excludes a concurrent open of the same unit.
    open: async (descriptor: KvUnitDescriptor, onBackendClose?: () => Promise<void>): Promise<KvUnit> => {
      if (this.closing !== undefined) throw new StorageError('closed', 'json backend is closed')
      validateDescriptor(descriptor)
      if (this.open.has(descriptor.name) || this.opening.has(descriptor.name)) {
        // Double-open is a caller bug, not a medium condition.
        throw new Error(`unit '${descriptor.name}' is already open; a unit has exactly one live handle`)
      }
      const opening = this.openUnit(descriptor, onBackendClose)
      this.opening.set(descriptor.name, opening)
      return opening.finally(() => this.opening.delete(descriptor.name))
    },
  }

  private async openUnit(descriptor: KvUnitDescriptor, onBackendClose?: () => Promise<void>): Promise<KvUnit> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    // The two layouts differ in medium shape only; each opener owns its own
    // path convention under the shared root.
    const onClose = () => {
      this.open.delete(descriptor.name)
      this.owners.delete(descriptor.name)
    }
    const unit = descriptor.layout === 'per-record'
      ? await openPerRecordUnit(descriptor, this.root, onClose)
      : await openSingleUnit(descriptor, this.root, onClose)
    if (this.closing !== undefined) {
      // The backend closed while this open was in flight: do not hand out a
      // live unit past close().
      await unit.close()
      throw new StorageError('closed', 'json backend is closed')
    }
    this.open.set(descriptor.name, unit)
    if (onBackendClose !== undefined) this.owners.set(descriptor.name, onBackendClose)
    return unit
  }

  close(): Promise<void> {
    this.closing ??= this.doClose()
    return this.closing
  }

  private async doClose(): Promise<void> {
    await Promise.allSettled([...this.opening.values()])
    const results = await Promise.allSettled([...this.open].map(async ([name, unit]) => {
      try {
        await this.owners.get(name)?.()
      } finally {
        await unit.close()
      }
    }))
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length > 0) throw new AggregateError(failures.map(result => result.reason as unknown), 'JSON unit teardown failed')
  }
}

function validateDescriptor(descriptor: KvUnitDescriptor): void {
  if (!UNIT_NAME_RE.test(descriptor.name)) {
    throw new StorageError('malformed-medium', `invalid unit name '${descriptor.name}'`)
  }
  for (const table of descriptor.tables) {
    if (!UNIT_NAME_RE.test(table)) {
      throw new StorageError('malformed-medium', `invalid table name '${table}' in unit '${descriptor.name}'`)
    }
  }
}

/**
 * Register the `json` backend on the storage hub.
 * @param ctx - Plugin context.
 * @param config - Validated configuration.
 */
export function apply(ctx: Context, config: Config) {
  const backend = new JsonStorageBackend(config.root)
  ctx.effect(function* () {
    const unregister = ctx.storage.backend.register('json', backend)
    yield async () => {
      unregister()
      await backend.close()
    }
    // Service withdrawal stops active consumers; owner callbacks also join
    // consumers already detached from the registry during whole-tree teardown.
    yield ctx.provide(storageBackendServiceKey('json'), backend)
  })
}
