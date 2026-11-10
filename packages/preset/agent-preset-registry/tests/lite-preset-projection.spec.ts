/**
 * The committed Lite preset projection (`lite-preset-descriptors.json`) and
 * the persona-assembly behavior it projects.
 *
 * The document half asserts the committed artifact's invariants against the
 * shipped preset directories. The boot half proves the §33 reuse semantics on
 * a real composition mounted through this roster: a complete persona's scope
 * assembles, through the official SystemPrompt service, to exactly the
 * persona text — with the registry's own harness identity suppressed by that
 * completeness, not by a parallel prompt path. The persona row uses the
 * `minimal` preset's harvested prefix and a file-path row (the fixture form
 * every roster test uses), because package-named rows load built `lib/` under
 * vitest; the full shipped-preset boots live in the
 * `verify-lite-preset-catalog` gate's tsx source launch.
 */

import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterAll, describe, expect, it } from 'vitest'
import AgentPresets, {
  COMPOSITION_FILE, SHIPPED_PRESET_ROOT, type LitePresetCatalog,
} from '@deepseek-ai/dsh-agent-presets'
import { personaRowOf } from '../../../../scripts/gen-lite-preset-catalog.ts'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const PROJECTION = join(PACKAGE_ROOT, 'lite-preset-descriptors.json')
const document = JSON.parse(await readFile(PROJECTION, 'utf8')) as LitePresetCatalog

/** Every temp preset root created by the boot half, removed after the suite. */
const roots: string[] = []
afterAll(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('the committed Lite preset projection', () => {
  it('carries every shipped preset in exactly one id-sorted list', async () => {
    const shipped = (await readdir(SHIPPED_PRESET_ROOT, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
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
      if (preset.persona.complete) {
        expect(preset.assembledSystemPrompt, preset.id).toBe(preset.persona.prefix)
      }
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
  /** Boot the roster over one writable root holding the given composition. */
  async function rosterWith(id: string, composition: string): Promise<Context> {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lite-projection-'))
    roots.push(root)
    await writeFile(join(root, id, COMPOSITION_FILE), composition, { flag: 'wx' }).catch(async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(root, id))
      await writeFile(join(root, id, COMPOSITION_FILE), composition)
    })
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(FIXTURES).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentPresets, { default: id, roots: [{ path: root, trust: 'user' }], includeShippedRoot: false, includeUserRoot: false })
    return ctx
  }

  it('assembles to the persona prefix and suppresses the registry identity it owns', async () => {
    // The persona the shipped `minimal` preset declares, harvested from its
    // composition rather than restated here.
    const shipped = await readFile(join(SHIPPED_PRESET_ROOT, 'minimal', COMPOSITION_FILE), 'utf8')
    const persona = personaRowOf(shipped)
    const composition = [
      '- id: persona',
      `  name: ${fileURLToPath(new URL('../../persona/src/index.ts', import.meta.url)).replaceAll('\\', '/')}`,
      '  config:',
      `    prefix: ${persona.prefix}`,
      '    complete: true',
      '    includeRuntimeContext: false',
      '',
    ].join('\n')
    const ctx = await rosterWith('lite-projection', composition)

    // The cold-reader route: compose the standing scope without an agent.
    const scope = await ctx.agentPresets.standingKeyFor('lite-projection')
    const assembly = await ctx.systemPrompt.assemble({ scope })

    // The complete persona is the whole system prompt: exactly one section,
    // the persona's own, and no runtime-context contributions.
    expect(assembly.sections).toEqual([{ name: 'deployment:persona-prefix', text: persona.prefix }])
    expect(assembly.contexts).toEqual([])
    expect(renderPrompt(assembly)).toBe(persona.prefix)

    // The same registry without the preset scope still carries the harness
    // identity: the persona's completeness is what suppresses it, so the
    // projection reuses the official assembly instead of replacing it.
    const global = await ctx.systemPrompt.assemble()
    const identity = global.sections.find(section => section.name === 'harness:identity')
    expect(identity?.text).toBe('You are an AI agent powered by DeepSeek Harness.')
    await ctx.fiber.dispose()
  })

  it('leaves a non-complete persona alongside the registry sections it does not own', async () => {
    const ctx = await rosterWith('lite-open-persona', [
      '- id: persona',
      `  name: ${fileURLToPath(new URL('../../persona/src/index.ts', import.meta.url)).replaceAll('\\', '/')}`,
      '  config:',
      '    prefix: You are an open persona.',
      '',
    ].join('\n'))

    const assembly = await ctx.systemPrompt.assemble({ scope: await ctx.agentPresets.standingKeyFor('lite-open-persona') })

    // Without completeness the official assembly keeps its other sections —
    // the harness identity the Lite `minimal` form deliberately drops.
    expect(assembly.sections.map(section => section.name)).toContain('harness:identity')
    expect(assembly.sections.map(section => section.name)).toContain('deployment:persona-prefix')
    await ctx.fiber.dispose()
  })
})
