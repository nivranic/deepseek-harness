/** The runtime surface of the artifact vocabulary: the branded id constructor. */

import { describe, expect, it } from 'vitest'
import { ArtifactId, isArtifactId, parseArtifactId } from '../src/index.ts'

describe('ArtifactId', () => {
  it('brands by cast, keeping the string value verbatim', () => {
    expect(ArtifactId('art-report-1')).toBe('art-report-1')
    expect(ArtifactId('art-8f14e45f')).toBe('art-8f14e45f')
  })

  it('parses the portable filename grammar at untyped boundaries', () => {
    for (const id of ['art-1', 'art-report-1', 'art-A1', `art-${'a'.repeat(124)}`]) {
      expect(isArtifactId(id)).toBe(true)
      expect(parseArtifactId(id)).toBe(id)
    }
  })

  it.each([
    '',
    'artifact-1',
    'art-',
    'art--leading',
    'art-trailing-',
    'art-dot.segment',
    'art-../outside',
    'art-..\\outside',
    'art-safe:stream',
    'art-safe/child',
    'art-safe\\child',
    'art-safe\0tail',
    'art-safe<copy>',
    'art-résumé',
    `art-${'a'.repeat(125)}`,
  ])('rejects a non-portable boundary value %j', (id) => {
    expect(isArtifactId(id)).toBe(false)
    expect(() => parseArtifactId(id)).toThrow(/artifact id must be/)
  })
})
