/** Capability-bound catalog actions observed through the existing Connection generation. */
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentCatalogInjected } from './SubagentHeaderLineage.tsx'

/** Snapshot lifetime also owns an open catalog's transient menu state. */
export interface SubagentCatalogAccess {
  readonly generation: number
  readonly actions?: SubagentCatalogInjected
}

/**
 * Create a catalog authority hook for one header registration.
 * @param host - current admitted Host facts.
 * @param subscribe - existing Connection generation subscription.
 * @param alive - whether the owning plugin remains mounted.
 * @param actions - session navigation and catalog operations.
 * @returns stable snapshots whose retained actions cannot cross connections.
 */
export function createCatalogAccess(
  host: () => RemoteHostFacts,
  subscribe: (listener: () => void) => () => void,
  alive: () => boolean,
  actions: SubagentCatalogInjected,
): HostObservable<SubagentCatalogAccess> {
  let current: RemoteHostFacts | undefined
  let snapshot: SubagentCatalogAccess | undefined
  let generation = 0
  const getSnapshot = (): SubagentCatalogAccess => {
    const next = alive() ? host() : undefined
    if (snapshot !== undefined && current === next) return snapshot
    current = next
    const allowed = (): boolean => alive() && host() === next
    snapshot = {
      generation: ++generation,
      ...(next?.capabilities?.includes('subagent.catalog.v1') === true ? { actions: {
        openChild: (address) => { if (allowed()) actions.openChild(address) },
        refresh: (parent) => { if (allowed()) actions.refresh(parent) },
        setCatalogOpen: (parent, open) => { if (allowed()) actions.setCatalogOpen(parent, open) },
      } } : {}),
    }
    return snapshot
  }
  return { getSnapshot, subscribe: listener => subscribe(() => { getSnapshot(); listener() }) }
}
