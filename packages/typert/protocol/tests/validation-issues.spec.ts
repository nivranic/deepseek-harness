import { describe, expect, it } from 'vitest'
import { remoteValidationIssues } from '@deepseek-ai/dsh-typert-protocol'

describe('portable validation diagnostics', () => {
  it('retains ordered diagnostic fields while omitting validator metadata and input', () => {
    const issues = [{ code: 'too_small', message: 'At least one item is required', path: ['items', 0],
      minimum: 1, input: 2n, metadata: { private: true } }]
    const result = remoteValidationIssues(issues)
    expect(JSON.parse(JSON.stringify(result))).toEqual([
      { code: 'too_small', message: 'At least one item is required', path: ['items', 0] },
    ])
    expect(result).not.toBe(issues)
    expect(result[0]?.path).not.toBe(issues[0]?.path)
    expect(issues[0]?.input).toBe(2n)
  })

  it('retains root paths and renders symbol keys as diagnostics', () => {
    expect(remoteValidationIssues([
      { code: 'invalid_type', message: 'Object required', path: [] },
      { code: 'custom', message: 'Owner diagnostic', path: [Symbol('field'), 2] },
    ])).toEqual([
      { code: 'invalid_type', message: 'Object required', path: [] },
      { code: 'custom', message: 'Owner diagnostic', path: ['Symbol(field)', 2] },
    ])
    expect(remoteValidationIssues([])).toEqual([])
  })
})
