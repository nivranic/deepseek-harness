/** Render the subagent catalog only for the currently admitted discovery capability. */
import type { InjectFace, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SubagentCatalogAccess } from './catalog-access.ts'
import { SubagentHeaderLineage, type SubagentHeaderLineageProps, type SubagentCatalogInjected } from './SubagentHeaderLineage.tsx'

/** Registration-owned catalog source projected into a renderer hook. */
export interface SubagentCatalogAccessInjected {
  readonly hooks: { readonly subagentCatalog: HostObservable<SubagentCatalogAccess> }
}

/**
 * Bind menu lifetime and callbacks to one admitted catalog generation.
 * @param props - standard header data, locale and the catalog authority hook.
 * @returns the current catalog, or nothing while discovery is unavailable.
 */
export function CapabilityAwareSubagentHeader({ useSubagentCatalog, ...props }:
  Omit<SubagentHeaderLineageProps, keyof SubagentCatalogInjected> & InjectFace<SubagentCatalogAccessInjected>) {
  const access = useSubagentCatalog(value => value)
  const child = props.useSessions(state => state.byId[props.lineageSessionId]?.origin === 'subagent')
  return access.actions === undefined
    ? child ? <span>{props.displayTitle}</span> : null
    : <SubagentHeaderLineage key={access.generation} {...props} {...access.actions} />
}
