/** Browser-local Host bookmarks, preserving saved names and manual order. */

import type { HostId } from '@deepseek-ai/dsh-api-remotes/client'

/** One saved Host: identity facts from one admitted generation, refreshed on every reconnect. */
export interface SavedHost {
  /** Host descriptor id; the roster's stable key. */
  readonly hostId: HostId
  /** Descriptor display name as the generation carried it. */
  readonly displayName: string | undefined
  /** Client-chosen display name overriding {@link displayName} until renamed away; survives reconnects. */
  readonly customName?: string
  /** Host Node.js platform as the generation carried it. */
  readonly platform: string | undefined
  /** Origin this client reached the Host through. */
  readonly origin: string
  /** Epoch milliseconds of the most recent established generation to this Host. */
  readonly lastConnectedAt: number
  /** Client-chosen position overriding recency ordering until moved away; survives reconnects. */
  readonly order?: number
}

/** Maximum retained bookmarks; manual order precedes connection recency. */
export const MAX_SAVED_HOSTS = 8

const STORAGE_KEY = 'dsh-saved-hosts.v1'

/** Durable sink for the roster; corrupt contents drop at parse, never crash boot. */
export interface SavedHostsPersistence {
  /** @returns the persisted serialized roster, when one exists. */
  read(): string | undefined
  /** @param value - serialized roster to persist. */
  write(value: string): void
}

/**
 * localStorage-backed persistence; compositions without storage (SSR, restricted) get none.
 * @returns the persistence adapter, or undefined when no storage exists.
 */
export function browserSavedHostsPersistence(): SavedHostsPersistence | undefined {
  const storage = browserStorage()
  if (storage === undefined) return undefined
  return {
    read: () => readStorage(storage, STORAGE_KEY),
    write: (value) => { writeStorage(storage, STORAGE_KEY, value) },
  }
}

/** Durable-boundary validation for one persisted row. */
function parseRow(value: unknown): SavedHost | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { hostId, displayName, customName, platform, origin, lastConnectedAt, order } = value as Record<string, unknown>
  if (typeof hostId !== 'string' || hostId.length === 0) return undefined
  if (displayName !== undefined && typeof displayName !== 'string') return undefined
  if (customName !== undefined && typeof customName !== 'string') return undefined
  if (platform !== undefined && typeof platform !== 'string') return undefined
  if (typeof origin !== 'string' || origin.length === 0) return undefined
  if (origin !== 'in-process') {
    let url: URL
    try {
      url = new URL(origin)
    } catch (_error) {
      // Persisted origins outside URL syntax cannot be connection targets.
      return undefined
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== origin) return undefined
  }
  if (typeof lastConnectedAt !== 'number' || !Number.isFinite(lastConnectedAt)) return undefined
  if (order !== undefined && (typeof order !== 'number' || !Number.isFinite(order))) return undefined
  return {
    hostId: hostId as HostId, displayName, platform, origin, lastConnectedAt,
    ...(customName === undefined ? {} : { customName }),
    ...(order === undefined ? {} : { order }),
  }
}

/**
 * The saved-Host roster: upserts keyed by hostId, ordered most-recent first,
 * capped at {@link MAX_SAVED_HOSTS}; every change notifies subscribers.
 */
export class SavedHostsStore {
  private rows: readonly SavedHost[] = []
  private readonly listeners = new Set<() => void>()

  /**
   * @param persistence - durable sink; without one the roster lives for this page session only.
   */
  constructor(private readonly persistence?: SavedHostsPersistence) {
    const raw = persistence?.read()
    if (raw === undefined) return
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      const rows: SavedHost[] = []
      for (const row of parsed) {
        const saved = parseRow(row)
        if (saved !== undefined) rows.push(saved)
      }
      this.rows = sortRows(rows).slice(0, MAX_SAVED_HOSTS)
    } catch (_error) {
      // Only the persisted roster's own JSON can fail here; a corrupt roster starts empty.
    }
  }

  /** Read the roster.
   * @returns the saved Hosts, most recently connected first within the cap.
   */
  list(): readonly SavedHost[] {
    return this.rows
  }

  /**
   * Upsert one Host: an existing hostId row moves to the front with refreshed
   * facts; a client-chosen {@link SavedHost.customName} survives the refresh.
   * @param host - identity facts from an established generation.
   */
  record(host: SavedHost): void {
    const existing = this.rows.find(row => row.hostId === host.hostId)
    const keep = (customName: string | undefined, order: number | undefined): SavedHost => {
      if (customName === undefined && order === undefined) return host
      return {
        ...host,
        ...(customName === undefined ? {} : { customName }),
        ...(order === undefined ? {} : { order }),
      }
    }
    const refreshed = existing === undefined ? host : keep(existing.customName, existing.order)
    const rows = [refreshed, ...this.rows.filter(row => row.hostId !== host.hostId)]
    this.rows = sortRows(rows).slice(0, MAX_SAVED_HOSTS)
    this.persist()
    this.changed()
  }

  /**
   * Rename one saved Host in place: a non-empty string overrides the descriptor
   * name, `undefined` returns the row to descriptor facts. Row order is a
   * connection-recency fact and never moves on a rename.
   * @param hostId - roster key to rename.
   * @param customName - client-chosen display name, or undefined to clear it.
   * @returns whether a roster row changed.
   */
  rename(hostId: HostId, customName: string | undefined): boolean {
    const row = this.rows.find(item => item.hostId === hostId)
    if (row === undefined || row.customName === customName) return false
    const renamed: SavedHost = {
      hostId: row.hostId,
      displayName: row.displayName,
      platform: row.platform,
      origin: row.origin,
      lastConnectedAt: row.lastConnectedAt,
      ...(customName === undefined ? {} : { customName }),
      ...(row.order === undefined ? {} : { order: row.order }),
    }
    this.rows = this.rows.map(item => item === row ? renamed : item)
    this.persist()
    this.changed()
    return true
  }

  /**
   * Move one saved Host one position against the presented order: the swap
   * stamps an explicit {@link SavedHost.order} on every row, so the manual
   * arrangement survives reconnect refreshes and reloads. Boundary and
   * unknown moves leave the roster unchanged without notifying.
   * @param hostId - roster key to move.
   * @param direction - `up` towards the front, `down` towards the end.
   * @returns whether the roster order changed.
   */
  moveHost(hostId: HostId, direction: 'up' | 'down'): boolean {
    const index = this.rows.findIndex(item => item.hostId === hostId)
    const target = direction === 'up' ? index - 1 : index + 1
    if (index < 0 || target < 0 || target >= this.rows.length) return false
    const rows = [...this.rows]
    const moving = rows[index]
    const neighbor = rows[target]
    // Both indices are inside the roster after the guard; the check only narrows the indexed access.
    if (moving === undefined || neighbor === undefined) return false
    rows[index] = neighbor
    rows[target] = moving
    this.rows = rows.map((row, position) => ({ ...row, order: position }))
    this.persist()
    this.changed()
    return true
  }

  /**
   * Remove one saved Host; absent ids leave the roster unchanged.
   * @param hostId - roster key to remove.
   */
  remove(hostId: HostId): void {
    if (!this.rows.some(row => row.hostId === hostId)) return
    this.rows = this.rows.filter(row => row.hostId !== hostId)
    this.persist()
    this.changed()
  }

  /**
   * Subscribe to roster changes.
   * @param listener - runs after every record, rename, move, or remove.
   * @returns disposer removing this listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private persist(): void {
    this.persistence?.write(`${JSON.stringify(this.rows)}\n`)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (error) {
        console.error('[ui-settings-hosts] bookmark listener threw:', error)
      }
    }
  }
}

/** A client-chosen position first, most recent connection first within and after it. */
function sortRows(rows: readonly SavedHost[]): readonly SavedHost[] {
  return [...rows].sort((left, right) => {
    const leftOrder = left.order ?? Number.POSITIVE_INFINITY
    const rightOrder = right.order ?? Number.POSITIVE_INFINITY
    return leftOrder !== rightOrder ? leftOrder - rightOrder : right.lastConnectedAt - left.lastConnectedAt
  })
}

/** Storage may be unavailable to an embedded or restricted browser origin. */
function browserStorage(): Storage | undefined {
  try {
    return (globalThis as { readonly localStorage?: Storage }).localStorage
  } catch (_error) {
    // A denied localStorage getter leaves the roster in memory.
    return undefined
  }
}

/** Read failures do not prevent connection startup. */
function readStorage(storage: Storage, key: string): string | undefined {
  try {
    return storage.getItem(key) ?? undefined
  } catch (_error) {
    // Storage permission may be revoked after obtaining the Storage object.
    return undefined
  }
}

/** Storage denial and exhausted quota leave the live in-memory selection usable. */
function writeStorage(storage: Storage, key: string, value: string | undefined): void {
  const write = value === undefined ? () => { storage.removeItem(key) } : () => { storage.setItem(key, value) }
  try {
    write()
  } catch (_error) {
    // Browser storage is optional; its permission and quota failures are not connection failures.
  }
}
