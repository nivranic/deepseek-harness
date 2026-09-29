/** Validate Syft's process receipt before retaining it as candidate evidence. */

interface NpmInventory {
  manifestFiles: number
  versionedPackages: number
  unversionedNamedManifests: number
  npmComponents: number
  missingVersionedPackages: 0
  missingNamedPackages: 0
}

/** Exact scanner bytes, selected catalogers and observed packaged npm coverage. */
export interface SyftReceipt {
  name: 'syft'
  version: string
  archiveSha256: string
  binarySha256: string
  catalogerSet: 'image'
  npmInventory: NpmInventory
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Syft receipt requires objects')
  return value as Record<string, unknown>
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Syft inventory counts must be nonnegative integers')
  return value
}

/**
 * Require a pinned Windows scanner and a completed inventory audit.
 * @param input - JSON from the scanner process.
 * @param registry - current checkout's scanner registry, independent of the process receipt.
 * @returns normalized fields without retaining arbitrary process-provided properties.
 */
export function parseSyftReceipt(input: unknown, registry: unknown): SyftReceipt {
  const value = record(input), tool = record(record(registry).syft)
  const archive = record(record(tool.archives)['win32-x64'])
  if (value.name !== 'syft' || value.catalogerSet !== 'image' || typeof value.version !== 'string'
    || value.version !== tool.version || value.archiveSha256 !== archive.sha256) throw new Error('Syft receipt differs from the pinned scanner')
  for (const key of ['archiveSha256', 'binarySha256']) {
    const digest = value[key]
    if (typeof digest !== 'string' || digest.length !== 64 || !/^[a-f0-9]{64}$/.test(digest)) throw new Error('Syft receipt digest must be SHA-256')
  }
  const inventory = record(value.npmInventory)
  const npmInventory = {
    manifestFiles: number(inventory.manifestFiles), versionedPackages: number(inventory.versionedPackages),
    unversionedNamedManifests: number(inventory.unversionedNamedManifests), npmComponents: number(inventory.npmComponents),
    missingVersionedPackages: 0 as const,
    missingNamedPackages: 0 as const,
  }
  if (inventory.missingVersionedPackages !== 0 || inventory.missingNamedPackages !== 0 || npmInventory.versionedPackages < 1
    || npmInventory.manifestFiles < npmInventory.versionedPackages || npmInventory.npmComponents < npmInventory.versionedPackages
    || npmInventory.unversionedNamedManifests > npmInventory.manifestFiles) throw new Error('Syft inventory coverage is incomplete')
  return { name: 'syft', version: value.version, archiveSha256: String(value.archiveSha256), binarySha256: String(value.binarySha256),
    catalogerSet: 'image', npmInventory }
}
