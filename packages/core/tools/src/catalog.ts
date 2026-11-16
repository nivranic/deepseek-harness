/** Host-owned tool declarations projected independently from model schemas. @module */
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from './contracts.ts'
import type { ToolDescriptor } from './types.ts'
export type { ToolDescriptor, ToolDescriptorList } from './types.ts'

/** Catalog reads fail atomically when an installed tool lacks a complete declaration. */
export class ToolDeclarationUnavailableError extends HarnessError {
  constructor(readonly tool: string) {
    super(`Tool "${tool}" requires a complete declaration before its catalog can be read.`, 'TOOL_DECLARATION_UNAVAILABLE')
    this.name = 'ToolDeclarationUnavailableError'
  }
}

/**
 * Copy one complete declaration without retaining mutable producer arrays.
 * @param definition - Registered capability or executor-owned transport.
 * @returns A frozen host-only descriptor.
 * @throws ToolDeclarationUnavailableError when required metadata is absent or its version is invalid.
 */
export function toolDescriptorOf(definition: ToolDefinition): ToolDescriptor {
  const { name, version, risk, permissions, supportsLite, supportsRemote } = definition
  if (version === undefined || !Number.isSafeInteger(version) || version < 1
    || risk === undefined || permissions === undefined || supportsLite === undefined || supportsRemote === undefined) {
    throw new ToolDeclarationUnavailableError(name)
  }
  return Object.freeze({ id: name, version, risk, permissions: Object.freeze([...permissions]), supportsLite, supportsRemote })
}
