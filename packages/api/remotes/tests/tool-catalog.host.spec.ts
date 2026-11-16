/** Live catalog scopes, complete declarations, and recoverable configuration failures. */
import { Context, type Fiber } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool, type ToolRisk } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToolCatalogGateway } from '../src/tool-catalog.ts'

function tool(name: string, risk: ToolRisk = 'low') {
  return defineTool({
    name, description: name, version: 1, risk, permissions: [], supportsLite: false, supportsRemote: true,
    parameters: {}, output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: () => Promise.resolve(name),
  })
}

describe('Host tool catalog adapter', () => {
  let ctx: Context
  let catalog: Fiber
  beforeEach(async () => {
    ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(NativeToolExecutor)
    catalog = ctx.plugin(ToolCatalogGateway)
    await catalog.await()
  })
  afterEach(async () => { await ctx.fiber.dispose() })

  async function presets() {
    await ctx.plugin(Loader)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(AgentRegistry)
    ctx.loader.builtins['catalog-tool'] = {
      inject: ['tools'],
      apply(inner: Context, config: { name: string; risk?: ToolRisk }) {
        inner.tools.register(tool(config.name, config.risk))
      },
    }
    await ctx.plugin(AgentPresets, { default: 'main' })
  }

  it('reads current registrations and removes the Remote when its owner unloads', async () => {
    const dispose = ctx.tools.register(tool('first'))
    expect((await ctx.toolCatalog.list()).tools.map(descriptor => descriptor.id)).toEqual(['first'])
    dispose()
    ctx.tools.register(tool('second'))
    expect((await ctx.toolCatalog.list()).tools.map(descriptor => descriptor.id)).toEqual(['second'])
    expect(ctx.toolCatalog.typertRemote.namespace).toBe('tools')
    await catalog.dispose()
    await catalog.await()
    expect(ctx.get('toolCatalog')).toBeUndefined()
  })

  it('includes preset declarations and collapses identical names without creating Agents', async () => {
    await presets()
    ctx.tools.register(tool('global'))
    await ctx.plugin(AgentPreset, { id: 'main', plugins: [
      { name: 'cordis:catalog-tool', config: { name: 'global' } },
      { name: 'cordis:catalog-tool', config: { name: 'scoped' } },
    ] })
    expect((await ctx.toolCatalog.list()).tools.map(descriptor => descriptor.id)).toEqual(['global', 'scoped'])
    expect(ctx.agents.list()).toEqual([])
  })

  it('rejects conflicting preset declarations and recovers after the conflicting owner unloads', async () => {
    await presets()
    ctx.tools.register(tool('shared'))
    const conflict = ctx.plugin(AgentPreset, { id: 'main', plugins: [
      { name: 'cordis:catalog-tool', config: { name: 'shared', risk: 'high' } },
    ] })
    await conflict
    await expect(ctx.toolCatalog.list()).rejects.toMatchObject({ code: 'tool-catalog/conflict', details: { tool: 'shared' } })
    await conflict.dispose()
    await conflict.await()
    expect((await ctx.toolCatalog.list()).tools.map(descriptor => descriptor.risk)).toEqual(['low'])
  })

  it('reports missing declarations without returning a partial catalog', async () => {
    ctx.tools.register(tool('valid'))
    const { risk: _risk, ...missing } = tool('missing')
    ctx.tools.register(missing)
    await expect(ctx.toolCatalog.list()).rejects.toMatchObject({
      code: 'tool-catalog/declaration-unavailable', details: { tool: 'missing' },
    })
  })
})
