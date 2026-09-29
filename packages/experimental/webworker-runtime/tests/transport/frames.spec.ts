import { describe, expect, it } from 'vitest'
import { parseInboundFrame } from '../../src/transport/frames.ts'

describe('tunnel init frame', () => {
  it('retains the selected overlay order', () => {
    expect(parseInboundFrame({
      t: 'init',
      image: 'base.tar.gz',
      overlays: ['workspace.tar.gz', 'session.tar.gz'],
    })).toEqual({
      t: 'init',
      image: 'base.tar.gz',
      overlays: ['workspace.tar.gz', 'session.tar.gz'],
    })
  })

  it('rejects a missing or non-string overlay list', () => {
    expect(() => parseInboundFrame({ t: 'init', image: 'base.tar.gz' })).toThrow(/array of string overlay urls/)
    expect(() => parseInboundFrame({ t: 'init', image: 'base.tar.gz', overlays: [1] }))
      .toThrow(/array of string overlay urls/)
  })
})

describe('tunnel request headers', () => {
  it('forwards prototype-named headers as ordinary HTTP fields', () => {
    const input: unknown = JSON.parse('{"t":"req","id":1,"method":"GET","url":"https://example.invalid/","headers":{"__proto__":"wire-value","Constructor":"metadata","X-Example":"value","ignored":42}}')
    const frame = parseInboundFrame(input)
    expect(frame.t).toBe('req')
    if (frame.t !== 'req') throw new Error('Expected request frame')
    expect(frame.headers['__proto__']).toBe('wire-value')
    expect(frame.headers['constructor']).toBe('metadata')
    expect(frame.headers['x-example']).toBe('value')
    expect(Object.hasOwn(frame.headers, 'ignored')).toBe(false)
    expect(Object.hasOwn(frame.headers, '__proto__')).toBe(true)
  })
})
