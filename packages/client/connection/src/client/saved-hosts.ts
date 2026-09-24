/** §28 saved-Host roster: persisted identity facts of every admitted Host this client reached. */

import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'

declare module '@deepseek-ai/dsh-client-connection/client' {
  interface ConnectionHostInfo {
    /** Same optional member the remotes host-preparation merge carries; additive for the roster. */
    readonly descriptor?: HostDescriptor
  }
}

/** One saved Host: identity facts from one admitted generation, refreshed on every reconnect. */
export interface SavedHost {
  /** Host descriptor id; the roster's stable key. */
  readonly hostId: string
  /** Descriptor display name as the generation carried it. */
  readonly displayName: string | undefined
  /** Host Node.js platform as the generation carried it. */
  readonly platform: string | undefined
  /** Origin this client reached the Host through. */
  readonly origin: string
  /** Epoch milliseconds of the most recent established generation to this Host. */
  readonly lastConnectedAt: number
}

/** Roster bound: the most recently connected Hosts survive a record. */
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
  const storage = (globalThis as { readonly localStorage?: Storage }).localStorage
  if (storage === undefined) return undefined
  return {
    read: () => storage.getItem(STORAGE_KEY) ?? undefined,
    write: (value) => { storage.setItem(STORAGE_KEY, value) },
  }
}

/** Durable-boundary validation for one persisted row. */
function parseRow(value: unknown): SavedHost | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { hostId, displayName, platform, origin, lastConnectedAt } = value as Record<string, unknown>
  if (typeof hostId !== 'string' || hostId.length === 0) return undefined
  if (displayName !== undefined && typeof displayName !== 'string') return undefined
  if (platform !== undefined && typeof platform !== 'string') return undefined
  if (typeof origin !== 'string' || origin.length === 0) return undefined
  if (typeof lastConnectedAt !== 'number' || !Number.isFinite(lastConnectedAt)) return undefined
  return { hostId, displayName, platform, origin, lastConnectedAt }
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
      this.rows = sortRows(rows)
    } catch {
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
   * Upsert one Host: an existing hostId row moves to the front with refreshed facts.
   * @param host - identity facts from an established generation.
   */
  record(host: SavedHost): void {
    const rows = [host, ...this.rows.filter(row => row.hostId !== host.hostId)]
    this.rows = sortRows(rows).slice(0, MAX_SAVED_HOSTS)
    this.persist()
    this.changed()
  }

  /**
   * Remove one saved Host; absent ids leave the roster unchanged.
   * @param hostId - roster key to remove.
   */
  remove(hostId: string): void {
    if (!this.rows.some(row => row.hostId === hostId)) return
    this.rows = this.rows.filter(row => row.hostId !== hostId)
    this.persist()
    this.changed()
  }

  /**
   * Subscribe to roster changes.
   * @param listener - runs after every record or remove.
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
    for (const listener of [...this.listeners]) listener()
  }
}

/** Most recent connection first; the record timestamp is the only sort key. */
function sortRows(rows: readonly SavedHost[]): readonly SavedHost[] {
  return [...rows].sort((left, right) => right.lastConnectedAt - left.lastConnectedAt)
}

/** What a switch action needs: the roster rows plus the connection's retarget seam. */
export interface SavedHostSwitchTarget {
  /** §28 roster rows, most recent first. */
  readonly savedHosts: { list(): readonly SavedHost[] }
  /** §28 switch seam: select the Host base and replace the current attempt. */
  retarget(origin: string | undefined): void
}

/**
 * Switch the connection to one saved Host: the row's origin becomes the
 * selected base through `retarget`, and the row is returned for presentation.
 * An unknown hostId or an `in-process` row leaves the connection untouched —
 * the in-page fallback has no origin to target, and any other malformed origin
 * fails loudly inside `retarget` itself.
 * @param target - connection handle carrying the roster and the switch seam.
 * @param hostId - roster key of the Host to switch to.
 * @returns the switched saved Host, or undefined when no switchable row matches.
 */
export function switchToSavedHost(target: SavedHostSwitchTarget, hostId: string): SavedHost | undefined {
  const row = target.savedHosts.list().find(item => item.hostId === hostId)
  if (row === undefined || row.origin === 'in-process') return undefined
  target.retarget(row.origin)
  return row
}
