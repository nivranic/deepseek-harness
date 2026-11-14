/** Static Lite preset descriptors and the official persona assembly they contain. */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { dump, load } from 'js-yaml'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { afterEach, describe, expect, it } from 'vitest'
import type { PresetDefinition } from '../src/index.ts'
import { declare, harness } from './harness.ts'
import { personaRowOf, shippedPresetDefinitions, type LitePresetCatalog } from '../../../../scripts/gen-lite-preset-catalog.ts'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const document = JSON.parse(await readFile(join(PACKAGE_ROOT, 'lite-preset-descriptors.json'), 'utf8')) as LitePresetCatalog
const contexts: Context[] = []

afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

describe('the committed Lite preset projection', () => {
  it('carries every shipped preset in exactly one id-sorted list', () => {
    const shipped = shippedPresetDefinitions().map(preset => preset.id).sort()
    const projected = document.presets.map(preset => preset.id)
    const excluded = document.excluded.map(exclusion => exclusion.id)

    expect(projected).toEqual([...projected].sort())
    expect(excluded).toEqual([...excluded].sort())
    expect(projected.filter(id => excluded.includes(id))).toEqual([])
    expect([...projected, ...excluded].sort()).toEqual(shipped)
  })

  it('projects complete personas whose assembly is exactly the persona prefix', () => {
    for (const preset of document.presets) {
      expect(preset.assembledSystemPrompt.length).toBeGreaterThan(0)
      if (preset.persona.complete) expect(preset.assembledSystemPrompt, preset.id).toBe(preset.persona.prefix)
    }
  })

  it('names the runtime variables every exclusion depends on', () => {
    expect(document.excluded.length).toBeGreaterThan(0)
    for (const exclusion of document.excluded) {
      expect(exclusion.reason, exclusion.id).toBe('requires runtime variables')
      expect(exclusion.variables.length, exclusion.id).toBeGreaterThan(0)
    }
  })
})

describe('a complete persona assembled through the official registry', () => {
  async function rosterWith(id: string, composition: string): Promise<Context> {
    const ctx = await harness()
    contexts.push(ctx)
    await declare(ctx, { id, plugins: load(composition, { schema: entryListSchema }) as PresetDefinition['plugins'] })
    return ctx
  }

  it('assembles to the persona prefix and suppresses the registry identity it owns', async () => {
    const minimal = shippedPresetDefinitions().find(preset => preset.id === 'minimal')!
    const persona = personaRowOf(dump(minimal.plugins, { schema: entryListSchema }))
    const composition = dump([{
      id: 'persona',
      name: new URL('../../persona/src/index.ts', import.meta.url).href,
      config: { prefix: persona.prefix, complete: true, includeRuntimeContext: false },
    }])
    const ctx = await rosterWith('lite-projection', composition)
    await using scope = await ctx.agentPresets.acquireScope('lite-projection')
    const assembly = await ctx.systemPrompt.assemble({ scope: scope.key })

    expect(assembly.sections).toEqual([{ name: 'deployment:persona-prefix', text: persona.prefix }])
    expect(assembly.contexts).toEqual([])
    expect(renderPrompt(assembly)).toBe(persona.prefix)

    const global = await ctx.systemPrompt.assemble()
    expect(global.sections.find(section => section.name === 'harness:identity')?.text)
      .toBe('You are an AI agent powered by DeepSeek Harness.')
  })

  it('leaves a non-complete persona alongside the registry sections it does not own', async () => {
    const ctx = await rosterWith('lite-open-persona', dump([{
      id: 'persona',
      name: new URL('../../persona/src/index.ts', import.meta.url).href,
      config: { prefix: 'You are an open persona.' },
    }]))
    await using scope = await ctx.agentPresets.acquireScope('lite-open-persona')
    const assembly = await ctx.systemPrompt.assemble({ scope: scope.key })

    expect(assembly.sections.map(section => section.name)).toContain('harness:identity')
    expect(assembly.sections.map(section => section.name)).toContain('deployment:persona-prefix')
  })
})
