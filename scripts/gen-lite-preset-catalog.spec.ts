/**
 * Guarantee tests for the Lite preset catalog generator
 * (`scripts/gen-lite-preset-catalog.ts`).
 *
 * The boot itself is exercised by the `verify-lite-preset-catalog` gate, not
 * here: preset rows are imported by the Cordis Loader through Node's own
 * module resolution against the staged harness base, which under vitest loads
 * built `lib/` — mixing the artifact plane into a source-plane suite. Under
 * the tsx source launch (the gate's launcher) the same resolution reaches
 * `src/`, so the gate is the runnable proof that the real boot works.
 */

import { describe, expect, it } from 'vitest'
import type { PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import type {
  LitePresetExclusion, LitePresetProjection,
} from '@deepseek-ai/dsh-agent-presets'
import {
  assertCatalogCoverage,
  personaRowOf,
  projectHarvest,
  renderLitePresetCatalog,
  requiresRuntimeVariables,
  templateVariablesIn,
  type LitePresetHarvest,
} from './gen-lite-preset-catalog.ts'

/** One assembly fixture: sections joined by name, nothing else contributing. */
function assembly(...sections: readonly { name: string; text: string }[]): PromptAssembly {
  return { sections: [...sections], contexts: [], tools: [], variables: {} }
}

/** One harvest fixture over {@link assembly}. */
function harvest(overrides: Partial<LitePresetHarvest> = {}): LitePresetHarvest {
  return {
    id: 'demo',
    persona: { prefix: 'You are a demo.', suffix: '', complete: false, includeRuntimeContext: true },
    assembly: assembly({ name: 'deployment:persona-prefix', text: 'You are a demo.' }),
    ...overrides,
  }
}

describe('gen-lite-preset-catalog templateVariablesIn', () => {
  it('names every complete {{...}} group once, in first-appearance order', () => {
    expect(templateVariablesIn('powered by the {{model}} model; dir {{cwd}}; again {{model}}'))
      .toEqual(['model', 'cwd'])
  })

  it('keeps a lone {{ as prose and an invalid-name group as a template', () => {
    expect(templateVariablesIn('a literal {{ stays prose')).toEqual([])
    // The registry refuses a non-name group at render; the scan must not call
    // it prose the projection would happily carry.
    expect(templateVariablesIn('a {{not a name}} group')).toEqual(['not a name'])
  })
})

describe('gen-lite-preset-catalog requiresRuntimeVariables', () => {
  it('collects variables across sections and keeps the assembly renderable otherwise', () => {
    const depends = assembly(
      { name: 'deployment:persona-prefix', text: 'agent of {{model}}' },
      { name: 'deployment:persona-suffix', text: 'dir is {{cwd}}' },
    )
    expect(requiresRuntimeVariables(depends)).toEqual(['model', 'cwd'])
    expect(requiresRuntimeVariables(assembly({ name: 'deployment:persona-prefix', text: 'static' }))).toEqual([])
  })
})

describe('gen-lite-preset-catalog personaRowOf', () => {
  it('reads the persona row inside groups and applies the plugin defaults', () => {
    const persona = personaRowOf([
      '- id: wrap',
      '  name: cordis:group',
      '  group: true',
      '  config:',
      '    - id: persona',
      '      name: \'@deepseek-ai/dsh-persona\'',
      '      config:',
      '        prefix: You are nested.',
      '        complete: true',
      '        includeRuntimeContext: false',
      '',
    ].join('\n'))
    expect(persona).toEqual({ prefix: 'You are nested.', suffix: '', complete: true, includeRuntimeContext: false })
  })

  it('refuses deferred-expression booleans a static projection cannot render', () => {
    expect(() => personaRowOf([
      '- id: persona',
      '  name: \'@deepseek-ai/dsh-persona\'',
      '  config:',
      '    prefix: You are deferred.',
      '    complete: !!js true',
      '',
    ].join('\n'))).toThrow(/deferred expression/)
  })

  it('keeps an explicit suffix and the false-meaning defaults', () => {
    const persona = personaRowOf([
      '- id: persona',
      '  name: \'@deepseek-ai/dsh-persona\'',
      '  config:',
      '    prefix: You are.',
      '    suffix: Work here.',
      '',
    ].join('\n'))
    expect(persona).toEqual({ prefix: 'You are.', suffix: 'Work here.', complete: false, includeRuntimeContext: true })
  })

  it('refuses a composition with no persona row, two rows, or an empty prefix', () => {
    expect(() => personaRowOf('- id: other\n  name: \'@deepseek-ai/dsh-tool-todo\'\n')).toThrow(/no @deepseek-ai\/dsh-persona row/)
    expect(() => personaRowOf([
      '- id: a', '  name: \'@deepseek-ai/dsh-persona\'', '  config:', '    prefix: One.',
      '- id: b', '  name: \'@deepseek-ai/dsh-persona\'', '  config:', '    prefix: Two.', '',
    ].join('\n'))).toThrow(/2 .*dsh-persona rows/)
    expect(() => personaRowOf('- id: persona\n  name: \'@deepseek-ai/dsh-persona\'\n  config:\n    prefix: \'\'\n')).toThrow(/no prefix/)
  })
})

describe('gen-lite-preset-catalog assertCatalogCoverage', () => {
  it('accepts a partition of the shipped ids', () => {
    expect(() =>{  assertCatalogCoverage(['a', 'b'], ['a'], ['b']) }).not.toThrow()
  })

  it('fails naming a shipped preset carried by neither list', () => {
    expect(() =>{  assertCatalogCoverage(['a', 'b', 'c'], ['a'], ['b']) }).toThrow(/in neither list: c/)
  })

  it('fails a preset carried by both lists and an id nothing ships', () => {
    expect(() =>{  assertCatalogCoverage(['a'], ['a'], ['a']) }).toThrow(/never both/)
    expect(() =>{  assertCatalogCoverage(['a'], ['a', 'ghost'], []) }).toThrow(/not shipped/)
  })
})

describe('gen-lite-preset-catalog projectHarvest', () => {
  it('excludes an assembly that still references runtime variables, sorted', () => {
    const excluded = projectHarvest(harvest({
      assembly: assembly(
        { name: 'deployment:persona-prefix', text: 'agent of {{model}}' },
        { name: 'deployment:persona-suffix', text: 'dir {{cwd}} and {{model}}' },
      ),
    })) as LitePresetExclusion
    expect(excluded).toEqual({ id: 'demo', reason: 'requires runtime variables', variables: ['cwd', 'model'] })
  })

  it('projects a static assembly with the persona defaults applied', () => {
    const projected = projectHarvest(harvest({
      order: 2,
      persona: { prefix: 'You are.', suffix: 'Work.', complete: false, includeRuntimeContext: true },
      assembly: assembly(
        { name: 'harness:identity', text: 'identity' },
        { name: 'deployment:persona-prefix', text: 'You are.' },
        { name: 'deployment:persona-suffix', text: 'Work.' },
      ),
    })) as LitePresetProjection
    expect(projected).toEqual({
      id: 'demo',
      order: 2,
      persona: { prefix: 'You are.', suffix: 'Work.', complete: false },
      includeRuntimeContext: true,
      assembledSystemPrompt: 'identity\n\nYou are.\n\nWork.',
    })
  })

  it('omits an empty suffix and an undeclared order, and refuses an empty render', () => {
    const projected = projectHarvest(harvest()) as LitePresetProjection
    expect(projected.persona).not.toHaveProperty('suffix')
    expect(projected).not.toHaveProperty('order')
    expect(() => projectHarvest(harvest({
      assembly: assembly({ name: 'deployment:persona-prefix', text: '' }),
    }))).toThrow(/assembled to an empty system prompt/)
  })
})

describe('gen-lite-preset-catalog renderLitePresetCatalog', () => {
  it('orders both lists by id under the regeneration comment, one trailing newline', () => {
    const content = renderLitePresetCatalog([
      harvest({ id: 'zz', assembly: assembly({ name: 'deployment:persona-prefix', text: 'agent of {{model}}' }) }),
      harvest({ id: 'aa' }),
    ])
    const document = JSON.parse(content) as { _comment: string; presets: LitePresetProjection[]; excluded: LitePresetExclusion[] }
    expect(document.presets.map(preset => preset.id)).toEqual(['aa'])
    expect(document.excluded.map(exclusion => exclusion.id)).toEqual(['zz'])
    expect(document._comment).toMatch(/specification §33/)
    expect(document._comment).toMatch(/pnpm run gen-lite-preset-catalog/)
    expect(content.endsWith('\n') && !content.endsWith('\n\n')).toBe(true)
  })

  it('is deterministic: rendering the same harvest twice is byte-identical', () => {
    const harvests = [
      harvest({ id: 'aa', order: 1 }),
      harvest({ id: 'mm', assembly: assembly({ name: 'deployment:persona-prefix', text: 'agent of {{model}}' }) }),
    ]
    expect(renderLitePresetCatalog(harvests)).toBe(renderLitePresetCatalog(harvests))
  })
})
