/**
 * Pure emitter for the link contract artifacts: a language-neutral manifest,
 * Swift Codable models, and Kotlin data models. Everything derives from the
 * table and fixtures in `index.ts`; this module touches no filesystem, so the
 * drift gate can compare emissions byte-for-byte.
 * @module @deepseek-ai/dsh-link-contracts
 */

import { createHash } from 'node:crypto'
import {
  LINK_CONTRACT_FIXTURES,
  LINK_CONTRACT_TYPES,
  type ContractField,
  type ContractFixture,
  type ContractType,
} from './index.ts'

/** Emitted artifact set. */
export interface GeneratedArtifacts {
  readonly manifest: string
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
    case 'enum': return fieldRow.ref
    case 'const': return typeof fieldRow.value === 'number' ? 'Double' : 'String'
    default: return 'String'
  }
}

function swiftModel(type: ContractType): string {
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
  if (type.shape !== 'object') {
    const entries = type.shape.map(value => `    ${kotlinCase(value)}(${JSON.stringify(value)})`).join(',\n')
    return `enum class ${type.name}(val wire: String) {\n${entries},\n}`
  }
  const lines = type.fields.map((fieldRow) => {
    const scalar = kotlinScalar(fieldRow)
    const wrapped = fieldRow.optional === true ? `${scalar}? = null` : scalar
    const suffix = fieldRow.kind === 'const' ? ` // constant ${JSON.stringify(fieldRow.value)}` : ''
    return `    val ${fieldRow.name}: ${wrapped}${suffix}`
  })
  return `data class ${type.name}(\n${lines.join(',\n')},\n)`
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
    if (byName.get(fixture.type)?.fixture !== fixture.id) {
      throw new Error(`link-contracts: fixture ${fixture.id} does not match the table row ${fixture.type}`)
    }
  }
  const manifest = {
    contract: 'dsh-link',
    version: 1,
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
      ...type.sessionEvents === undefined ? {} : { sessionEvents: type.sessionEvents },
      ...type.chunkRows === undefined ? {} : { chunkRows: type.chunkRows },
    })),
    fixtures: fixtures.map(fixture => ({
      id: fixture.id,
      type: fixture.type,
      sha256: createHash('sha256').update(`${JSON.stringify(fixture.value)}\n`).digest('hex'),
    })),
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
    swift,
    kotlin,
  }
}
