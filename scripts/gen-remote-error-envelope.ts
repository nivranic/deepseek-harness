/** Generate the portable Remote failure envelope from independent compiler-face codecs. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runGeneratorCli } from './gen-script-cli.ts'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import { emitRemoteErrorSchemas } from '@deepseek-ai/dsh-typert-generator'
import type { TypertFace } from '@deepseek-ai/dsh-typert-generator'
import type { RemoteErrorCodeEntry } from './gen-remote-error-codes.ts'
import { analyzeRemoteErrorWorkspace } from './verify-remote-error-model.ts'

const output = 'packages/typert/protocol/remote-errors.schema.json'

/** One executed schema module from an independent compiler face. */
export interface RemoteErrorSchemaFace {
  readonly face: TypertFace
  readonly schemas: ReadonlyMap<string, z.ZodType>
}

/** Convert accepted JSON inputs without representing parser output stripping as rejection. */
function inputSchema(schema: z.ZodType): z.core.JSONSchema.JSONSchema {
  return z.toJSONSchema(schema, {
    io: 'input',
    override: ({ zodSchema }) => {
      if (zodSchema._zod.def.type === 'tuple') {
        throw new Error('Remote error schema cannot publish tuple cardinality with the current Zod converter')
      }
    },
  })
}

/**
 * Combine known details validators and an opaque unknown-code branch.
 * Unknown codes never bypass validation of a known code's malformed details.
 * @param expected - independently collected owner declarations and semantics.
 * @param faces - executed details schemas from separate compiler faces.
 * @returns deterministic JSON Schema for code, message and object details.
 */
export function renderRemoteErrorEnvelopeSchema(
  expected: readonly RemoteErrorCodeEntry[],
  faces: readonly RemoteErrorSchemaFace[],
): string {
  const declarations = new Map(expected.map(entry => [entry.code, entry]))
  if (declarations.size === 0 || declarations.size !== expected.length) throw new Error('Remote error inventory must be nonempty and unique')
  const resolved = new Map<string, { schema: z.ZodType; json: z.core.JSONSchema.JSONSchema }>()
  for (const face of faces) {
    for (const [code, schema] of face.schemas) {
      if (!declarations.has(code)) throw new Error(`${face.face}: undeclared Remote error schema ${code}`)
      const json = inputSchema(schema)
      const prior = resolved.get(code)
      if (prior !== undefined && !isDeepStrictEqual(prior.json, json)) throw new Error(`Remote error details differ across faces: ${code}`)
      resolved.set(code, { schema, json })
    }
  }
  const sorted = [...expected].sort((left, right) => left.code.localeCompare(right.code))
  const known = sorted.map((entry) => {
    const schema = resolved.get(entry.code)?.schema
    if (schema === undefined) throw new Error(`Remote error schema omitted: ${entry.code}`)
    return z.looseObject({ code: z.literal(entry.code), message: z.string(), details: schema }).describe(entry.description)
  })
  const json = inputSchema(z.union(known))
  if (json.anyOf === undefined) throw new Error('Remote error schema requires an explicit known-code union')
  json.anyOf.push({
    title: 'Opaque unknown Remote failure',
    type: 'object',
    required: ['code', 'message', 'details'],
    properties: {
      code: { type: 'string', not: { enum: sorted.map(entry => entry.code) } },
      message: { type: 'string' },
      details: { type: 'object', additionalProperties: true },
    },
    additionalProperties: true,
  })
  return JSON.stringify({
    ...json,
    $id: 'urn:deepseek-harness:remote-errors',
    title: 'DeepSeek Harness Remote failure envelope',
    description: 'Validates known code details and preserves unknown codes as opaque diagnostics. Acceptance does not imply capability, permission, recovery policy or protocol compatibility. Additional fields are accepted; validators must not discard the original diagnostic.',
  }, null, 2) + '\n'
}

runGeneratorCli({ url: import.meta.url, usage: 'gen-remote-error-envelope.ts [--check]' }, async (check) => {
  const root = resolve(import.meta.dirname, '..')
  const { expected, model } = analyzeRemoteErrorWorkspace(root)
  const faces: RemoteErrorSchemaFace[] = []
  for (const face of model.faces) {
    const source = emitRemoteErrorSchemas(face).replace("from 'zod'", `from ${JSON.stringify(import.meta.resolve('zod'))}`)
    const generated = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`) as {
      REMOTE_ERROR_DETAILS: ReadonlyMap<string, z.ZodType>
    }
    faces.push({ face: face.face, schemas: generated.REMOTE_ERROR_DETAILS })
  }
  const result = renderRemoteErrorEnvelopeSchema(expected, faces)
  const path = resolve(root, output)
  if (check) {
    if (readFileSync(path, 'utf8') !== result) throw new Error(`${output} is stale; run pnpm run gen-remote-error-envelope`)
  } else writeFileSync(path, result)
  console.log(`${output}: ${check ? 'current' : 'generated'}; ${String(expected.length)} known codes plus opaque unknowns`)
})
