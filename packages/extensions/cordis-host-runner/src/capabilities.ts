/** Dynamic Cordis operation support shared by Host discovery and Client admission. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Support declarations preserve Session ownership, exact-run checks and human approval. */
export const DYNAMIC_CORDIS_REMOTE_CAPABILITIES = [
  { id: 'dynamic-cordis.inventory.v1', methods: ['inventory'] },
  { id: 'dynamic-cordis.run.v1', methods: ['runHostHalf'] },
  { id: 'dynamic-cordis.client-code.v1', methods: ['getClientCode'] },
  { id: 'dynamic-cordis.resolve-run.v1', methods: ['resolveRequestRun'] },
  { id: 'dynamic-cordis.settle-run.v1', methods: ['settleUserRun'] },
  { id: 'dynamic-cordis.stop.v1', methods: ['stopFromPanel'] },
  { id: 'dynamic-cordis.undefine.v1', methods: ['undefineFromPanel'] },
  { id: 'dynamic-cordis.inspect-manifest.v1', methods: ['syncInspectManifest'] },
  { id: 'dynamic-cordis.inspect-resolve.v1', methods: ['resolveInspectQuery'] },
  { id: 'dynamic-cordis.report-render.v1', methods: ['reportRenderFailure'] },
  { id: 'dynamic-cordis.report-guard.v1', methods: ['reportClientGuardFailure'] },
  { id: 'dynamic-cordis.invoke.v1', methods: ['invoke'] },
] as const satisfies readonly TypertRemoteCapability[]
