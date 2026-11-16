/** Known-code publication rejects ambiguous owners and unbounded declarations. */

import { describe, expect, it } from 'vitest'
import { collectRemoteErrorCodes, renderRemoteErrorCodeSchema } from './gen-remote-error-codes.ts'

const source = (body: string, path = 'packages/fixture/owner/src/types.ts') => ({
  path, text: `declare module '@deepseek-ai/dsh-typert-protocol' { interface RemoteErrorDetailsMap {\n${body}\n} }`,
})

describe('Remote error code schema', () => {
  it('publishes a finite code set with each owner meaning and details annotation', () => {
    const base = { path: 'packages/typert/protocol/src/types.ts', text: `export interface RemoteErrorDetailsMap {
      /** Unclassified failure. */ 'gateway/internal': {}
    }` }
    const owner = source('/** Session is unavailable. */ "session/not-found": { readonly sessionId: string }')
    const forward = renderRemoteErrorCodeSchema([owner, base])
    expect(renderRemoteErrorCodeSchema([base, owner])).toBe(forward)
    expect(JSON.parse(forward)).toMatchObject({ type: 'string', oneOf: [
      { const: 'gateway/internal', description: 'Unclassified failure.' },
      { const: 'session/not-found', description: 'Session is unavailable.',
        'x-source': owner.path, 'x-typescript-details': '{ readonly sessionId: string }' },
    ] })
    expect(forward.endsWith('\n')).toBe(true)
  })

  it('ignores examples, unrelated interfaces and foreign module augmentations', () => {
    const other = { path: 'packages/fixture/other/src/types.ts', text: `
      export const example = "interface RemoteErrorDetailsMap { 'example': {} }";
      interface RemoteErrorDetailsMap { 'local': {} }
      declare module 'another-protocol' { interface RemoteErrorDetailsMap { 'foreign': {} } }
      declare module '@deepseek-ai/dsh-typert-protocol' {
        namespace Private { interface RemoteErrorDetailsMap { 'nested': {} } }
        function example(): void { interface RemoteErrorDetailsMap { 'function-local': {} } }
      }
    ` }
    expect(collectRemoteErrorCodes([other, source('/** Refused. */ "owner/refused": {}')]).map(e => e.code))
      .toEqual(['owner/refused'])
  })

  it('rejects duplicate owners even when their details agree', () => {
    const member = '/** Refused. */ "owner/refused": {}'
    expect(() => collectRemoteErrorCodes([source(member), source(member, 'packages/fixture/second/src/types.ts')]))
      .toThrow('duplicate Remote error owners')
  })

  it.each(['"owner/refused": {}', '/** @deprecated */ "owner/refused": {}'])
  ('rejects a code without semantic prose: %s', (member) => {
    expect(() => collectRemoteErrorCodes([source(member)])).toThrow('needs a JSDoc description')
  })

  it.each(['[key: string]: {}', '"owner/refused"?: {}', 'refused: {}', '"": {}', 'refused(): void', '"owner/refused"'])
  ('rejects an unbounded or incomplete code declaration: %s', (member) => {
    expect(() => collectRemoteErrorCodes([source(member)])).toThrow('required string-literal properties')
  })

  it.each(['extends Other', '<T>'])('rejects indirect error members: %s', (suffix) => {
    const input = source('').text.replace('RemoteErrorDetailsMap {', `RemoteErrorDetailsMap ${suffix} {`)
    expect(() => collectRemoteErrorCodes([{ path: source('').path, text: input }])).toThrow('declare its codes directly')
  })

  it('rejects an empty inventory instead of publishing a permissive schema', () => {
    expect(() => renderRemoteErrorCodeSchema([])).toThrow('No Remote error declarations')
  })
})
