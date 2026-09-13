import { describe, expect, it } from 'vitest'
import { parseProductDiagnostics, projectNativeProductDiagnostics, type DiagnosticProduct } from './product-diagnostics.ts'

const product: DiagnosticProduct = { version: '0.1.2-alpha.1', buildNumber: 1, channel: 'dev',
  sourceSha: 'a'.repeat(40), platform: 'windows', runtimeClass: 'full' }
const empty = { ...product, schemaVersion: 1, status: 'NO_REPORT', collectionErrors: 0, errors: [] }
const windows = { schemaVersion: 1, scope: 'windows-installer-crash-diagnostic', queryState: 'queried', malformedRecords: 0, records: [] }

describe('product diagnostics', () => {
  it('retains product correlation and keeps no report distinct from acceptance', () => {
    expect(parseProductDiagnostics(empty)).toEqual(empty)
    expect(projectNativeProductDiagnostics(product, windows)).toEqual(empty)
    expect(projectNativeProductDiagnostics({ ...product, platform: 'macos' }, { status: 'NO_REPORT', records: [], errors: [] }))
      .toEqual({ ...empty, platform: 'macos' })
  })

  it('projects native failures while dropping report text and arbitrary fields', () => {
    const secret = 'synthetic-private-payload'
    for (const platform of ['windows', 'macos'] as const) {
      const records = [{ module: secret, frames: [{ symbol: secret }], exception: { message: secret } }]
      const input = platform === 'windows' ? { ...windows, records, message: secret }
        : { status: 'REPORTS_FOUND', records, errors: [], path: secret }
      const output = projectNativeProductDiagnostics({ ...product, platform }, input)
      expect(output).toEqual({ ...empty, platform, status: 'OBSERVED', errors: [{ errorClass: 'native-crash', count: 1 }] })
      expect(JSON.stringify(output)).not.toContain(secret)
    }
  })

  it('retains incomplete and unavailable collection independently of crash counts', () => {
    expect(projectNativeProductDiagnostics(product, { ...windows, queryState: 'unavailable' }))
      .toMatchObject({ status: 'UNAVAILABLE', collectionErrors: 1, errors: [] })
    expect(projectNativeProductDiagnostics(product, { ...windows, malformedRecords: 1, records: [{}] }))
      .toMatchObject({ status: 'INCOMPLETE', collectionErrors: 1, errors: [{ errorClass: 'native-crash', count: 1 }] })
    expect(projectNativeProductDiagnostics({ ...product, platform: 'macos' }, {
      status: 'INCOMPLETE', records: [], errors: ['host-report-unreadable'],
    })).toMatchObject({ status: 'INCOMPLETE', collectionErrors: 1, errors: [] })
  })

  it('admits Android ANR metadata without claiming a mobile Full Host', () => {
    expect(parseProductDiagnostics({ ...empty, platform: 'android', runtimeClass: 'companion', status: 'OBSERVED',
      errors: [{ errorClass: 'anr', count: 2 }] })).toMatchObject({ platform: 'android', runtimeClass: 'companion' })
    expect(() => projectNativeProductDiagnostics({ ...product, platform: 'ios', runtimeClass: 'lite' }, { records: [] }))
      .toThrow('not connected')
  })

  it.each([
    null, [], { ...empty, schemaVersion: 2 }, { ...empty, payload: 'synthetic-private-payload' },
    { ...empty, version: '0.1.2-synthetic-private-payload', channel: 'beta' },
    { ...empty, sourceSha: 'a'.repeat(40) + '\n' }, { ...empty, platform: 'other' }, { ...empty, runtimeClass: 'other' },
    { ...empty, platform: 'ios' }, { ...empty, collectionErrors: -1 }, { ...empty, collectionErrors: 0.5 },
    { ...empty, collectionErrors: Number.MAX_SAFE_INTEGER + 1 }, { ...empty, errors: {} },
    { ...empty, status: 'OBSERVED' }, { ...empty, status: 'UNAVAILABLE' }, { ...empty, status: 'INCOMPLETE' },
    { ...empty, errors: [{ errorClass: 'native-crash', count: 1 }] },
    { ...empty, status: 'OBSERVED', errors: [{ errorClass: 'anr', count: 1 }] },
    { ...empty, status: 'OBSERVED', errors: [{ errorClass: 'native-crash', count: 0 }] },
    { ...empty, status: 'OBSERVED', errors: [{ errorClass: 'synthetic-private-payload', count: 1 }] },
    { ...empty, status: 'OBSERVED', errors: [{ errorClass: 'native-crash', count: 1, message: 'synthetic-private-payload' }] },
    { ...empty, status: 'OBSERVED', errors: [{ errorClass: 'native-crash', count: 1 }, { errorClass: 'native-crash', count: 1 }] },
  ])('rejects an invalid serialized diagnostic without echoing input %#', (input) => {
    expect(() => parseProductDiagnostics(input)).toThrow()
    try { parseProductDiagnostics(input) } catch (error) { expect(String(error)).not.toContain('synthetic-private-payload') }
  })

  it.each([
    null, { ...windows, records: null }, { ...windows, records: [null] }, { ...windows, schemaVersion: 2 },
    { ...windows, queryState: 'other' }, { ...windows, malformedRecords: 101 },
    { ...windows, queryState: 'unavailable', records: [{}] },
    { ...windows, records: Array.from({ length: 101 }, () => ({})) },
  ])('rejects contradictory Windows collector data %#', (input) => {
    expect(() => projectNativeProductDiagnostics(product, input)).toThrow()
  })

  it.each([
    { status: 'NO_REPORT', records: [{}], errors: [] },
    { status: 'INCOMPLETE', records: [], errors: ['synthetic-private-payload'] },
    { status: 'NO_REPORT', records: [], errors: null },
    { status: 'REPORTS_FOUND', records: Array.from({ length: 129 }, () => ({})), errors: [] },
  ])('rejects contradictory Mac collector data %#', (input) => {
    expect(() => projectNativeProductDiagnostics({ ...product, platform: 'macos' }, input)).toThrow()
  })
})
