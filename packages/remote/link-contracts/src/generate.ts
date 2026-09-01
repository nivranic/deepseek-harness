/**
 * Pure emitter for the link contract artifacts: a language-neutral manifest,
 * Swift Codable models, and Kotlin data models. Everything derives from the
 * table and fixtures in `index.ts`; this module touches no filesystem, so the
 * drift gate can compare emissions byte-for-byte.
 * @module @deepseek-ai/dsh-link-contracts
 */

import { createHash } from 'node:crypto'
import {
  LINK_CONTRACT_VERSION,
  LINK_CONTRACT_FIXTURES,
  LINK_CONTRACT_TYPES,
  LINK_PROTOCOL_SEMANTICS,
  type ContractField,
  type ContractFixture,
  type ContractType,
} from './index.ts'

/** Emitted artifact set. */
export interface GeneratedArtifacts {
  readonly manifest: string
  readonly schema: string
  readonly swift: string
  readonly kotlin: string
}

/** Lower-camel wire name for enum cases in Swift and Kotlin, joining `-` and `/` segments. */
function camel(value: string): string {
  let out = ''
  for (const part of value.split(/[-/]/u)) {
    out = out === '' ? part : `${out}${part.charAt(0).toUpperCase()}${part.slice(1)}`
  }
  return out
}

/** Upper-snake Kotlin enum entry name for a wire value. */
function kotlinCase(value: string): string {
  return value.toUpperCase().replaceAll(/[^A-Z0-9]/gu, '_')
}

/**
 * Swift scalar for one field.
 * @param fieldRow - the table field.
 * @returns the Swift type name.
 */
function swiftScalar(fieldRow: ContractField): string {
  switch (fieldRow.kind) {
    case 'number': return 'Double'
    case 'boolean': return 'Bool'
    case 'object': return fieldRow.ref
    case 'object-array': return `[${fieldRow.ref}]`
    case 'string-array': return '[String]'
    case 'number-array': return '[Double]'
    case 'json': return 'LinkJsonValue'
    case 'json-object': return '[String: LinkJsonValue]'
    case 'json-array': return '[LinkJsonValue]'
    case 'enum': return fieldRow.ref
    case 'const': return typeof fieldRow.value === 'number' ? 'Double' : 'String'
    default: return 'String'
  }
}

/**
 * Kotlin scalar for one field.
 * @param fieldRow - the table field.
 * @returns the Kotlin type name.
 */
function kotlinScalar(fieldRow: ContractField): string {
  switch (fieldRow.kind) {
    case 'number': return 'Double'
    case 'boolean': return 'Boolean'
    case 'object': return fieldRow.ref
    case 'object-array': return `List<${fieldRow.ref}>`
    case 'string-array': return 'List<String>'
    case 'number-array': return 'List<Double>'
    case 'json': return 'LinkJsonValue'
    case 'json-object': return 'Map<String, LinkJsonValue>'
    case 'json-array': return 'List<LinkJsonValue>'
    case 'enum': return fieldRow.ref
    case 'const': return typeof fieldRow.value === 'number' ? 'Double' : 'String'
    default: return 'String'
  }
}

function swiftModel(type: ContractType): string {
  if (type.shape === 'json') {
    return `public enum LinkJsonValue: Codable, Equatable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([LinkJsonValue])
    case object([String: LinkJsonValue])

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null; return }
        if let value = try? container.decode(Bool.self) { self = .bool(value); return }
        if let value = try? container.decode(Double.self) { self = .number(value); return }
        if let value = try? container.decode(String.self) { self = .string(value); return }
        if let value = try? container.decode([LinkJsonValue].self) { self = .array(value); return }
        if let value = try? container.decode([String: LinkJsonValue].self) { self = .object(value); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "unsupported JSON value")
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .null: try container.encodeNil()
        case .array(let values): try container.encode(values)
        case .object(let entries): try container.encode(entries)
        }
    }
}`
  }
  if (type.shape !== 'object') {
    const cases = type.shape.map(value => `    case ${camel(value)} = ${JSON.stringify(value)}`).join('\n')
    return `public enum ${type.name}: String, Codable {\n${cases}\n}`
  }
  const lines = type.fields.map((fieldRow) => {
    const scalar = swiftScalar(fieldRow)
    const wrapped = fieldRow.optional === true ? `${scalar}?` : scalar
    const suffix = fieldRow.kind === 'const' ? ` // constant ${JSON.stringify(fieldRow.value)}` : ''
    return `    public let ${fieldRow.name}: ${wrapped}${suffix}`
  })
  return `public struct ${type.name}: Codable {\n${lines.join('\n')}\n}`
}

function kotlinModel(type: ContractType): string {
  if (type.shape === 'json') {
    return `sealed class LinkJsonValue {
    data class StringValue(val value: String) : LinkJsonValue()
    data class NumberValue(val value: Double) : LinkJsonValue()
    data class BoolValue(val value: Boolean) : LinkJsonValue()
    data object NullValue : LinkJsonValue()
    data class ArrayValue(val items: List<LinkJsonValue>) : LinkJsonValue()
    data class ObjectValue(val entries: Map<String, LinkJsonValue>) : LinkJsonValue()
}`
  }
  if (type.shape !== 'object') {
    const entries = type.shape.map(value => `    ${kotlinCase(value)}(${JSON.stringify(value)})`).join(',\n')
    return `enum class ${type.name}(val wire: String) {\n${entries},\n}`
  }
  const lines = type.fields.map((fieldRow) => {
    const scalar = kotlinScalar(fieldRow)
    const wrapped = fieldRow.optional === true ? `${scalar}? = null` : scalar
    // The separator rides before any trailing comment, or the comment
    // swallows it and the next line parses as a syntax error.
    const comment = fieldRow.kind === 'const' ? ` // constant ${JSON.stringify(fieldRow.value)}` : ''
    return `    val ${fieldRow.name}: ${wrapped},${comment}`
  })
  return `data class ${type.name}(\n${lines.join('\n')}\n)`
}

type JsonSchema = boolean | Readonly<Record<string, unknown>>

function fieldSchema(fieldRow: ContractField): JsonSchema {
  switch (fieldRow.kind) {
    case 'string': return { type: 'string' }
    case 'number': return { type: 'number' }
    case 'boolean': return { type: 'boolean' }
    case 'const': return { const: fieldRow.value }
    case 'object':
    case 'enum': return { $ref: `#/$defs/${fieldRow.ref}` }
    case 'object-array': return { type: 'array', items: { $ref: `#/$defs/${fieldRow.ref}` } }
    case 'string-array': return { type: 'array', items: { type: 'string' } }
    case 'number-array': return { type: 'array', items: { type: 'number' } }
    case 'json': return true
    case 'json-object': return { type: 'object', additionalProperties: true }
    case 'json-array': return { type: 'array', items: true }
  }
}

function typeSchema(type: ContractType): JsonSchema {
  if (type.shape === 'json') return true
  if (Array.isArray(type.shape)) return { type: 'string', enum: type.shape }
  return {
    type: 'object',
    properties: Object.fromEntries(type.fields.map(fieldRow => [fieldRow.name, fieldSchema(fieldRow)])),
    required: type.fields.filter(fieldRow => fieldRow.optional !== true).map(fieldRow => fieldRow.name),
    additionalProperties: true,
  }
}

/**
 * Assert the table's internal relationships: every reference resolves to a
 * row of the matching shape, and every session-event or chunk-row tag is a
 * value of its vocabulary enum row.
 * @param types - the contract table.
 * @param byName - rows indexed by name.
 * @throws naming the first violated relationship.
 */
function validateTable(types: readonly ContractType[], byName: Map<string, ContractType>): void {
  const eventKinds = byName.get('LinkSessionEventKind')?.shape
  const chunkRowKinds = byName.get('LinkChunkRowKind')?.shape
  if (!Array.isArray(eventKinds) || !Array.isArray(chunkRowKinds)) {
    throw new Error('link-contracts: the table needs the LinkSessionEventKind and LinkChunkRowKind enum rows')
  }
  for (const type of types) {
    for (const fieldRow of type.fields) {
      if (fieldRow.kind !== 'object' && fieldRow.kind !== 'object-array' && fieldRow.kind !== 'enum') continue
      const target = byName.get(fieldRow.ref)
      if (target === undefined) {
        throw new Error(`link-contracts: ${type.name}.${fieldRow.name} references unknown type ${fieldRow.ref}`)
      }
      if (fieldRow.kind === 'enum' && target.shape === 'object') {
        throw new Error(`link-contracts: ${type.name}.${fieldRow.name} references object ${fieldRow.ref} as an enum`)
      }
      if (fieldRow.kind !== 'enum' && target.shape !== 'object') {
        throw new Error(`link-contracts: ${type.name}.${fieldRow.name} references enum ${fieldRow.ref} as an object`)
      }
    }
    for (const tag of type.sessionEvents ?? []) {
      if (!eventKinds.includes(tag)) {
        throw new Error(`link-contracts: ${type.name} claims unknown session event ${JSON.stringify(tag)}`)
      }
    }
    for (const tag of type.chunkRows ?? []) {
      if (!chunkRowKinds.includes(tag)) {
        throw new Error(`link-contracts: ${type.name} claims unknown chunk row ${JSON.stringify(tag)}`)
      }
    }
  }
}

/**
 * Emit every artifact from the table and fixtures.
 * @param types - the contract table; defaults to the exported one.
 * @param fixtures - the golden fixtures; defaults to the exported set.
 * @returns the manifest, Swift, and Kotlin texts, each ending in one newline.
 * @throws when a fixture does not match its table row or the table violates its internal relationships.
 */
export function generateLinkContracts(
  types: readonly ContractType[] = LINK_CONTRACT_TYPES,
  fixtures: readonly ContractFixture[] = LINK_CONTRACT_FIXTURES,
): GeneratedArtifacts {
  const byName = new Map(types.map(type => [type.name, type]))
  validateTable(types, byName)
  for (const fixture of fixtures) {
    const row = byName.get(fixture.type)
    if (row?.fixture !== fixture.id && !row?.additionalFixtures?.includes(fixture.id)) {
      throw new Error(`link-contracts: fixture ${fixture.id} does not match the table row ${fixture.type}`)
    }
  }
  const manifest = {
    contract: 'dsh-link',
    version: LINK_CONTRACT_VERSION,
    contractVersion: LINK_CONTRACT_VERSION,
    protocol: LINK_PROTOCOL_SEMANTICS,
    types: types.map(type => ({
      name: type.name,
      shape: type.shape,
      ...(type.shape === 'object'
        ? {
          fields: type.fields.map(fieldRow => ({
            name: fieldRow.name,
            kind: fieldRow.kind,
            ...fieldRow.kind === 'const' ? { value: fieldRow.value } : {},
            ...fieldRow.kind === 'object' || fieldRow.kind === 'object-array' || fieldRow.kind === 'enum'
              ? { ref: fieldRow.ref }
              : {},
            ...fieldRow.optional === true ? { optional: true } : {},
          })),
        }
        : {}),
      ...type.fixture === undefined ? {} : { fixture: type.fixture },
      ...type.additionalFixtures === undefined ? {} : { additionalFixtures: type.additionalFixtures },
      ...type.sessionEvents === undefined ? {} : { sessionEvents: type.sessionEvents },
      ...type.chunkRows === undefined ? {} : { chunkRows: type.chunkRows },
    })),
    fixtures: fixtures.map(fixture => ({
      id: fixture.id,
      type: fixture.type,
      sha256: createHash('sha256').update(`${JSON.stringify(fixture.value)}\n`).digest('hex'),
    })),
  }
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'DeepSeek Harness Link Contract',
    'x-dsh-contractVersion': LINK_CONTRACT_VERSION,
    'x-dsh-protocol': LINK_PROTOCOL_SEMANTICS,
    $defs: Object.fromEntries(types.map(type => [type.name, typeSchema(type)])),
  }
  const swift = [
    '// Generated by @deepseek-ai/dsh-link-contracts — regenerate with pnpm run gen-link-contracts; do not edit.',
    '',
    ...types.map(swiftModel),
    '',
  ].join('\n')
  const kotlin = [
    '// Generated by @deepseek-ai/dsh-link-contracts — regenerate with pnpm run gen-link-contracts; do not edit.',
    '',
    'package ai.deepseek.dsh.link',
    '',
    ...types.map(kotlinModel),
    '',
  ].join('\n')
  return {
    manifest: `${JSON.stringify(manifest, undefined, 2)}\n`,
    schema: `${JSON.stringify(schema, undefined, 2)}\n`,
    swift,
    kotlin,
  }
}
