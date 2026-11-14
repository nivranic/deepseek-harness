/** Compare the published-code inventory with independent Host and Client type extraction. */

import { globSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TypeGraphRenderer, WorkspaceAnalyzer } from '@deepseek-ai/dsh-typert-generator'
import type { RemoteErrorWorkspaceModel } from '@deepseek-ai/dsh-typert-generator'
import { REMOTE_FAILURE_CLASSES } from '@deepseek-ai/dsh-typert-protocol'
import { collectRemoteErrorCodes } from './gen-remote-error-codes.ts'
import type { RemoteErrorCodeEntry } from './gen-remote-error-codes.ts'

/**
 * Verify code, prose and owner agreement and that every details root exists.
 * @param expected - the independently collected repository code declarations.
 * @param model - separately analyzed Host and Client errors and type graphs.
 * @returns the number of distinct declarations represented across both faces.
 */
export function verifyRemoteErrorModel(expected: readonly RemoteErrorCodeEntry[], model: RemoteErrorWorkspaceModel): number {
  const declarations = new Map(expected.map(entry => [entry.code, entry]))
  const found = new Set<string>()
  for (const face of model.faces) {
    const renderer = new TypeGraphRenderer(face.graph)
    for (const error of face.errors) {
      const declaration = declarations.get(error.code)
      if (declaration === undefined) throw new Error(`${face.face}: undeclared Remote error ${error.code}`)
      if (error.location.file !== declaration.source) throw new Error(`${error.code}: model owner differs from code inventory`)
      const prose = (text: string): string => text.replace(/\s+/g, ' ').trim()
      if (prose(error.description) !== prose(declaration.description)) {
        throw new Error(`${error.code}: model semantics differ from code inventory`)
      }
      renderer.node(error.details)
      renderer.node(error.codecDetails)
      renderer.declarationClosureForTypes([error.details, error.codecDetails])
      found.add(error.code)
    }
  }
  const missing = expected.filter(entry => !found.has(entry.code))
  if (missing.length > 0) throw new Error(`Remote error model omitted: ${missing.map(entry => entry.code).join(', ')}`)
  return found.size
}

/**
 * Verify that classified presentation codes reference only declared vocabulary.
 * @param expected - the independently collected repository code declarations.
 * @param classes - shared Client classification map keyed by failure code.
 */
export function verifyRemoteFailureClassification(
  expected: readonly RemoteErrorCodeEntry[],
  classes: Readonly<Record<string, unknown>>,
): void {
  const declared = new Set(expected.map(entry => entry.code))
  const undeclared = Object.keys(classes).filter(code => !declared.has(code))
  if (undeclared.length > 0) {
    throw new Error(`Remote failure classification not declared in the code inventory: ${undeclared.join(', ')}`)
  }
}

/**
 * Analyze the complete repository error inventory on independent compiler faces.
 * @param root - absolute workspace directory containing the aggregate tsconfigs.
 * @returns the lexical inventory and verified compiler model.
 */
export function analyzeRemoteErrorWorkspace(root: string): {
  readonly expected: readonly RemoteErrorCodeEntry[]
  readonly model: RemoteErrorWorkspaceModel
} {
  const sources = globSync(['packages/*/*/src/**/*.ts', 'packages/*/*/src/**/*.tsx',
    'packages/*/*/src/**/*.mts', 'packages/*/*/src/**/*.cts'], { cwd: root }).map(path => ({
    path: path.replaceAll('\\', '/'), text: readFileSync(resolve(root, path), 'utf8'),
  }))
  const expected = collectRemoteErrorCodes(sources)
  const directories = new Set(expected.map(entry => entry.source.split('/').slice(0, 3).join('/')))
  const packages = [...directories].map((directory) => {
    const manifest = JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')) as { name?: unknown }
    if (typeof manifest.name !== 'string') throw new Error(`${directory}: package name is missing`)
    return manifest.name
  })
  const model = new WorkspaceAnalyzer({ root, packages, mode: 'check', checkDiagnostics: false }).analyzeRemoteErrors()
  verifyRemoteErrorModel(expected, model)
  verifyRemoteFailureClassification(expected, REMOTE_FAILURE_CLASSES)
  return { expected, model }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('Usage: verify-remote-error-model.ts')
  const { expected } = analyzeRemoteErrorWorkspace(resolve(import.meta.dirname, '..'))
  console.log(`Remote error type model: ${String(expected.length)} codes; Host and Client analyzed independently`)
}
