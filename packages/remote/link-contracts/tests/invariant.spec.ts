import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as LinkContractsInvariant from '../src/invariant.ts'

describe('link-contracts invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LinkContractsInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-link-contracts', () => {})
    }).toThrow(/already registered/)
  })
})
