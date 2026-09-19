/** Session operation sets shared by Host advertisement and Client admission. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Versioned Session promises; an advertised set requires every listed method. */
export const SESSION_REMOTE_CAPABILITIES = [
  { id: 'session.follow.v1', methods: ['follow', 'page'] },
  { id: 'session.control.v1', methods: ['control', 'prompt', 'updateQueue', 'cancel'] },
  { id: 'session.cancel-turn.v1', methods: ['cancelTurn'] },
  { id: 'session.rename-at.v1', methods: ['renameAt'] },
  { id: 'session.manage.v1', methods: ['list', 'create', 'rename', 'fork'] },
  { id: 'session.search.v1', methods: ['search'] },
  { id: 'session.attachment.v1', methods: ['attachment'] },
  { id: 'model.select.v1', methods: ['modelCatalog', 'selectModel'] },
] as const satisfies readonly TypertRemoteCapability[]

/** File candidate discovery; access checks remain with the composed provider. */
export const FILE_REFERENCE_REMOTE_CAPABILITIES = [
  { id: 'file-reference.list.v1', methods: ['list'] },
] as const satisfies readonly TypertRemoteCapability[]

/** Cold-readable user-invocable skill metadata without skill bodies. */
export const SKILL_CATALOG_REMOTE_CAPABILITIES = [
  { id: 'skill.catalog.v1', methods: ['list'] },
] as const satisfies readonly TypertRemoteCapability[]
