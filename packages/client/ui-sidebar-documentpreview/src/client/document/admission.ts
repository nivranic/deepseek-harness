/** Capability-filtered renderer source for one admitted Host. */
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { DocumentPreviewDefinition, DocumentPreviewRegistry } from './registry.ts'

/**
 * Project renderer registrations onto the operation sets an admitted Host serves.
 * @param registry - live renderer registrations.
 * @param capabilities - immutable Host operation declarations.
 * @returns reference-stable snapshots until renderer registrations change.
 */
export function admittedDocumentPreviews(
  registry: DocumentPreviewRegistry,
  capabilities: readonly string[],
): ObservableSnapshot<readonly DocumentPreviewDefinition[]> {
  let previous: readonly DocumentPreviewDefinition[] | undefined
  let admitted: readonly DocumentPreviewDefinition[] = []
  return {
    subscribe: registry.subscribe,
    getSnapshot() {
      const registered = registry.getSnapshot()
      if (registered !== previous) {
        previous = registered
        admitted = registered.filter((definition) => {
          if (!capabilities.includes('workspace-files.stat.v1')) return false
          if (definition.requiredCapabilities?.some(id => !capabilities.includes(id)) === true) return false
          switch (definition.loading) {
            case 'text-pages': return capabilities.includes('workspace-files.read-text.v1')
            case 'bytes-complete': return capabilities.includes('workspace-files.read-all.v1')
            default: return assertNever(definition.loading)
          }
        })
      }
      return admitted
    },
  }
}

function assertNever(mode: never): never {
  throw new Error('Unexpected document loading mode: ' + String(mode))
}
