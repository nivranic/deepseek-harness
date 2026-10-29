import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as LinkControllerInvariant from '../src/invariant.ts'

describe('api-link-controller invariant companion', () => {
  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(LinkControllerInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-api-link-controller', () => {})
    }).toThrow(/already registered/)
  })
})
