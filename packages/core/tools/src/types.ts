/** Client-safe tool declarations for bundled and remote catalogs. @module */
import type { RemoteCapabilityPermission } from '@deepseek-ai/dsh-typert-protocol'

/** Host-assessed risk tier derived from a tool's side effects. */
export type ToolRisk = 'low' | 'moderate' | 'high' | 'critical'

/** Complete declaration consumed by remote and bundled Lite catalogs. */
export interface ToolDescriptor {
  readonly id: string
  readonly version: number
  readonly risk: ToolRisk
  readonly permissions: readonly RemoteCapabilityPermission[]
  readonly supportsLite: boolean
  readonly supportsRemote: boolean
}

/** A complete id-sorted catalog whose visibility grants no execution permission. */
export interface ToolDescriptorList {
  readonly tools: readonly ToolDescriptor[]
}
