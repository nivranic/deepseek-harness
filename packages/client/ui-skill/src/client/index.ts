/**
 * Skill reference plugin, browser half: registers the '/' skill source —
 * candidates from the `skills/list` Remote addressed by the per-call session
 * projection's sessionId (sessions are always agent-backed; the host
 * resolves cwd from the session header). A pick lands the literal `/name `
 * text and the prompt ships the same literal (plain-text-reference decision;
 * see .agents/notes/archived/architecture/2026-07-25-web-input-machine-and-slash-pipeline.md);
 * determinism
 * lives host-side — the pre-step boundary (`dsh-tool-skill`) recognizes a
 * leading `/name` naming a user-invocable skill and injects the rendered
 * body for every entry point, including `disable-model-invocation` skills the
 * model-side catalog never lists (issue #1470). The RPC rides the plugin's
 * root-context Remote captured at registration — the source never reads
 * services off a per-call argument. Draft chip visuals derive from
 * the lexicon scan; this source implements no reference codec.
 *
 * Catalog fetches are cached per session (the small twin of the ui-commands
 * directory): the per-keystroke candidates re-poll filters a settled
 * snapshot locally, so one session costs one RPC. The scope-birth warm hook
 * prewarms the session's key; a preset switch drops that one key (the
 * catalog is the preset's, and a blank session may switch after the warm);
 * Connection generation replacement clears everything — the host
 * catalog may differ across generations. A shared in-flight fetch
 * deliberately outlives any single menu interaction: closing the menu must
 * not kill the prewarm other consumers will hit, so it carries its own
 * abort (fired only on invalidation/teardown) while a candidates caller
 * with an aborted signal just returns early.
 *
 * This browser half also owns the `skill` keyed toolview: a replay-stable
 * accent row derived only from each logged call/result slice.
 */
// Type-only: the carrier types, the forwarded Host-event face and the ctx.remote merge.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SkillEntry, SKILL_CATALOG_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputTriggerServiceContract, InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import { rankByName } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { SkillRow } from './SkillRow.tsx'
import { en, NS, zh, type SkillKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The dedicated skill tool row's copy. */
    skill: SkillKey
  }
}

/** One session's catalog fetch: the shared promise plus its own abort handle. */
interface CatalogFetch {
  readonly promise: Promise<readonly SkillEntry[]>
  readonly abort: AbortController
  /** Settled catalog for synchronous lexicon reads (unset while in flight or on failure). */
  settled?: readonly SkillEntry[]
}

/** Required services: reference source faces plus the tool-row and locale registries. */
export const inject = ['inputTriggers', 'sessions', 'slots', 'locale', 'remote', 'remote.skills', 'sidebarRight', 'sidebarRightTabs', 'connection']

/**
 * Client plugin body: register the '/' source, dictionaries, and keyed tool row.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-skill: dictionaries')
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'skill', locale: NS },
    SkillRow,
  ))

  const remote = ctx.remote
  const skills = remote.skills
  const sessions = ctx.sessions
  const connection = ctx.get('connection') as ConnectionHandle
  const capability: typeof SKILL_CATALOG_REMOTE_CAPABILITIES[number]['id'] = 'skill.catalog.v1'
  let disposed = false
  const supported = (): boolean => !disposed && remote.$host.capabilities?.includes(capability) === true
  // Session-keyed catalog cache; single-flight per key. Plugin-closure state:
  // the fiber effect below is its teardown boundary.
  const fetches = new Map<SessionId, CatalogFetch>()
  // Per-session lexicon invalidation listeners (subscribeLexicon consumers).
  const lexiconListeners = new Map<SessionId, Set<() => void>>()

  const notifyLexicon = (sessionId: SessionId): void => {
    for (const listener of [...(lexiconListeners.get(sessionId) ?? [])]) {
      try {
        listener()
      } catch (error) {
        // Contain listener failures: settlement notifies from an ignored
        // promise chain (a throw would surface as an unhandled rejection)
        // and one faulty consumer must not starve the others.
        console.error('[ui-skill] lexicon listener failed:', error)
      }
    }
  }

  const fetchCatalog = (sessionId: SessionId): CatalogFetch => {
    const existing = fetches.get(sessionId)
    if (existing !== undefined) return existing
    const abort = new AbortController()
    const host = ctx.remote.$host
    const promise = (async () => {
      const result = await skills.list({ sessionId }, abort.signal)
      abort.signal.throwIfAborted()
      if (ctx.remote.$host !== host) return []
      if (!result.ok) throw result.error
      return result.value.skills
    })()
    const entry: CatalogFetch = { promise, abort }
    fetches.set(sessionId, entry)
    promise.then(
      // Settled snapshot backs the synchronous lexicon reads.
      (skills) => {
        if (fetches.get(sessionId) !== entry || abort.signal.aborted || ctx.remote.$host !== host) return
        entry.settled = skills
        notifyLexicon(sessionId)
      },
      // A failed fetch must not poison the key: the next consumer retries.
      () => {
        if (fetches.get(sessionId) === entry) fetches.delete(sessionId)
      },
    )
    return entry
  }

  const invalidate = (key: SessionId): void => {
    const entry = fetches.get(key)
    if (entry === undefined) return
    fetches.delete(key)
    entry.abort.abort()
    notifyLexicon(key)
  }

  const clearAll = (): void => {
    for (const key of [...fetches.keys()]) invalidate(key)
  }

  // The bound translate resolves against the registered dictionaries with the
  // locale service's own fallback ladder; candidate-time reads stay plain text.
  const t = ctx.locale.bind(NS)

  const source: InputTriggerSource = {
    trigger: '/',
    name: 'skill',
    order: 2,
    subscribeCandidates: (_session, listener) => connection.generation.subscribe(listener),
    async candidates(session, { query, signal }) {
      const cancelled = (): boolean => signal.aborted
      if (!supported() || cancelled() || sessions.subagentAddress(session.sessionId) !== undefined) return []
      const entry = fetchCatalog(session.sessionId)
      const skills = await entry.promise
      // Superseded keystroke: the shared fetch stays warm, this caller yields.
      if (cancelled() || entry.abort.signal.aborted || fetches.get(session.sessionId) !== entry) return []
      // The same ranking as the command group of this menu: case-insensitive
      // ordered subsequence, prefix hits first.
      return rankByName(skills, query)
        .map(skill => ({
          name: skill.name,
          // The user-only marker rides the description (the menu's only
          // secondary text); `hint` is the claim-state ghost text, not a badge.
          description: skill.modelInvocable ? skill.description : `${t('menu.userOnly')} · ${skill.description}`,
        }))
    },
    warm(session) {
      // Fire-and-forget scope-birth prewarm; the shared fetch reports
      // through candidates.
      if (!supported() || sessions.subagentAddress(session.sessionId) !== undefined) return
      fetchCatalog(session.sessionId).promise.catch(() => {})
    },
    lexicon(session) {
      if (!supported()) return undefined
      return fetches.get(session.sessionId)?.settled?.map(skill => skill.name)
    },
    subscribeLexicon(session, listener) {
      const key = session.sessionId
      const listeners = lexiconListeners.get(key) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(key, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(key)
      }
    },
    canOpenReference(session, { ref }) {
      if (!supported()) return false
      if (sessions.subagentAddress(session.sessionId) !== undefined) return false
      const path = fetches.get(session.sessionId)?.settled?.find(skill => '/' + skill.name === ref)?.path
      if (path === undefined) return false
      const cwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd
      return ctx.sidebarRightTabs.candidates(fileAddressFor(session.sessionId, cwd, path)).length > 0
    },
    subscribeReferenceAvailability: (_session, listener) => ctx.sidebarRightTabs.subscribe(listener),
    openReference(session, reference) {
      if (source.canOpenReference?.(session, reference) !== true) return false
      const path = fetches.get(session.sessionId)?.settled?.find(skill => '/' + skill.name === reference.ref)?.path
      if (path === undefined) return false
      const cwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd
      ctx.sidebarRight.openResource(fileAddressFor(session.sessionId, cwd, path))
      return true
    },
    onPick({ candidate }) {
      if (!supported()) return undefined
      // Plain-text-reference decision (web-input-machine note): the pick
      // lands plain text and the prompt ships the same
      // literal. Determinism lives host-side — the host's
      // pre-step boundary (dsh-tool-skill) recognizes the leading /name and
      // injects the rendered body for every entry point. A name shared with a
      // host command still resolves to the command: adjudication claims the
      // line client-side before it ever becomes a prompt.
      return { text: `/${candidate.name} ` }
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  // A preset decides which skill providers an agent reads, so a switched
  // session's cached catalog belongs to the composition it no longer runs.
  ctx.remote.$on('agent-preset/selected', invalidate)
  ctx.effect(() => connection.generation.subscribe(clearAll), 'ui-skill: Host catalog generation')
  ctx.effect(() => {
    const unregister = inputTriggers.registerSource(source)
    return () => {
      disposed = true
      unregister()
      clearAll()
    }
  }, 'ui-skill: source')
}
