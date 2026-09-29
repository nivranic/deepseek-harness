/** Payload-free product diagnostics; collection completeness is independent of recorded failures. */
import { parseProductIdentity, type ProductIdentity } from './product-identity.ts'

const PLATFORMS = ['windows', 'macos', 'ios', 'android'] as const
const RUNTIMES = ['full', 'companion', 'lite'] as const
const STATUSES = ['OBSERVED', 'NO_REPORT', 'UNAVAILABLE', 'INCOMPLETE'] as const
const ERROR_CLASSES = ['native-crash', 'anr', 'startup', 'health', 'connection', 'protocol', 'storage', 'update', 'permission'] as const

/** Release and runtime identity attached by the diagnostic producer. */
export interface DiagnosticProduct {
  version: string
  buildNumber: number
  channel: ProductIdentity['channel']
  sourceSha: string
  platform: typeof PLATFORMS[number]
  runtimeClass: typeof RUNTIMES[number]
}

/** Closed categories and counts contain no exception messages, frames, paths, IDs or business content. */
export interface ProductDiagnostics extends DiagnosticProduct {
  schemaVersion: 1
  status: typeof STATUSES[number]
  collectionErrors: number
  errors: Array<{ errorClass: typeof ERROR_CLASSES[number]; count: number }>
}

function object(input: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error('diagnostic input must be an object')
  const value = input as Record<string, unknown>
  if (keys !== undefined && (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key)))) {
    throw new Error('diagnostic input has missing or unknown fields')
  }
  return value
}

function choice<T extends string>(input: unknown, choices: readonly T[]): T {
  if (typeof input !== 'string' || !choices.includes(input as T)) throw new Error('unsupported diagnostic category')
  return input as T
}

function count(input: unknown): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < 0) throw new Error('diagnostic count must be a nonnegative safe integer')
  return input
}

/**
 * Validate a serialized diagnostic without retaining unrecognized fields or echoing rejected input.
 * @param input - parsed diagnostic JSON from a file or wire message.
 * @returns canonical diagnostic metadata and closed error categories.
 */
export function parseProductDiagnostics(input: unknown): ProductDiagnostics {
  const row = object(input, ['schemaVersion', 'version', 'buildNumber', 'channel', 'sourceSha', 'platform', 'runtimeClass', 'status', 'collectionErrors', 'errors'])
  if (row.schemaVersion !== 1) throw new Error('unsupported diagnostic schema')
  let identity: ProductIdentity
  try {
    identity = parseProductIdentity({ version: row.version }, { schemaVersion: 1, buildNumber: row.buildNumber, channel: row.channel })
  } catch {
    // Version validation can include rejected values; diagnostic errors must not copy input.
    throw new Error('invalid diagnostic product identity')
  }
  if (typeof row.sourceSha !== 'string' || row.sourceSha.length !== 40 || !/^[a-f0-9]{40}$/.test(row.sourceSha)) {
    throw new Error('diagnostic source must be a full Git SHA')
  }
  const platform = choice(row.platform, PLATFORMS)
  const runtimeClass = choice(row.runtimeClass, RUNTIMES)
  if (runtimeClass === 'full' && (platform === 'ios' || platform === 'android')) throw new Error('mobile diagnostics cannot claim a Full Host runtime')
  const status = choice(row.status, STATUSES)
  const collectionErrors = count(row.collectionErrors)
  if (!Array.isArray(row.errors) || row.errors.length > ERROR_CLASSES.length) throw new Error('invalid diagnostic error inventory')
  const errors = row.errors.map((input: unknown) => {
    const error = object(input, ['errorClass', 'count'])
    const errorClass = choice(error.errorClass, ERROR_CLASSES)
    const occurrences = count(error.count)
    if (occurrences === 0 || (errorClass === 'anr' && platform !== 'android')) throw new Error('invalid diagnostic error occurrence')
    return { errorClass, count: occurrences }
  })
  if (new Set(errors.map(error => error.errorClass)).size !== errors.length) throw new Error('duplicate diagnostic error category')
  if ((status === 'OBSERVED' && (errors.length === 0 || collectionErrors !== 0))
    || (status === 'NO_REPORT' && (errors.length !== 0 || collectionErrors !== 0))
    || (status === 'UNAVAILABLE' && (errors.length !== 0 || collectionErrors === 0))
    || (status === 'INCOMPLETE' && collectionErrors === 0)) throw new Error('diagnostic status contradicts collection facts')
  return { schemaVersion: 1, version: identity.version, buildNumber: identity.buildNumber, channel: identity.channel,
    sourceSha: row.sourceSha, platform, runtimeClass, status, collectionErrors, errors }
}

/**
 * Project the existing native Windows or Mac collector output into product diagnostics.
 * @param product - identity supplied by the owning producer, independently of the native report.
 * @param input - parsed native collector JSON; messages, module names and frames are never copied.
 * @returns validated error counts and explicit collection completeness, without release acceptance.
 */
export function projectNativeProductDiagnostics(product: DiagnosticProduct, input: unknown): ProductDiagnostics {
  const row = object(input)
  if (!Array.isArray(row.records)) throw new Error('native diagnostic records must be an array')
  const records = row.records as unknown[]
  let collectionErrors: number
  let status: ProductDiagnostics['status']
  if (product.platform === 'windows') {
    if (row.schemaVersion !== 1 || row.scope !== 'windows-installer-crash-diagnostic' || records.length > 100) {
      throw new Error('unsupported Windows native diagnostic')
    }
    const query = choice(row.queryState, ['queried', 'unavailable'])
    const malformed = count(row.malformedRecords)
    if (malformed > 100 || (query === 'unavailable' && (records.length !== 0 || malformed !== 0))) {
      throw new Error('Windows native diagnostic contradicts query facts')
    }
    collectionErrors = query === 'unavailable' ? 1 : malformed
    status = query === 'unavailable' ? 'UNAVAILABLE' : malformed > 0 ? 'INCOMPLETE' : records.length > 0 ? 'OBSERVED' : 'NO_REPORT'
  } else if (product.platform === 'macos') {
    if (records.length > 128 || !Array.isArray(row.errors) || row.errors.length > 128
      || row.errors.some(error => error !== 'host-report-unreadable')) throw new Error('unsupported Mac native diagnostic')
    collectionErrors = row.errors.length
    const expected = collectionErrors > 0 ? 'INCOMPLETE' : records.length > 0 ? 'REPORTS_FOUND' : 'NO_REPORT'
    if (row.status !== expected) throw new Error('Mac native diagnostic contradicts collection facts')
    status = expected === 'REPORTS_FOUND' ? 'OBSERVED' : expected
  } else {
    throw new Error('native diagnostic collector is not connected for this platform')
  }
  for (const record of records) object(record)
  return parseProductDiagnostics({ ...product, schemaVersion: 1, status, collectionErrors,
    errors: records.length === 0 ? [] : [{ errorClass: 'native-crash', count: records.length }] })
}
