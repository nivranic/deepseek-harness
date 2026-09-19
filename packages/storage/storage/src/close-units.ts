/** Shared owner-before-unit teardown for storage providers. */

import type { KvUnit } from './backend.ts'

/** One open unit and the owner whose accepted writes must finish before it closes. */
export interface OwnedKvUnit {
  readonly unit: KvUnit
  readonly onBackendClose: (() => Promise<void>) | undefined
}

/**
 * Stop unit owners, drain their accepted work, and release the underlying medium.
 * Each unit closes even when its owner rejects; independent owners settle before
 * the medium release runs. Failures retain registration order.
 * @param units - Open units captured when backend teardown begins.
 * @param releaseMedium - Optional final synchronous medium release.
 * @returns completion after every cleanup operation settles.
 * @throws AggregateError containing all owner, unit, and medium cleanup failures.
 */
export async function closeOwnedKvUnits(
  units: Iterable<OwnedKvUnit>,
  releaseMedium?: () => void,
): Promise<void> {
  const results = await Promise.all([...units].map(async ({ unit, onBackendClose }) => {
    const errors: unknown[] = []
    try {
      await onBackendClose?.()
    } catch (error) {
      errors.push(error)
    }
    try {
      await unit.close()
    } catch (error) {
      errors.push(error)
    }
    return errors
  }))
  const errors = results.flat()
  try {
    releaseMedium?.()
  } catch (error) {
    errors.push(error)
  }
  if (errors.length > 0) throw new AggregateError(errors, 'Storage backend teardown failed')
}
