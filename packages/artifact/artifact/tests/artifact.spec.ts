/** The runtime surface of the artifact vocabulary: the branded id constructor. */

import { describe, expect, it } from 'vitest'
import { ArtifactId } from '../src/index.ts'

describe('ArtifactId', () => {
  it('brands by cast, keeping the string value verbatim', () => {
    expect(ArtifactId('art-report-1')).toBe('art-report-1')
    expect(ArtifactId('art-8f14e45f')).toBe('art-8f14e45f')
  })
})
