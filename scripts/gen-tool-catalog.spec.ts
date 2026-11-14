/**
 * Behavior tests for the Lite tool schemas projection of the tool catalog
 * generator (`scripts/gen-tool-catalog.ts`).
 *
 * The boot itself is exercised by the `verify-tool-catalog` gate, not here:
 * harvesting schemas means really mounting every tool plugin on a Context,
 * which is the gate's job, not a unit fixture's. These tests pin the
 * projection's filter, fail-loud joins, and rendered shape over synthetic
 * catalogs.
 */

import { describe, expect, it } from 'vitest'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { ToolDescriptor } from '@deepseek-ai/dsh-tools'
import { renderLiteToolSchemas, type ToolCatalog } from './gen-tool-catalog.ts'

/** One schema fixture carrying exactly the three model-wire fields. */
function schema(name: string, overrides: Partial<ToolSchema> = {}): ToolSchema {
  return {
    name,
    description: `${name} description`,
    parameters: { type: 'object', properties: { [name]: { type: 'string' } } },
    ...overrides,
  }
}

/** One §32 declaration fixture with the given `supportsLite` flag. */
function descriptor(id: string, supportsLite: boolean): ToolDescriptor {
  return {
    id,
    version: 1,
    risk: 'low',
    permissions: [],
    supportsLite,
    supportsRemote: true,
  }
}

/** One catalog fixture: a booted package contributing the given schemas and declarations. */
function catalogEntry(schemas: readonly ToolSchema[], descriptors: readonly ToolDescriptor[]): ToolCatalog[number] {
  return {
    pkg: '@deepseek-ai/dsh-tool-demo',
    sources: Object.fromEntries(schemas.map(tool => [tool.name, 'packages/demo/tool-demo/src/index.ts'])),
    requires: ['ctx.tools'],
    writes: ['tool/call', 'tool/result'],
    schemas: [...schemas],
    descriptors,
  }
}

/** The rendered document parsed back: `_comment` plus the projected rows. */
interface LiteDocument {
  _comment: string
  tools: { name: string; description: string; parameters: Record<string, unknown> }[]
}

describe('gen-tool-catalog renderLiteToolSchemas', () => {
  it('projects exactly the supportsLite tools with exactly the three model-wire fields', () => {
    const content = renderLiteToolSchemas([
      catalogEntry(
        [schema('web_search'), schema('bash'), schema('ask_user_question')],
        [descriptor('ask_user_question', false), descriptor('bash', false), descriptor('web_search', true)],
      ),
    ])
    const document = JSON.parse(content) as LiteDocument
    expect(document.tools.map(tool => tool.name)).toEqual(['web_search'])
    expect(document.tools[0]).toEqual(schema('web_search'))
    expect(Object.keys(document.tools[0] as object)).toEqual(['name', 'description', 'parameters'])
  })

  it('sorts the projection by name across catalog entries', () => {
    const content = renderLiteToolSchemas([
      catalogEntry([schema('zeta')], [descriptor('zeta', true)]),
      catalogEntry([schema('alpha')], [descriptor('alpha', true)]),
    ])
    expect((JSON.parse(content) as LiteDocument).tools.map(tool => tool.name)).toEqual(['alpha', 'zeta'])
  })

  it('fails a supportsLite declaration whose name no boot harvested a schema for', () => {
    expect(() => renderLiteToolSchemas([
      catalogEntry([schema('bash')], [descriptor('bash', false), descriptor('ghost', true)]),
    ])).toThrow(/"ghost" declares supportsLite: true but no booted package harvested a schema/)
  })

  it('collapses identical same-name schemas under a supportsLite name and refuses conflicting ones', () => {
    const identical = schema('web_search')
    expect(() => renderLiteToolSchemas([
      catalogEntry([identical], [descriptor('web_search', true)]),
      catalogEntry([{ ...identical }], [descriptor('web_search', true)]),
    ])).not.toThrow()
    expect(() => renderLiteToolSchemas([
      catalogEntry([schema('web_search')], [descriptor('web_search', true)]),
      catalogEntry([schema('web_search', { description: 'a different registry' })], [descriptor('web_search', true)]),
    ])).toThrow(/"web_search" carries different model-facing schemas/)
  })

  it('ignores same-name schema differences on names the Lite projection does not mount', () => {
    // The real catalog ships the persistent shell variants under the same
    // names as the one-shot tools with different descriptions; only a
    // supportsLite declaration makes the ambiguity load-bearing.
    const content = renderLiteToolSchemas([
      catalogEntry([schema('bash')], [descriptor('bash', false)]),
      catalogEntry([schema('bash', { description: 'a persistent session' })], [descriptor('bash', false)]),
    ])
    expect((JSON.parse(content) as LiteDocument).tools).toEqual([])
  })

  it('records the generator and regeneration command under _comment with one trailing newline', () => {
    const content = renderLiteToolSchemas([catalogEntry([schema('web_search')], [descriptor('web_search', true)])])
    const document = JSON.parse(content) as LiteDocument
    expect(document._comment).toMatch(/scripts\/gen-tool-catalog\.ts/)
    expect(document._comment).toMatch(/pnpm run gen-tool-catalog/)
    expect(content.endsWith('\n') && !content.endsWith('\n\n')).toBe(true)
  })

  it('is deterministic: rendering the same catalog twice is byte-identical', () => {
    const catalog = [
      catalogEntry([schema('web_search'), schema('bash')], [descriptor('bash', false), descriptor('web_search', true)]),
    ]
    expect(renderLiteToolSchemas(catalog)).toBe(renderLiteToolSchemas(catalog))
  })
})
