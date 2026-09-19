/** JSON Schema consumers must distinguish malformed known failures from opaque new codes. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Ajv2020 } from 'ajv/dist/2020.js'
import { z } from 'zod'
import { renderRemoteErrorEnvelopeSchema } from './gen-remote-error-envelope.ts'

const expected = [{ code: 'owner/refused', description: 'The owner refused.', source: 'owner.ts', detailsType: 'Details' }]
const details = z.object({ id: z.string(), count: z.number().optional() })
function document(schema: z.ZodType = details): object {
  return JSON.parse(renderRemoteErrorEnvelopeSchema(expected, [{ face: 'host', schemas: new Map([['owner/refused', schema]]) }])) as object
}
function validator(schema: object) {
  return new Ajv2020({ strict: true, allowUnionTypes: true }).compile(schema)
}

describe('Remote failure envelope schema', () => {
  it('validates known details without stripping diagnostic extensions', () => {
    const validate = validator(document())
    const value = { code: 'owner/refused', message: 'Refused', details: { id: 'item', future: { retained: true } }, extra: 7 }
    const before = structuredClone(value)
    expect(validate(value)).toBe(true)
    expect(value).toEqual(before)
    expect(validate({ ...value, details: { id: 7 } })).toBe(false)
    expect(validate({ ...value, details: {} })).toBe(false)
  })

  it('preserves unknown codes as opaque object diagnostics without accepting malformed envelopes', () => {
    const validate = validator(document())
    const value = { code: 'future/new', message: 'Future diagnostic', details: { nested: [1, null, { unknown: true }] } }
    const before = structuredClone(value)
    expect(validate(value)).toBe(true)
    expect(value).toEqual(before)
    for (const invalid of [{ ...value, details: [] }, { ...value, code: 1 }, { code: 'future/new', details: {} }, null]) {
      expect(validate(invalid)).toBe(false)
    }
  })

  it('retains recursive detail references when combining envelopes', () => {
    const recursive: z.ZodType = z.lazy(() => z.object({ id: z.string(), next: recursive.optional() }))
    const validate = validator(document(recursive))
    expect(validate({ code: 'owner/refused', message: '', details: { id: 'root', next: { id: 'leaf' } } })).toBe(true)
    expect(validate({ code: 'owner/refused', message: '', details: { id: 'root', next: { id: 2 } } })).toBe(false)
  })

  it('rejects omitted, undeclared and disagreeing compiler-face schemas', () => {
    expect(() => renderRemoteErrorEnvelopeSchema(expected, [])).toThrow('omitted')
    expect(() => renderRemoteErrorEnvelopeSchema(expected, [{ face: 'host', schemas: new Map([['other', details]]) }])).toThrow('undeclared')
    expect(() => renderRemoteErrorEnvelopeSchema(expected, [
      { face: 'host', schemas: new Map([['owner/refused', details]]) },
      { face: 'client', schemas: new Map([['owner/refused', z.object({ id: z.number() })]]) },
    ])).toThrow('differ across faces')
    expect(() => renderRemoteErrorEnvelopeSchema([], [])).toThrow('nonempty and unique')
    expect(() => renderRemoteErrorEnvelopeSchema([...expected, ...expected], [])).toThrow('nonempty and unique')
  })

  it('refuses tuple projection rather than silently omitting cardinality', () => {
    expect(() => document(z.object({ values: z.tuple([z.string(), z.number().optional()]) }))).toThrow('tuple cardinality')
    expect(() => document(z.object({ values: z.array(z.tuple([z.string()])) }))).toThrow('tuple cardinality')
  })

  it('validates the repository artifact with a standard draft-2020-12 consumer', () => {
    const published = JSON.parse(readFileSync(new URL('../packages/typert/protocol/remote-errors.schema.json', import.meta.url), 'utf8')) as object
    const validate = validator(published)
    expect(validate({ code: 'host/capability-unavailable', message: 'Unavailable', details: { capability: 'fixture.v1' } })).toBe(true)
    expect(validate({ code: 'host/capability-unavailable', message: 'Unavailable', details: {} })).toBe(false)
    expect(validate({ code: 'host/capability-unavailable', message: 'Unavailable', details: { capability: 2 } })).toBe(false)
    expect(validate({ code: 'external/new', message: 'Opaque', details: { untouched: [1, 2] } })).toBe(true)
    expect(validate({ code: 'gateway/bad-request', message: '', details: { issues: [{ code: 'invalid_type', message: '', path: ['field', 0] }] } })).toBe(true)
    expect(validate({ code: 'gateway/bad-request', message: '', details: { issues: [{ code: 'invalid_type', message: '', path: [false] }] } })).toBe(false)
  })
})
