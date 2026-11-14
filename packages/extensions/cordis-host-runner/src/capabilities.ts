/** Dynamic Cordis operation support shared by Host discovery and Client admission. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Support declarations preserve Session ownership, exact-run checks and human approval. */
export const DYNAMIC_CORDIS_REMOTE_CAPABILITIES = [
  { id: 'dynamic-cordis.inventory.v1', methods: ['inventory'], requiredPermission: 'view' },
  { id: 'dynamic-cordis.run.v1', methods: ['runHostHalf'], requiredPermission: 'prompt.send' },
  { id: 'dynamic-cordis.client-code.v1', methods: ['getClientCode'], requiredPermission: 'view' },
  { id: 'dynamic-cordis.resolve-run.v1', methods: ['resolveRequestRun'], requiredPermission: 'prompt.send' },
  { id: 'dynamic-cordis.settle-run.v1', methods: ['settleUserRun'], requiredPermission: 'prompt.send' },
  { id: 'dynamic-cordis.stop.v1', methods: ['stopFromPanel'], requiredPermission: 'prompt.send' },
  { id: 'dynamic-cordis.undefine.v1', methods: ['undefineFromPanel'], requiredPermission: 'prompt.send' },
  { id: 'dynamic-cordis.inspect-manifest.v1', methods: ['syncInspectManifest'], requiredPermission: 'view' },
  { id: 'dynamic-cordis.inspect-resolve.v1', methods: ['resolveInspectQuery'], requiredPermission: 'view' },
  { id: 'dynamic-cordis.report-render.v1', methods: ['reportRenderFailure'], requiredPermission: 'prompt.send' },
  { id: 'dynamic-cordis.report-guard.v1', methods: ['reportClientGuardFailure'], requiredPermission: 'prompt.send' },
  { id: 'dynamic-cordis.invoke.v1', methods: ['invoke'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]
