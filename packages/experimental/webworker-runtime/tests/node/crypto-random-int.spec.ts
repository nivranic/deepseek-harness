/** Worker random integers retain equal-probability outputs across Node's supported range. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomInt } from '../../src/node/builtin_modules/implemented/crypto.ts'

afterEach(() => { vi.unstubAllGlobals() })

function randomSamples(...samples: number[]): ReturnType<typeof vi.fn> {
  const fill = vi.fn((target: Uint8Array) => {
    const sample = samples.shift()
    if (sample === undefined) throw new Error('Unexpected extra random draw')
    const view = new DataView(target.buffer, target.byteOffset, target.byteLength)
    view.setUint16(0, Math.floor(sample / 2 ** 32))
    view.setUint32(2, sample % 2 ** 32)
    return target
  })
  vi.stubGlobal('crypto', { getRandomValues: fill })
  return fill
}

describe('worker randomInt', () => {
  it('discards the incomplete residue group before returning a uniform result', () => {
    const fill = randomSamples(2 ** 48 - 1, 1)
    expect(randomInt(3)).toBe(1)
    expect(fill).toHaveBeenCalledTimes(2)
  })

  it.each([1, 2 ** 32, 2 ** 40 + 1, 2 ** 48 - 1])('can return both ends of [0, %s)', (max) => {
    randomSamples(0, max - 1)
    expect(randomInt(max)).toBe(0)
    expect(randomInt(max)).toBe(max - 1)
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 48])('rejects invalid upper bound %s before drawing randomness', (max) => {
    const fill = randomSamples()
    expect(() => randomInt(max)).toThrow(RangeError)
    expect(fill).not.toHaveBeenCalled()
  })

  it('propagates an unavailable entropy source', () => {
    const failure = new Error('Entropy unavailable')
    vi.stubGlobal('crypto', { getRandomValues: () => { throw failure } })
    expect(() => randomInt(6)).toThrow(failure)
  })
})
