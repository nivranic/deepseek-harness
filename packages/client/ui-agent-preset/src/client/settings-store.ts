/**
 * Agent-preset roster store shared by the display surfaces.
 *
 * Options come from one `agentPresets.list` call. Writes target the settings
 * namespace fields the host resolves at creation; the management section is
 * the surface that writes them.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SETTINGS_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-api-remotes/client'
import type { AGENT_PRESET_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-agent-presets/capabilities'
import type { AgentPresetRoster } from '@deepseek-ai/dsh-agent-presets/types'

/** The agent-preset settings namespace on the host wire. */
export const AGENT_PRESET_SETTINGS_NS = 'agent-presets'

/**
 * Read this preset surface's operation support from the admitted Host; this does not grant permission.
 * @param ctx - Client context with admitted Host facts.
 * @param capability - owner-declared operation set.
 * @returns whether this Host advertises the operation set.
 */
export function hasHostCapability(
  ctx: ClientContext,
  capability: typeof AGENT_PRESET_REMOTE_CAPABILITIES[number]['id'] | typeof SETTINGS_REMOTE_CAPABILITIES[number]['id'],
): boolean {
  return ctx.remote.$host.capabilities?.includes(capability) === true
}

/** Write only the named agent-preset settings fields. */
async function writeAgentPresetSettings(
  ctx: ClientContext,
  patch: { default?: string; modeSelectionEnabled?: boolean },
): Promise<string | undefined> {
  if (!hasHostCapability(ctx, 'agent-preset.catalog.v1')
    || !hasHostCapability(ctx, 'settings.write.v1')) return undefined
  const response = await ctx.remote.settings.update(AGENT_PRESET_SETTINGS_NS, patch, undefined)
  return response.ok ? undefined : response.error.message
}

/**
 * Persist one preset as the default for sessions created later.
 *
 * The default is a settings field rather than a preset property; the
 * management section writes it here — one home for which namespace and field
 * the host resolves at session creation.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @param id - the preset to make default.
 * @returns the failure message, or undefined after writing or skipping unavailable catalog or Settings write support.
 */
export function writeDefaultPreset(
  ctx: ClientContext,
  id: string,
): Promise<string | undefined> {
  return writeAgentPresetSettings(ctx, { default: id })
}

/**
 * Persist whether new-session surfaces expose preset selection.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @param enabled - whether the picker should be exposed.
 * @returns the failure message, or undefined after writing or skipping unavailable catalog or Settings write support.
 */
export function writeModeSelectionEnabled(
  ctx: ClientContext,
  enabled: boolean,
): Promise<string | undefined> {
  return writeAgentPresetSettings(ctx, { modeSelectionEnabled: enabled })
}

/** One selectable preset. */
export interface AgentPresetOption {
  /** Preset id, written to Settings and the label's fallback. */
  id: string
  /** Whether the preset ships with the deployment or was authored locally. */
  trust: 'system' | 'user'
  /** Display name the preset published, absent when it published none. */
  name?: string
  /** One sentence on what the preset is for. */
  description?: string
}

/** One roster entry exactly as the host reports it. */
export type RosterPreset = AgentPresetRoster['presets'][number]

/** The roster, or the message to show in its place. */
export type RosterRead = { ok: true; value: AgentPresetRoster } | { ok: false; error: string }

const EMPTY_ROSTER: AgentPresetRoster = { presets: [], authorable: false, modeSelectionEnabled: false }

/**
 * Read the advertised catalog; absent support produces an empty roster without dispatch.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @returns the roster, or the message to show in its place.
 */
export async function readRoster(ctx: ClientContext): Promise<RosterRead> {
  const host = ctx.remote.$host
  if (!hasHostCapability(ctx, 'agent-preset.catalog.v1')) return { ok: true, value: EMPTY_ROSTER }
  const result = await ctx.remote.agentPresets.list()
  if (ctx.remote.$host !== host) return { ok: true, value: EMPTY_ROSTER }
  if (result.ok) return { ok: true, value: result.value }
  return { ok: false, error: result.error.message }
}

/**
 * The opening move every roster-backed surface makes: refuse a read that is
 * already in flight, mark the store loading, then read.
 *
 * A surface that gets `undefined` returns without touching its snapshot
 * further — either another read owns it, or this one already wrote the
 * failure. What differs between surfaces starts after this.
 * @param ctx - the browser plugin context carrying the Remote namespaces.
 * @param store - the surface's own snapshot store.
 * @returns the roster, or undefined when the caller should return.
 */
export async function beginRosterRead<S extends { status: string; error: string | null }>(
  ctx: ClientContext,
  store: SnapshotStore<S>,
): Promise<AgentPresetRoster | undefined> {
  const before = store.getSnapshot()
  if (before.status === 'loading') return undefined
  store.set({ ...before, status: 'loading', error: null })
  const roster = await readRoster(ctx)
  if (roster.ok) return roster.value
  store.set({ ...store.getSnapshot(), status: 'error', error: roster.error })
  return undefined
}

/**
 * The roster entries as the pickers render them: healthy presets only.
 *
 * The chip exists to choose the NEXT session's composition, and a broken
 * preset cannot compose one — offering it would defer the discovery of that
 * fact to a failed session start. The management section renders the full
 * roster (broken rows included) from its own store instead.
 *
 * The chip, the header label, and the management section all show the same
 * facts, and `exactOptionalPropertyTypes` makes "absent" and "present as
 * undefined" different shapes — so the spread dance belongs in one place rather than
 * once per store.
 * @param presets - the roster the host answered with.
 * @returns one option per selectable preset, in roster order.
 */
export function presetOptions(
  presets: readonly { id: string; trust: 'system' | 'user'; name?: string; description?: string; broken?: string }[],
): AgentPresetOption[] {
  return presets.filter(preset => preset.broken === undefined).map(preset => ({
    id: preset.id,
    trust: preset.trust,
    ...preset.name === undefined ? {} : { name: preset.name },
    ...preset.description === undefined ? {} : { description: preset.description },
  }))
}

/** Agent-preset roster snapshot for the display surfaces. */
export interface AgentPresetSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  error: string | null
  options: readonly AgentPresetOption[]
}

const INITIAL: AgentPresetSettingsState = {
  status: 'idle',
  error: null,
  options: [],
}

/** Reads the roster for the surfaces that only display it. */
export class AgentPresetSettingsController {
  /** Roster snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSettingsState> = createSnapshotStore(INITIAL)

  private loadGeneration = 0

  /**
   * @param ctx - the browser plugin context (the roster read).
   */
  constructor(
    private readonly ctx: ClientContext,
  ) {}

  private set(patch: Partial<AgentPresetSettingsState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * Load the roster. An empty roster means the deployment composes no
   * presets, which is a valid deployment rather than a failure — the
   * surfaces report `unavailable` and render nothing.
   * @returns once the snapshot reflects the host.
   */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    this.set({ status: 'loading', error: null })
    const roster = await readRoster(this.ctx)
    if (generation !== this.loadGeneration) return
    if (!roster.ok) {
      this.set({ status: 'error', error: roster.error })
      return
    }
    const { presets } = roster.value
    if (presets.length === 0) {
      this.set({ status: 'unavailable', options: [] })
      return
    }
    this.set({
      status: 'ready',
      error: null,
      options: presetOptions(presets),
    })
  }

}
