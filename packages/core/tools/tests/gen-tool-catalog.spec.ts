/**
 * Guarantee tests for the tool-schema catalog generator (`scripts/gen-tool-catalog.ts`).
 */

import { describe, expect, it } from 'vitest'
import {
  assertManifestComplete,
  assertToolsHarvested,
  collectToolCatalog,
  mergeToolDescriptors,
  render,
  renderToolDescriptors,
  type ToolCatalog,
  type ToolPackage,
} from '../../../../scripts/gen-tool-catalog.ts'
import type { ToolDescriptor } from '@deepseek-ai/dsh-tools'

/** JSON Schema shape enough to reach the values AST extraction can't. */
interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  enum?: string[]
  required?: string[]
}

describe('gen-tool-catalog collectToolCatalog', () => {
  it('boots every shipped tool package and harvests its model-facing schemas', async () => {
    const catalog = await collectToolCatalog()
    const names = catalog.flatMap(entry => entry.schemas.map(s => s.name)).sort()
    expect(names).toEqual([
      'ask_user_question', 'bash', 'bash', 'cordis_define', 'cordis_inspect_list',
      'cordis_inspect_query', 'cordis_inspect_self', 'cordis_run', 'cordis_stop',
      'cordis_undefine', 'create_goal', 'edit', 'exit_plan_mode', 'get_goal', 'glob', 'grep',
      'interrupt_agent', 'interrupt_agent', 'job_kill', 'job_list', 'job_output',
      'list_agents', 'list_agents', 'list_subagent_models', 'lsp', 'present', 'pwsh', 'pwsh', 'ralph',
      'read', 'read_image', 'run_code', 'schedule_create', 'schedule_delete',
      'schedule_list', 'send_message', 'send_message', 'session_event_read', 'session_event_search',
      'session_event_trace', 'session_search', 'session_trace', 'skill', 'spawn_teammate',
      'str_replace_editor', 'subagent', 'team_task_create',
      'team_task_get', 'team_task_list', 'team_task_update', 'terminal_close', 'terminal_list',
      'terminal_open', 'terminal_read', 'terminal_send', 'terminal_signal', 'todo_write',
      'update_goal', 'wait_agent', 'web_fetch', 'web_search', 'workflow', 'write',
    ])
    // Every tool carries a JSON-Schema `parameters` object (what the model sees).
    for (const entry of catalog) {
      for (const schema of entry.schemas) {
        expect((schema.parameters as unknown as JsonSchema).type).toBe('object')
      }
    }
  })

  it('resolves a runtime-spread enum to its literal members (the payoff over AST)', async () => {
    const catalog = await collectToolCatalog()
    const todo = catalog
      .flatMap(entry => entry.schemas)
      .find(s => s.name === 'todo_write')
    // `todo-todo` writes `enum: [...STATUSES]` — a source AST would see the
    // spread, not the values. Booting yields the shipped enum literals.
    const status = (((todo?.parameters as unknown as JsonSchema).properties?.todos)?.items)?.properties?.status
    expect(status?.enum).toEqual(['pending', 'in_progress', 'completed'])
  })

  it('attributes each harvested tool with its registering plugin source', async () => {
    const catalog = await collectToolCatalog()
    const bash = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-bash')
    expect(bash?.sources.bash).toBe('packages/shell/tool-bash/src/index.ts')
    const control = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-subagent-control')
    expect(control?.sources).toEqual({
      interrupt_agent: 'packages/subagent/tool-subagent-control/src/index.ts',
      list_agents: 'packages/subagent/tool-subagent-control/src/list-agents.ts',
      send_message: 'packages/subagent/tool-subagent-control/src/index.ts',
    })
  })

  it('harvests search tools without depending on the generator process PATH', async () => {
    const oldPath = process.env.PATH
    try {
      process.env.PATH = ''
      const catalog = await collectToolCatalog()
      const search = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-fs-search')
      expect(search?.schemas.map(s => s.name).sort()).toEqual(['glob', 'grep'])
    } finally {
      if (oldPath === undefined) delete process.env.PATH
      else process.env.PATH = oldPath
    }
  })

  it('records the shipped `subagent_fork` alias in a note (config-driven tool name)', async () => {
    // `tool-subagent`'s registered name is the load-time `toolName` config, so the shipped
    // agents surface this one package as both `subagent` and `subagent_fork`.
    const catalog = await collectToolCatalog()
    const subagent = catalog.find(entry => entry.pkg === '@deepseek-ai/dsh-tool-subagent')
    expect(subagent?.schemas.map(s => s.name)).toEqual(['list_subagent_models', 'subagent'])
    expect(subagent?.note).toMatch(/subagent_fork/)
  })

  it('harvests one §32 declaration per registered tool, keyed to the schema names', async () => {
    const catalog = await collectToolCatalog()
    for (const entry of catalog) {
      expect(entry.descriptors.map(descriptor => descriptor.id).sort())
        .toEqual(entry.schemas.map(schema => schema.name).sort())
      for (const descriptor of entry.descriptors) {
        expect(descriptor.version).toBe(1)
        expect(['low', 'moderate', 'high', 'critical']).toContain(descriptor.risk)
      }
    }
    const flat = catalog.flatMap(entry => entry.descriptors)
    // The Lite companion's one bundled executor: only web_search may run on-device.
    expect(flat.filter(descriptor => descriptor.supportsLite).map(descriptor => descriptor.id)).toEqual(['web_search'])
    // The two human-answer tools are the only permission claims.
    expect(flat.filter(descriptor => descriptor.permissions.length > 0).map(descriptor => descriptor.id).sort())
      .toEqual(['ask_user_question', 'exit_plan_mode'])
    // Shell-class surfaces carry the high tier (alternative compositions can
    // ship one id twice, so compare the unique id set).
    expect([...new Set(flat.filter(descriptor => descriptor.risk === 'high').map(descriptor => descriptor.id))].sort())
      .toEqual(['bash', 'cordis_define', 'cordis_run', 'interrupt_agent', 'pwsh', 'ralph',
        'run_code', 'send_message', 'spawn_teammate', 'subagent', 'terminal_send', 'workflow'])
  })
})

describe('gen-tool-catalog assertManifestComplete', () => {
  it('passes when the manifest lists every on-disk tool package (the default)', () => {
    expect(() => { assertManifestComplete() }).not.toThrow()
  })

  it('throws, naming the omitted package, when a tool package is missing from the manifest', () => {
    // An empty manifest scanned against the real tree: every `tool-*` package
    // is unlisted, so the guard must fire and name them.
    expect(() => { assertManifestComplete([]) }).toThrow(/not in the boot manifest/)
    expect(() => { assertManifestComplete([]) }).toThrow(/tool-bash/)
  })
})

describe('gen-tool-catalog assertToolsHarvested', () => {
  const entry: ToolPackage = {
    pkg: '@deepseek-ai/dsh-tool-demo',
    dir: 'tool-demo',
    source: 'packages/demo/tool-demo/src/index.ts',
    requires: ['ctx.tools', 'ctx.somethingUnmounted'],
    writes: ['tool/result'],
    mount: () => Promise.resolve(),
  }

  it('accepts a boot that registered at least one tool', () => {
    expect(() => { assertToolsHarvested(entry, 1) }).not.toThrow()
  })

  it('throws, naming the package and its requirements, when a boot registers nothing', () => {
    // The failure this guards is silent by construction: the package is in the
    // manifest, its plugin merely stays PENDING on an unmounted service, and the
    // catalog would ship without its tools while every gate stays green.
    expect(() => { assertToolsHarvested(entry, 0) }).toThrow(/@deepseek-ai\/dsh-tool-demo booted without registering a single tool/)
    expect(() => { assertToolsHarvested(entry, 0) }).toThrow(/ctx.somethingUnmounted/)
  })
})

describe('gen-tool-catalog render', () => {
  it('emits a package heading, a tool heading, and a json schema fence', () => {
    const catalog: ToolCatalog = [
      {
        pkg: '@deepseek-ai/dsh-tool-demo',
        sources: { demo: 'packages/demo/tool-demo/src/index.ts' },
        requires: ['ctx.tools'],
        writes: ['tool/result'],
        schemas: [{ name: 'demo', description: 'A demo tool.', parameters: { type: 'object', properties: {} } }],
        descriptors: [{ id: 'demo', version: 1, risk: 'low', permissions: [], supportsLite: false, supportsRemote: true }],
      },
    ]
    const md = render(catalog)
    expect(md).toContain('| `@deepseek-ai/dsh-tool-demo` | `demo` | `ctx.tools` | `tool/result` |')
    expect(md).toContain('## `@deepseek-ai/dsh-tool-demo`')
    expect(md).toContain('### `demo`')
    expect(md).toContain('A demo tool.')
    expect(md).toContain('```json')
    expect(md).toContain('Source: [`packages/demo/tool-demo/src/index.ts`]')
  })
})

/** One §32 declaration literal with every field overridable per test. */
function descriptor(overrides: Partial<ToolDescriptor> = {}): ToolDescriptor {
  return { id: 'demo', version: 1, risk: 'low', permissions: [], supportsLite: false, supportsRemote: true, ...overrides }
}

describe('gen-tool-catalog mergeToolDescriptors', () => {
  it('collapses an identical same-id declaration from an alternative composition', () => {
    const catalog: ToolCatalog = [
      { pkg: '@deepseek-ai/dsh-tool-demo', sources: {}, requires: [], writes: [], schemas: [], descriptors: [descriptor()] },
      { pkg: '@deepseek-ai/dsh-tool-demo-alt', sources: {}, requires: [], writes: [], schemas: [], descriptors: [descriptor()] },
    ]
    expect(mergeToolDescriptors(catalog)).toEqual([descriptor()])
  })

  it('fails loudly when the same id carries conflicting declarations', () => {
    const catalog: ToolCatalog = [
      { pkg: '@deepseek-ai/dsh-tool-demo', sources: {}, requires: [], writes: [], schemas: [], descriptors: [descriptor()] },
      {
        pkg: '@deepseek-ai/dsh-tool-demo-alt', sources: {}, requires: [], writes: [], schemas: [],
        descriptors: [descriptor({ risk: 'high' })],
      },
    ]
    expect(() => { mergeToolDescriptors(catalog) })
      .toThrow(/tool id "demo" carries conflicting host-only declarations/)
  })
})

describe('gen-tool-catalog renderToolDescriptors', () => {
  it('renders one {"tools":[...]} document entry per tool in the given order', () => {
    // Sorting is mergeToolDescriptors' job; render stays a pure projection of its input.
    const json = renderToolDescriptors([
      descriptor({ id: 'zeta', risk: 'high', supportsLite: true }),
      descriptor({ id: 'alpha', permissions: ['question.respond'] }),
    ])
    const document = JSON.parse(json) as { _comment: string; tools: ToolDescriptor[] }
    expect(document.tools.map(tool => tool.id)).toEqual(['zeta', 'alpha'])
    expect(document.tools[0]).toEqual({
      id: 'zeta', version: 1, risk: 'high', permissions: [], supportsLite: true, supportsRemote: true,
    })
    expect(document.tools[1]).toEqual({
      id: 'alpha', version: 1, risk: 'low', permissions: ['question.respond'], supportsLite: false, supportsRemote: true,
    })
    expect(document._comment).toMatch(/specification §32/)
  })
})
