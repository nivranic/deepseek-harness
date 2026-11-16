/** Host-wide catalog assembled from current global and declared preset tool scopes. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { ToolDeclarationUnavailableError } from '@deepseek-ai/dsh-tools'
import type { ToolDescriptor, ToolDescriptorList } from '@deepseek-ai/dsh-tools/types'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Read-only Host tool declaration Remote. */
    toolCatalog: ToolCatalogGateway
  }
}

/** Read-only adapter over the ordinary tool registry and retained preset revisions. */
export class ToolCatalogGateway extends TypertRemoteService {
  static inject = ['tools']

  /** @param ctx - Host services retaining the current tool and preset compositions. */
  constructor(ctx: Context) {
    super(ctx, 'toolCatalog', {
      namespace: 'tools',
      capabilities: [{ id: 'tool.catalog.v1', methods: ['list'], requiredPermission: 'view' }],
    })
  }

  /**
   * Read current global and declared preset tools without creating an Agent.
   * @returns One complete id-sorted declaration per tool name.
   * @throws RemoteError when a declaration is incomplete, compositions disagree, or a preset cannot be retained.
   */
  @Remote
  async list(): Promise<ToolDescriptorList> {
    const descriptors = new Map<string, ToolDescriptor>()
    const add = (rows: readonly ToolDescriptor[]): void => {
      for (const descriptor of rows) {
        const previous = descriptors.get(descriptor.id)
        if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(descriptor)) {
          throw new RemoteError('tool-catalog/conflict', `Tool "${descriptor.id}" has conflicting Host declarations.`, { tool: descriptor.id })
        }
        descriptors.set(descriptor.id, descriptor)
      }
    }
    try {
      add(this.ctx.tools.descriptors())
      const presets = this.ctx.get('agentPresets')
      if (presets !== undefined) {
        for (const preset of await presets.list()) {
          await using scope = await presets.acquireScope(preset.id)
          add(this.ctx.tools.descriptors(scope.key))
        }
      }
      return Object.freeze({ tools: Object.freeze([...descriptors.values()].sort((left, right) => left.id.localeCompare(right.id))) })
    } catch (error: unknown) {
      if (error instanceof ToolDeclarationUnavailableError) {
        throw new RemoteError('tool-catalog/declaration-unavailable', error.message, { tool: error.tool }, { cause: error })
      }
      throw error
    }
  }
}
