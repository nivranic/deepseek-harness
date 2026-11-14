/** Host catalog completeness, scoped visibility, and model-schema isolation. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { createScope } from '@deepseek-ai/dsh-scope'
import ToolRuntime, { defineTool, ToolDeclarationUnavailableError, type ToolDefinition } from '../src/index.ts'

function tool(name: string): ToolDefinition {
  return defineTool({
    name, description: name, parameters: {},
    version: 1, risk: 'low', permissions: [], supportsLite: false, supportsRemote: true,
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: () => Promise.resolve(name),
  })
}

describe('Host tool declarations', () => {
  let ctx: Context
  let native: Fiber
  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    native = ctx.plugin(NativeToolExecutor)
    await native.await()
  })
  afterEach(async () => { await ctx.fiber.dispose() })

  it('returns sorted immutable declarations while model schemas carry only model fields', () => {
    const permissions = ['question.respond'] as const
    ctx.tools.register({ ...tool('zeta'), permissions })
    ctx.tools.register(tool('alpha'))
    const descriptors = ctx.tools.descriptors()
    expect(descriptors.map(descriptor => descriptor.id)).toEqual(['alpha', 'zeta'])
    expect(descriptors[1]).toEqual({ id: 'zeta', version: 1, risk: 'low', permissions: ['question.respond'], supportsLite: false, supportsRemote: true })
    expect(Object.isFrozen(descriptors)).toBe(true)
    expect(Object.isFrozen(descriptors[1])).toBe(true)
    expect(Object.isFrozen(descriptors[1]!.permissions)).toBe(true)
    expect(descriptors[1]!.permissions).not.toBe(permissions)
    expect(ctx.tools.schemas().map(schema => Object.keys(schema))).toEqual([
      ['name', 'description', 'parameters'], ['name', 'description', 'parameters'],
    ])
  })

  it('rejects incomplete and invalid-version declarations without returning a partial catalog', () => {
    ctx.tools.register(tool('alpha'))
    const { risk: _risk, ...missing } = tool('missing')
    const dispose = ctx.tools.register(missing)
    expect(() => ctx.tools.descriptors()).toThrow(ToolDeclarationUnavailableError)
    dispose()
    ctx.tools.register({ ...tool('invalid-version'), version: 0 })
    expect(() => ctx.tools.descriptors()).toThrow(ToolDeclarationUnavailableError)
  })

  it('applies the same scoped restrictions and shadowing as the executable registry', async () => {
    ctx.tools.register(tool('global'))
    ctx.tools.register(tool('shared'))
    const key = {}
    const scope = createScope(ctx, key)
    await scope.ctx.plugin({
      inject: ['tools'],
      apply(inner: Context) {
        inner.tools.restrict({ deny: ['global'] })
        inner.tools.register({ ...tool('shared'), risk: 'high' })
      },
    })
    expect(ctx.tools.descriptors(key)).toEqual([{ id: 'shared', version: 1, risk: 'high', permissions: [], supportsLite: false, supportsRemote: true }])
    expect(ctx.tools.descriptors().map(descriptor => descriptor.id)).toEqual(['global', 'shared'])
    await scope.dispose()
  })

  it('includes executor-owned transports without registering them as executable capabilities', async () => {
    ctx.tools.register(tool('capability'))
    await native.dispose()
    await native.await()
    ctx.tools.setExecutor({
      transportDefinitions: [tool('transport')],
      describe: () => ({ schemas: [] }),
      execute: () => Promise.resolve({ results: [], additionalContexts: [], concluded: false }),
    })
    expect(ctx.tools.descriptors().map(descriptor => descriptor.id)).toEqual(['capability', 'transport'])
    expect(ctx.tools.definitions().map(definition => definition.name)).toEqual(['capability'])
  })
})
