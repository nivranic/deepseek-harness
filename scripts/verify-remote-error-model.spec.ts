/** The compiler inventory must cover the same owners and meanings as the published vocabulary. */

import { describe, expect, it } from 'vitest'
import type { RemoteErrorWorkspaceModel } from '@deepseek-ai/dsh-typert-generator'
import { verifyRemoteErrorModel, verifyRemoteFailureClassification } from './verify-remote-error-model.ts'

const expected = [{ code: 'owner/refused', description: 'The owner refused.', source: 'packages/group/owner/src/types.ts', detailsType: '{}' }]
function model(
  patch: { code?: string; description?: string; details?: string; codecDetails?: string; source?: string } = {},
): RemoteErrorWorkspaceModel {
  return { crossFaceLinks: [], faces: [{ face: 'client', errors: [{ code: patch.code ?? 'owner/refused',
    description: patch.description ?? 'The owner\nrefused.', package: '@fixture/owner', tags: [],
    location: { file: patch.source ?? expected[0]!.source, line: 1, column: 1 }, details: patch.details ?? 'details', codecDetails: patch.codecDetails ?? 'details',
  }], graph: { declarations: [], nodes: [{ id: 'details', kind: 'object', members: [] }] } }] }
}

describe('Remote error model gate', () => {
  it('accepts prose formatting differences and resolves the details root', () => {
    expect(verifyRemoteErrorModel(expected, model())).toBe(1)
  })
  it('rejects a declaration lost from the compiler model', () => {
    expect(() => verifyRemoteErrorModel(expected, { faces: [], crossFaceLinks: [] })).toThrow('model omitted')
  })
  it.each([
    [{ code: 'unknown/refused' }, 'undeclared Remote error'],
    [{ source: 'packages/other/owner/src/types.ts' }, 'model owner differs'],
    [{ description: 'The owner accepted.' }, 'model semantics differ'],
  ])('rejects disagreement with the declaration inventory: %j', (patch, message) => {
    expect(() => verifyRemoteErrorModel(expected, model(patch))).toThrow(message)
  })
  it('rejects a dangling codec root', () => {
    expect(() => verifyRemoteErrorModel(expected, model({ codecDetails: 'missing' }))).toThrow()
  })
  it('rejects a dangling details root', () => {
    expect(() => verifyRemoteErrorModel(expected, model({ details: 'missing' }))).toThrow()
  })
})

describe('Remote failure classification gate', () => {
  it('accepts a classification that only references declared codes', () => {
    expect(() => { verifyRemoteFailureClassification(expected, { 'owner/refused': 'permission' }) }).not.toThrow()
    expect(() => { verifyRemoteFailureClassification(expected, {}) }).not.toThrow()
  })
  it('rejects a classification referencing an undeclared code', () => {
    expect(() => { verifyRemoteFailureClassification(expected, { 'owner/unknown': 'unknown' }) })
      .toThrow('Remote failure classification not declared')
  })
})
