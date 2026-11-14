/** Error extraction reaches unused Client declarations without merging compiler faces. */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { z } from 'zod'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceAnalyzer } from '../src/analyzer.ts'
import { TypeGraphRenderer } from '../src/renderer.ts'
import { emitRemoteErrorSchemas } from '../src/emitter.ts'

const roots: string[] = []
const protocol = '@deepseek-ai/dsh-typert-protocol'

function fixture(): string {
  const root = mkdtempSync(join(import.meta.dirname, '.remote-errors-'))
  roots.push(root)
  const protocolEntry = join(root, 'packages', 'protocol', 'src', 'index.ts')
  const json = (path: string, value: unknown): void => { writeFileSync(join(root, path), JSON.stringify(value)) }
  const packages = [['protocol', protocol], ['host', '@fixture/host'], ['client', '@fixture/client']] as const
  for (const [directory, name] of packages) {
    mkdirSync(join(root, 'packages', directory, 'src'), { recursive: true })
    json(`packages/${directory}/package.json`, { name, type: 'module', exports: {
      '.': { types: './lib/types/index.d.ts', default: './lib/index.js' },
    } })
    json(`packages/${directory}/tsconfig.json`, { extends: '../../tsconfig.base.json',
      compilerOptions: { rootDir: 'src', outDir: 'lib/types' }, include: ['src'] })
  }
  json('tsconfig.base.json', { compilerOptions: {
    target: 'ES2024', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true,
    composite: true, noEmit: true, types: [], skipLibCheck: true,
    paths: { [protocol]: [protocolEntry] },
  } })
  for (const [face, directories] of [['host', ['protocol', 'host']], ['client', ['client']]] as const) {
    json(`tsconfig.${face}.json`, { extends: './tsconfig.base.json', files: [],
      references: directories.map(directory => ({ path: `./packages/${directory}` })) })
  }
  writeFileSync(protocolEntry, `export interface RemoteErrorDetailsMap {
    /** An unclassified failure. */
    'gateway/internal': {}
  }\n`)
  for (const face of ['host', 'client']) {
    writeFileSync(join(root, `packages/${face}/src/index.ts`), `import type {} from '${protocol}'
export interface Details { readonly value: ${face === 'host' ? 'number' : 'string'}; readonly reason: 'missing' | 'closed' }
declare global { interface FixtureContext { value: ${face === 'host' ? 'number' : 'string'} } }
declare module '${protocol}' { interface RemoteErrorDetailsMap {
  /** The ${face} refused the operation. */
  '${face}/refused': Details
} }
`)
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.startsWith(resolve(import.meta.dirname) + sep + '.remote-errors-')) throw new Error('unexpected fixture root')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Remote error type analysis', () => {
  it('retains unused details and Client-only codes in separate compiler graphs', () => {
    const root = fixture()
    const analyzer = new WorkspaceAnalyzer({ root })
    expect(analyzer.analyze().faces.flatMap(face => face.graph.declarations.map(type => type.name))).not.toContain('Details')
    const model = analyzer.analyzeRemoteErrors()
    expect(model.faces.map(face => [face.face, face.errors.map(error => error.code)])).toEqual([
      ['host', ['gateway/internal', 'host/refused']], ['client', ['client/refused']],
    ])
    for (const face of model.faces) {
      const error = face.errors.find(error => error.code === `${face.face}/refused`)!
      expect(error).toMatchObject({ package: `@fixture/${face.face}`, description: `The ${face.face} refused the operation.`,
        location: { file: `packages/${face.face}/src/index.ts` } })
      const renderer = new TypeGraphRenderer(face.graph)
      const details = renderer.declarationClosureForTypes([error.details]).find(type => type.name === 'Details')!
      const value = details.members.find(member => member.name === 'value')!
      if (value.kind !== 'property') throw new Error('expected property')
      expect(renderer.renderType(value.type)).toBe(face.face === 'host' ? 'number' : 'string')
      expect(details.members.find(member => member.name === 'reason')).toMatchObject({ kind: 'property', readonly: true })
    }
  })

  it('resolves cross-face brands and computed details while retaining authored links', async () => {
    const root = fixture()
    const types = join(root, 'packages', 'host', 'src', 'types.ts')
    writeFileSync(types, `declare const brand: unique symbol
export type Id = string & { readonly [brand]: 'id' }
export type Select<T> = T extends 'text' ? string : number
`)
    const basePath = join(root, 'tsconfig.base.json')
    const config = JSON.parse(readFileSync(basePath, 'utf8')) as { compilerOptions: { paths: Record<string, string[]> } }
    config.compilerOptions.paths['@fixture/host/types'] = [types]
    writeFileSync(basePath, JSON.stringify(config))
    const manifestPath = join(root, 'packages/host/package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports: Record<string, unknown> }
    manifest.exports['./types'] = { types: './lib/types/types.d.ts', default: './lib/types/types.js' }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    const client = join(root, 'packages/client/src/index.ts')
    writeFileSync(client, readFileSync(client, 'utf8') + `
import type { Id, Select } from '@fixture/host/types'
declare module '@deepseek-ai/dsh-typert-protocol' { interface RemoteErrorDetailsMap {
  /** Refused a resolved value. */
  'client/resolved': { readonly id: Id; readonly values: { [Key in 'one' | 'two']: Select<'text'> } }
} }
`)
    const model = new WorkspaceAnalyzer({ root }).analyzeRemoteErrors()
    const face = model.faces.find(face => face.face === 'client')!
    const error = face.errors.find(error => error.code === 'client/resolved')!
    const renderer = new TypeGraphRenderer(face.graph)
    expect(renderer.renderType(error.details)).toContain('Id')
    expect(model.crossFaceLinks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Id' })]))
    const generatedPath = join(root, 'resolved.mjs')
    writeFileSync(generatedPath, emitRemoteErrorSchemas(face))
    const generated = await import(pathToFileURL(generatedPath).href) as { REMOTE_ERROR_DETAILS: ReadonlyMap<string, z.ZodType> }
    const schema = generated.REMOTE_ERROR_DETAILS.get('client/resolved')!
    expect(schema.safeParse({ id: 'item', values: { one: 'first', two: 'second' } }).success).toBe(true)
    expect(schema.safeParse({ id: 1, values: { one: 'first', two: 'second' } }).success).toBe(false)
    expect(schema.safeParse({ id: 'item', values: { one: 'first', two: 2 } }).success).toBe(false)
  })

  it('keeps prototype-like codes and colliding generated identifiers distinct', async () => {
    const root = fixture()
    const path = join(root, 'packages/host/src/index.ts')
    writeFileSync(path, readFileSync(path, 'utf8') + `
declare module '@deepseek-ai/dsh-typert-protocol' {
      interface RemoteErrorDetailsMap {
        /** First diagnostic. */
        '__proto__': { value: 'prototype' }
        /** Second diagnostic. */
        'owner/a-b': { value: 'dash' }
        /** Third diagnostic. */
        'owner/a_b': { value: 'underscore' }
      }
    }
`)
    const face = new WorkspaceAnalyzer({ root, faces: ['host'] }).analyzeRemoteErrors().faces[0]!
    const generatedPath = join(root, 'keys.mjs')
    writeFileSync(generatedPath, emitRemoteErrorSchemas(face))
    const generated = await import(pathToFileURL(generatedPath).href) as { REMOTE_ERROR_DETAILS: ReadonlyMap<string, z.ZodType> }
    for (const [code, value] of [['__proto__', 'prototype'], ['owner/a-b', 'dash'], ['owner/a_b', 'underscore']]) {
      const schema = generated.REMOTE_ERROR_DETAILS.get(code!)!
      expect(schema.safeParse({ value }).success).toBe(true)
      expect(schema.safeParse({ value: 'wrong' }).success).toBe(false)
    }
    expect(() => emitRemoteErrorSchemas({ ...face, errors: [...face.errors, face.errors[0]!] })).toThrow('must be unique')
  })

  it.each(['unknown', 'any', 'object', 'bigint', 'symbol', '() => void'])('rejects non-JSON details %s', (type) => {
    const root = fixture()
    const path = join(root, 'packages/host/src/index.ts')
    writeFileSync(path, readFileSync(path, 'utf8') + `
declare module '@deepseek-ai/dsh-typert-protocol' { interface RemoteErrorDetailsMap {
      /** Invalid wire data. */
      'host/non-json': { value: ${type} }
    } }
`)
    expect(() => new WorkspaceAnalyzer({ root }).analyzeRemoteErrors()).toThrow(/Remote boundary/)
  })

  it('honors package and face selection without materializing other errors', () => {
    const root = fixture()
    const model = new WorkspaceAnalyzer({ root, packages: ['@fixture/client'], faces: ['client'] }).analyzeRemoteErrors()
    expect(model.faces.map(face => face.errors.map(error => error.code))).toEqual([['client/refused']])
  })

  it('ignores local interfaces and nested same-named declarations', () => {
    const root = fixture()
    const path = join(root, 'packages/client/src/index.ts')
    writeFileSync(path, readFileSync(path, 'utf8') + `
interface RemoteErrorDetailsMap { 'local': {} }
declare module '${protocol}' { namespace Private { interface RemoteErrorDetailsMap { 'nested': {} } } }
`)
    const model = new WorkspaceAnalyzer({ root }).analyzeRemoteErrors()
    expect(model.faces.flatMap(face => face.errors.map(error => error.code))).toEqual([
      'gateway/internal', 'host/refused', 'client/refused',
    ])
  })

  it.each([
    ['optional', "/** Optional refusal. */\n'host/optional'?: {}", 'required string-literal properties'],
    ['index', '[code: string]: {}', 'required string-literal properties'],
    ['undocumented', "'host/undocumented': {}", 'needs a JSDoc description'],
    ['duplicate', "/** Repeated refusal. */\n'host/refused': Details", 'already declared'],
  ])('rejects %s declarations instead of dropping them', (_name, member, message) => {
    const root = fixture()
    const path = join(root, 'packages/host/src/index.ts')
    writeFileSync(path, readFileSync(path, 'utf8') + `\ndeclare module '${protocol}' { interface RemoteErrorDetailsMap {\n${member}\n} }\n`)
    expect(() => new WorkspaceAnalyzer({ root }).analyzeRemoteErrors()).toThrow(message)
  })
})
