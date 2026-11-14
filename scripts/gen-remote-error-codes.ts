/** Generate the packaged, finite known-code schema from Remote owners' declarations. */

import { globSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runGeneratorCli } from './gen-script-cli.ts'
import ts from 'typescript'
import { parseJsDoc, rawJsDoc } from './jsdoc.ts'

const ROOT = resolve(import.meta.dirname, '..')
const PROTOCOL = '@deepseek-ai/dsh-typert-protocol'
const BASE = 'packages/typert/protocol/src/types.ts'
const OUTPUT = 'packages/typert/protocol/remote-error-codes.schema.json'

/** One repository-relative source supplied to the code-schema generator. */
export interface RemoteErrorSource {
  readonly path: string
  readonly text: string
}

/** One known code with its owner-authored meaning and details declaration. */
export interface RemoteErrorCodeEntry {
  readonly code: string
  readonly description: string
  readonly source: string
  readonly detailsType: string
}

/**
 * Collect the base map and its protocol augmentations without executing owners.
 * @param sources - package sources; paths use repository-relative forward slashes.
 * @returns sorted, uniquely owned code entries with nonempty semantic descriptions.
 */
export function collectRemoteErrorCodes(sources: readonly RemoteErrorSource[]): RemoteErrorCodeEntry[] {
  const entries = new Map<string, RemoteErrorCodeEntry>()
  for (const { path, text } of sources) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node, protocolModule: boolean): void => {
      if (ts.isModuleDeclaration(node)) {
        if (node.body !== undefined) {
          visit(node.body, node.parent === source && ts.isStringLiteral(node.name) && node.name.text === PROTOCOL)
        }
        return
      }
      if (ts.isInterfaceDeclaration(node) && node.name.text === 'RemoteErrorDetailsMap'
        && (protocolModule || path === BASE && node.parent === source)) {
        if (node.heritageClauses?.length || node.typeParameters?.length) {
          throw new Error(`${path}: RemoteErrorDetailsMap must declare its codes directly`)
        }
        for (const member of node.members) {
          if (!ts.isPropertySignature(member) || !ts.isStringLiteral(member.name)
            || member.name.text.trim().length === 0 || member.questionToken !== undefined || member.type === undefined) {
            throw new Error(`${path}: Remote error codes require required string-literal properties with details types`)
          }
          const code = member.name.text
          const prior = entries.get(code)
          if (prior !== undefined) throw new Error(`${code}: duplicate Remote error owners: ${prior.source}, ${path}`)
          const description = parseJsDoc(rawJsDoc(text, member)).doc
          if (description.length === 0) throw new Error(`${path}: ${code} needs a JSDoc description of its failure semantics`)
          entries.set(code, { code, description, source: path, detailsType: member.type.getText(source) })
        }
        return
      }
      ts.forEachChild(node, (child) => { visit(child, protocolModule && ts.isModuleBlock(node)) })
    }
    visit(source, false)
  }
  if (entries.size === 0) throw new Error('No Remote error declarations found')
  return [...entries.values()].sort((left, right) => left.code < right.code ? -1 : left.code > right.code ? 1 : 0)
}

/**
 * Render a known-code recognition schema, not an error-envelope admission schema.
 * @param sources - package sources owning the base and augmented error maps.
 * @returns deterministic JSON Schema with owner prose and source details annotations.
 */
export function renderRemoteErrorCodeSchema(sources: readonly RemoteErrorSource[]): string {
  return JSON.stringify({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'urn:deepseek-harness:remote-error-codes',
    title: 'DeepSeek Harness known Remote error codes',
    description: 'Known codes for this package build. An unknown code remains opaque diagnostic data; preserve its original code, message and details without inferring recovery or permissions. This schema recognizes codes only and does not validate error envelopes or details.',
    type: 'string',
    oneOf: collectRemoteErrorCodes(sources).map(entry => ({
      const: entry.code,
      description: entry.description,
      'x-source': entry.source,
      'x-typescript-details': entry.detailsType,
    })),
  }, null, 2) + '\n'
}

runGeneratorCli({ url: import.meta.url, usage: 'gen-remote-error-codes.ts [--check]' }, (check) => {
  const paths = globSync(['packages/*/*/src/**/*.ts', 'packages/*/*/src/**/*.tsx',
    'packages/*/*/src/**/*.mts', 'packages/*/*/src/**/*.cts'], { cwd: ROOT }).sort()
  const result = renderRemoteErrorCodeSchema(paths.map(path => ({
    path: path.replaceAll('\\', '/'), text: readFileSync(resolve(ROOT, path), 'utf8'),
  })))
  if (check) {
    if (readFileSync(resolve(ROOT, OUTPUT), 'utf8') !== result) {
      throw new Error(`${OUTPUT} is stale; run pnpm run gen-remote-error-codes`)
    }
  } else writeFileSync(resolve(ROOT, OUTPUT), result)
  console.log(`${OUTPUT}: ${check ? 'current' : 'generated'}`)
})
