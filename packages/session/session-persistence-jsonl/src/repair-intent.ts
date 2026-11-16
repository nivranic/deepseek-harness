/** Version-one recovery records shared by current reads and historical generation migration. */
import { stat } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionFormatError, SessionFormatEventCollector, SessionFormatUnsupportedMigrationError } from '@deepseek-ai/dsh-session-format'
import type { SessionFormatRestore } from '@deepseek-ai/dsh-session-format'
import { releasedV3SessionFormatCodec, releasedV4SessionFormatCodec } from '@deepseek-ai/dsh-session-format-v3-to-v4'

/** Envelope admission precedes event validation by the owning generation's codec. */
export interface RepairIntent {
  readonly version: 1
  readonly id: SessionId
  readonly truncateTo: number
  readonly events: readonly { readonly seq: number }[]
}

/**
 * Parse recovery identity and contiguous sequence numbers; the owning codec validates event contents.
 * @param bytes - complete recovery document.
 * @param id - identity of the adjacent Session log.
 * @returns the version-one recovery envelope.
 */
export function parseRepairIntent(bytes: Buffer, id: SessionId): RepairIntent {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'))
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected an object')
    const row = value as Record<string, unknown>
    if (row.version !== 1 || row.id !== id || typeof row.truncateTo !== 'number'
      || !Number.isSafeInteger(row.truncateTo) || row.truncateTo < 0 || !Array.isArray(row.events)) {
      throw new Error('invalid recovery identity or fields')
    }
    const events: unknown[] = row.events
    let previous: number | undefined
    for (const value of events) {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid event')
      const event = value as Record<string, unknown>
      if (typeof event.seq !== 'number' || !Number.isSafeInteger(event.seq) || event.seq < 0
        || previous !== undefined && event.seq !== previous + 1) throw new Error('non-contiguous recovery records')
      previous = event.seq
    }
    return { version: 1, id, truncateTo: row.truncateTo, events: events as { readonly seq: number }[] }
  } catch (error) {
    throw new SessionFormatError(`session "${id}": invalid repair intent`, { cause: error })
  }
}

/**
 * Observe recovery state independently of the adjacent log's bytes.
 * @param path - primary Session log path.
 * @returns a physical identity, or undefined only when the recovery file is absent.
 */
export async function repairIntentRevision(path: string): Promise<string | undefined> {
  try {
    const value = await stat(`${path}.repair-intent`, { bigint: true })
    return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(':')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Reconcile recovery events in their source format before any adjacent migration consumes them.
 * @param restore - the ordinary format-owned restore pipeline.
 * @param header - original physical header, including its source version.
 * @param version - source format version.
 * @param bytes - surviving version-one recovery document.
 * @returns a restore that validates overlaps and feeds only missing source records to migration.
 */
export function restoreWithRepairIntent(
  restore: SessionFormatRestore,
  header: Record<string, unknown>,
  version: number,
  bytes: Buffer,
): SessionFormatRestore {
  const codec = version === 3 ? releasedV3SessionFormatCodec : version === 4 ? releasedV4SessionFormatCodec : undefined
  if (codec === undefined) throw new SessionFormatUnsupportedMigrationError(`repair intents are unsupported for Session v${version}`)
  const intent = parseRepairIntent(bytes, SessionId(restore.header.id))
  const decoder = codec.createDecoder(header, 'recoverable')
  const source = new SessionFormatEventCollector()
  return {
    header: restore.header,
    decodeRow(row) {
      decoder.decodeRow(row, source)
      restore.decodeRow(row)
    },
    finish() {
      decoder.finish(source)
      const merged: { readonly seq: number }[] = [...source.values]
      for (const event of intent.events) {
        if (event.seq < merged.length) {
          if (!isDeepStrictEqual(merged[event.seq], event)) throw new SessionFormatError('repair intent contradicts stored records')
        } else if (event.seq === merged.length) merged.push(event)
        else throw new SessionFormatError('repair intent leaves a sequence gap')
      }
      const strict = codec.createDecoder(header, 'strict')
      const checked = new SessionFormatEventCollector()
      for (const event of merged) strict.decodeRow(event, checked)
      strict.finish(checked)
      for (const event of merged.slice(source.values.length)) restore.decodeRow(event)
      return restore.finish()
    },
  }
}
