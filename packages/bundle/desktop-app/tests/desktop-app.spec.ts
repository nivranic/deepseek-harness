/**
 * Desktop runtime glue behavior: the desktop-surface prompt section (with the
 * harness-source section) when surface context is on, and its suppression for
 * a one-shot layer.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { apply, Config } from '../src/index.ts'

describe('desktop-app runtime glue', () => {
  it('registers the desktop surface and harness-source prompt sections', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ surfaceContext: true }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    // Settle the injected registrations.
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.find(entry => entry.name === 'harness:source')?.text)
      .toContain('DeepSeek Harness implementation checkout')
    const section = assembly.sections.find(entry => entry.name === 'app:desktop-surface')
    expect(section?.text).toContain('desktop application window')
    // The surface owns the no-URL contract and keeps the model away from
    // starting a replacement web server.
    expect(section?.text).toContain('There is no URL')
    expect(section?.text).not.toContain('http://')
    await ctx.fiber.dispose()
  })

  it('skips the surface context when disabled (the one-shot layer)', async () => {
    const ctx = new Context()
    apply(ctx, new Config({ surfaceContext: false }))
    await ctx.plugin(SystemPrompt, { persona: '' })
    await new Promise(resolve => setTimeout(resolve, 0))
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.sections.some(entry => entry.name === 'app:desktop-surface')).toBe(false)
    expect(assembly.sections.some(entry => entry.name === 'harness:source')).toBe(false)
    await ctx.fiber.dispose()
  })
})
