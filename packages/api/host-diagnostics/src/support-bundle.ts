/** §43 support bundle: deterministic producer, sanitizer, manifest, checksums, and collector validation. */
import { createHash } from 'node:crypto'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DiagnosticsSnapshot, SupportBundle, SupportBundleEntry, SupportBundleEntryKind, SupportBundleManifestEntry } from './types.ts'

/** Canonical per-entry serialization: stable key order is the producer's, not JSON.stringify's. */
function serializeEntry(entry: SupportBundleEntry): string {
  const keys = Object.keys(entry.content as Record<string, unknown>).sort()
  const record: Record<string, unknown> = { kind: entry.kind }
  for (const key of keys) record[key] = (entry.content as Record<string, unknown>)[key]
  return JSON.stringify(record)
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex')

/** The closed entry-kind vocabulary as a runtime set for unknown-kind inputs. */
const ENTRY_KINDS: ReadonlySet<string> = new Set(['diagnostics', 'session-headers'])

/** Keys the sanitizer refuses regardless of entry kind: secret-shaped channels never enter a bundle. */
const FORBIDDEN_KEY_PATTERN = /api[-_]?key|bearer|secret|password|credential/iu

/**
 * Sanitize one candidate entry for bundle inclusion.
 * @param kind - the closed entry vocabulary; anything else is refused.
 * @param path - stable bundle path; must be unique and non-empty.
 * @param content - JSON-safe object; every key must survive the secret-shape scan.
 * @returns the sanitized entry.
 * @throws Error naming the first rule the candidate violated.
 */
export function sanitizeSupportBundleEntry(
  kind: SupportBundleEntryKind,
  path: string,
  content: unknown,
): SupportBundleEntry {
  if (!ENTRY_KINDS.has(kind)) {
    throw new Error(`support bundle entry kind "${kind}" is not in the closed vocabulary`)
  }
  if (path === '') throw new Error('support bundle entry path must be non-empty')
  if (typeof content !== 'object' || content === null || Array.isArray(content)) {
    throw new Error(`support bundle entry "${path}" must be a JSON object`)
  }
  return { kind, path, content: scanKeys(content, path) }
}

/**
 * Refuse secret-shaped keys at any depth and confirm JSON safety (a value the
 * canonical serializer could silently mangle never enters a bundle); the
 * sanitizer never trusts a shallow shape.
 * @returns the same value typed at the wire's JsonValue vocabulary.
 */
function scanKeys(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map(member => scanKeys(member, path))
  if (typeof value !== 'object') {
    throw new Error(`support bundle entry "${path}" carries a non-JSON value of type ${typeof value}`)
  }
  const record: Record<string, JsonValue> = {}
  for (const [key, member] of Object.entries(value)) {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new Error(`support bundle entry "${path}" carries a secret-shaped key "${key}"`)
    }
    record[key] = scanKeys(member, path)
  }
  return record
}

/**
 * Produce one deterministic support bundle (§43): sanitized entries sorted by
 * path, a manifest row per entry over its canonical serialization, and the
 * chained checksum over the ordered manifest rows.
 * @param candidates - entries to sanitize; duplicate paths are refused.
 * @returns the sealed bundle.
 */
export function buildSupportBundle(
  candidates: readonly { readonly kind: SupportBundleEntryKind; readonly path: string; readonly content: JsonValue }[],
): SupportBundle {
  const entries = candidates.map(candidate =>
    sanitizeSupportBundleEntry(candidate.kind, candidate.path, candidate.content))
  entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  const seen = new Set<string>()
  const manifest: SupportBundleManifestEntry[] = []
  for (const entry of entries) {
    if (seen.has(entry.path)) throw new Error(`support bundle entry path "${entry.path}" is duplicated`)
    seen.add(entry.path)
    manifest.push({ path: entry.path, sha256: sha256(serializeEntry(entry)) })
  }
  const checksum = sha256(manifest.map(row => `${row.path}:${row.sha256}`).join('\n'))
  return { manifest, checksum, entries }
}

/**
 * Collector validation (§43): recompute every entry checksum and the chained
 * checksum and refuse any drift, so a bundle tampered in transit fails loud
 * instead of diagnosing a lie.
 * @param bundle - the artifact to validate.
 * @throws Error naming the first inconsistency.
 */
export function validateSupportBundle(bundle: SupportBundle): void {
  if (bundle.entries.length !== bundle.manifest.length) {
    throw new Error('support bundle manifest and entries disagree in count')
  }
  const byPath = new Map(bundle.entries.map(entry => [entry.path, entry]))
  for (const row of bundle.manifest) {
    const entry = byPath.get(row.path)
    if (entry === undefined) throw new Error(`support bundle manifest names missing entry "${row.path}"`)
    const digest = sha256(serializeEntry(entry))
    if (digest !== row.sha256) {
      throw new Error(`support bundle entry "${row.path}" fails its checksum`)
    }
  }
  const ordered = [...bundle.manifest].sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
  if (ordered.some((row, index) => row.path !== bundle.manifest[index]?.path)) {
    throw new Error('support bundle manifest is not sorted by path')
  }
  const checksum = sha256(bundle.manifest.map(row => `${row.path}:${row.sha256}`).join('\n'))
  if (checksum !== bundle.checksum) throw new Error('support bundle chained checksum fails')
}

/**
 * The diagnostics producer entry for one bundle: the §42 snapshot as the
 * sanitized `diagnostics` entry at its stable path.
 * @param snapshot - the §42 payload this Host just composed.
 * @returns the bundle entry candidate.
 */
export function diagnosticsBundleEntry(snapshot: DiagnosticsSnapshot): SupportBundleEntry {
  return sanitizeSupportBundleEntry('diagnostics', 'diagnostics.json', JSON.parse(JSON.stringify(snapshot)) as JsonValue)
}
