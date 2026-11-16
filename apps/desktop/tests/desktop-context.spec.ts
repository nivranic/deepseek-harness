import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'
import { registerDesktopContext } from '../../desktop-host/src/desktop-context.ts'

const desktopSection = 'app:desktop-surface'

describe('Desktop model context', () => {
  it('adds orientation after reusable guidance and before the workspace suffix', async () => {
    const ctx = new Context()
    try {
      registerDesktopContext(ctx)
      await ctx.plugin(SystemPrompt, { personaSuffix: 'Workspace {{cwd}}.' })
      ctx.systemPrompt.variable('cwd', () => '/session/workspace')
      ctx.systemPrompt.section({ name: 'tool:fixture', order: 1000, text: 'Tool guidance.' })
      const assembly = await ctx.systemPrompt.assemble()
      const names = assembly.sections.map(section => section.name)
      expect(names.indexOf(desktopSection)).toBeGreaterThan(names.indexOf('tool:fixture'))
      expect(names.indexOf(desktopSection)).toBeLessThan(names.indexOf('deployment:persona-suffix'))
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('This session is hosted on the same machine as that window.')
      expect(prompt).toContain('their declared execution environment')
      expect(prompt).toContain('no implicit DOM, route, or screenshot context')
      expect(prompt).toContain('Workspace /session/workspace.')
    } finally { await ctx.fiber.dispose() }
  })

  it('removes its section when the registering context is disposed', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, {})
      const fiber = ctx.plugin(registerDesktopContext)
      await fiber
      expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === desktopSection)).toBe(true)
      await fiber.dispose()
      expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === desktopSection)).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })

  it('restores one section when the prompt service reloads', async () => {
    const ctx = new Context()
    try {
      registerDesktopContext(ctx)
      const first = ctx.plugin(SystemPrompt, {})
      await first
      await first.dispose()
      await ctx.plugin(SystemPrompt, {})
      const sections = (await ctx.systemPrompt.assemble()).sections.filter(section => section.name === desktopSection)
      expect(sections).toHaveLength(1)
    } finally { await ctx.fiber.dispose() }
  })

  it('honors a complete persona and restores orientation when it is removed', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, {})
      registerDesktopContext(ctx)
      const remove = ctx.systemPrompt.section({ name: 'fixture:complete', order: 0, text: 'Complete persona.', complete: true })
      expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Complete persona.')
      remove()
      expect((await ctx.systemPrompt.assemble()).sections.some(section => section.name === desktopSection)).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })
})
