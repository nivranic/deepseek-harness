/** Session operation sets shared by Host advertisement and Client admission. */
import type { TypertRemoteCapability } from '@deepseek-ai/dsh-typert-protocol'

/** Versioned Session promises; an advertised set requires every listed method. */
export const SESSION_REMOTE_CAPABILITIES = [
  { id: 'session.follow.v1', methods: ['follow', 'page'], requiredPermission: 'view' },
  { id: 'session.control.v1', methods: ['control', 'prompt', 'updateQueue', 'cancel'], requiredPermission: 'prompt.send' },
  { id: 'session.cancel-turn.v1', methods: ['cancelTurn'], requiredPermission: 'prompt.send' },
  { id: 'session.rename-at.v1', methods: ['renameAt'], requiredPermission: 'prompt.send' },
  { id: 'session.list.v1', methods: ['list'], requiredPermission: 'view' },
  { id: 'session.manage.v1', methods: ['create', 'rename', 'fork'], requiredPermission: 'prompt.send' },
  { id: 'session.search.v1', methods: ['search'], requiredPermission: 'view' },
  { id: 'session.attachment.v1', methods: ['attachment'], requiredPermission: 'prompt.send' },
  { id: 'model.catalog.v1', methods: ['modelCatalog'], requiredPermission: 'view' },
  { id: 'model.select.v1', methods: ['selectModel'], requiredPermission: 'prompt.send' },
] as const satisfies readonly TypertRemoteCapability[]

/** File candidate discovery; access checks remain with the composed provider. */
export const FILE_REFERENCE_REMOTE_CAPABILITIES = [
  { id: 'file-reference.list.v1', methods: ['list'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]

/** Cold-readable user-invocable skill metadata without skill bodies. */
export const SKILL_CATALOG_REMOTE_CAPABILITIES = [
  { id: 'skill.catalog.v1', methods: ['list'], requiredPermission: 'view' },
] as const satisfies readonly TypertRemoteCapability[]
