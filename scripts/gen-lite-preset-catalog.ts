/**
 * Generate `packages/preset/agent-presets/lite-preset-descriptors.json` — the
 * Lite persona/system-prompt projection (specification §33) — by really
 * booting every shipped agent preset through the AgentPresets roster and
 * reading the official SystemPrompt assembly of its standing scope. There is
 * no parallel prompt text behind this file: `assembledSystemPrompt` is exactly
 * what `ctx.systemPrompt.assemble()` returns for a cold reader of the preset,
 * and a preset whose assembled sections still reference `{{variable}}` groups
 * (values only a live agent's loop registers) is recorded under `excluded`
 * rather than substituted. `--check` verifies the committed artifact.
 */

import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load } from 'js-yaml'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include, { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt, type PromptAssembly } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import GoalService from '@deepseek-ai/dsh-goal'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import LocalBashExecutor from '@deepseek-ai/dsh-bash-local'
import { PwshLocalExecutor } from '@deepseek-ai/dsh-pwsh-local'
import * as BashEnvPlugin from '@deepseek-ai/dsh-shell-env'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawnInProcess from '@deepseek-ai/dsh-subagent-spawn-in-process'
import * as SubagentForkInProcess from '@deepseek-ai/dsh-subagent-fork-in-process'
import SubagentModelSelectionConfig from '@deepseek-ai/dsh-tool-subagent/model-selection-settings'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import WebRuntime from '@deepseek-ai/dsh-web'
import CordisHostRunner from '@deepseek-ai/dsh-cordis-host-runner'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import type {
  LitePresetCatalog, LitePresetExclusion, LitePresetProjection,
} from '@deepseek-ai/dsh-agent-presets'

const root = resolve(import.meta.dirname, '..')
const OUT = 'packages/preset/agent-presets/lite-preset-descriptors.json'

/** The composition row that carries a preset's persona. */
const PERSONA_ROW = '@deepseek-ai/dsh-persona'

/** One `{{...}}` reference group, validated as a name only by the caller's use. */
const TEMPLATE_GROUP = /\{\{([^{}]*)\}\}/g

/** The persona row's config as a composition declares it, before plugin defaults. */
interface RawPersonaRow {
  readonly prefix?: unknown
  readonly suffix?: unknown
  readonly complete?: unknown
  readonly includeRuntimeContext?: unknown
}

/**
 * The persona row of one booted preset, carrying the plugin's own defaults for
 * omitted fields (the persona `Config` schema's defaults: empty suffix,
 * `complete: false`, `includeRuntimeContext: true`).
 */
export interface HarvestedPersona {
  readonly prefix: string
  readonly suffix: string
  readonly complete: boolean
  readonly includeRuntimeContext: boolean
}

/** One preset's real-boot harvest: roster identity plus the official assembly. */
export interface LitePresetHarvest {
  /** Stable preset id. */
  readonly id: string
  /** Declared roster position, when the preset's metadata declares one. */
  readonly order?: number
  /** The preset's persona row with plugin defaults applied. */
  readonly persona: HarvestedPersona
  /** The official SystemPrompt assembly of this preset's standing scope. */
  readonly assembly: PromptAssembly
}

/**
 * Variable names one assembled section still references. Only complete
 * `{{...}}` groups count — the registry treats a lone `{{` as literal prose —
 * and names are returned raw: the persona `Config` validates real names, so a
 * non-name group is a template the registry would refuse, not prose to keep.
 * @param text - one assembled section's text.
 * @returns the referenced names in first-appearance order.
 */
export function templateVariablesIn(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(TEMPLATE_GROUP)) {
    const name = match[1] as string
    if (!found.includes(name)) found.push(name)
  }
  return found
}

/**
 * The runtime variables one preset's assembled prompt references. A Lite
 * consumer has no agent loop, so any reference here means the prompt cannot be
 * rendered outside a live session without faking values.
 * @param assembly - the official assembly of one preset's standing scope.
 * @returns the referenced names, deduplicated.
 */
export function requiresRuntimeVariables(assembly: PromptAssembly): string[] {
  const names = new Set<string>()
  for (const section of assembly.sections) {
    for (const name of templateVariablesIn(section.text)) names.add(name)
  }
  return [...names]
}

/**
 * The persona row of one composition, parsed with the Loader's own YAML
 * dialect so the harvest reads exactly what a mount reads.
 * @param content - the composition text, as the roster serves it.
 * @returns the row's config with the persona plugin's defaults applied.
 * @throws when the composition has no persona row, or more than one.
 */
export function personaRowOf(content: string): HarvestedPersona {
  const rows: unknown = load(content, { schema: entryListSchema })
  const found: RawPersonaRow[] = []
  const walk = (entries: readonly unknown[]): void => {
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) continue
      const row = entry as { name?: unknown; group?: unknown; config?: unknown }
      if (Array.isArray(row.config)) walk(row.config)
      if (row.name === PERSONA_ROW) found.push(row.config as RawPersonaRow)
    }
  }
  if (Array.isArray(rows)) walk(rows)
  if (found.length === 0) {
    throw new Error(`gen-lite-preset-catalog: composition declares no ${PERSONA_ROW} row; a Lite projection is persona-driven`)
  }
  if (found.length > 1) {
    throw new Error(`gen-lite-preset-catalog: composition declares ${String(found.length)} ${PERSONA_ROW} rows; expected one`)
  }
  const row = found.at(0)
  if (row === undefined) {
    throw new Error(`gen-lite-preset-catalog: the ${PERSONA_ROW} row vanished between the count check and the read`)
  }
  if (typeof row.prefix !== 'string' || row.prefix.length === 0) {
    throw new Error(`gen-lite-preset-catalog: the ${PERSONA_ROW} row declares no prefix text`)
  }
  const literal = (field: 'complete' | 'includeRuntimeContext'): boolean => {
    const value: unknown = row[field]
    if (value === undefined) return field === 'complete' ? false : true
    if (typeof value !== 'boolean') {
      throw new Error(
        `gen-lite-preset-catalog: the ${PERSONA_ROW} row declares ${field} as a deferred expression; a static Lite projection requires literal booleans`,
      )
    }
    return value
  }
  return {
    prefix: row.prefix,
    suffix: typeof row.suffix === 'string' ? row.suffix : '',
    complete: literal('complete'),
    includeRuntimeContext: literal('includeRuntimeContext'),
  }
}

/**
 * Stage the directory the roster resolves row package names against.
 *
 * Preset-row health is a disk walk (`node_modules/<pkg>/package.json` above
 * the harness base) and the loader imports through Node's internal module
 * loader — two resolutions the repository's tsconfig alias map serves only
 * under the tsx source launch. This stage satisfies the disk walk the way an
 * installed harness would: one `node_modules/@deepseek-ai` scope holding a
 * link to every workspace package. The links never choose what loads — the
 * imports still resolve through the tsconfig aliases to `src/`, so the boot
 * stays on the source plane and no built `lib/` mixes in.
 * @returns the staged harness base directory.
 */
function stageHarnessBase(): string {
  const base = resolve(root, '.tmp/lite-preset-catalog/base')
  const scope = join(base, 'node_modules', '@deepseek-ai')
  mkdirSync(scope, { recursive: true })
  const packages = resolve(root, 'packages')
  for (const group of readdirSync(packages, { withFileTypes: true })) {
    if (!group.isDirectory()) continue
    for (const entry of readdirSync(join(packages, group.name), { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === 'node_modules') continue
      let name: string | undefined
      try {
        const manifest: unknown = JSON.parse(readFileSync(join(packages, group.name, entry.name, 'package.json'), 'utf8'))
        name = typeof manifest === 'object' && manifest !== null && typeof (manifest as { name?: unknown }).name === 'string'
          ? (manifest as { name: string }).name
          : undefined
      } catch {
        // Not a package (a shared README, a fixtures tree); nothing to link.
        continue
      }
      if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) continue
      const link = join(scope, name.slice('@deepseek-ai/'.length))
      rmSync(link, { recursive: true, force: true })
      symlinkSync(
        join(packages, group.name, entry.name),
        link,
        process.platform === 'win32' ? 'junction' : 'dir',
      )
    }
  }
  return base
}

/**
 * Boot the host-side service stack every shipped preset's rows inject, plus
 * the preset roster over the shipped root. One context for all presets: each
 * preset still composes its own standing scope, so assemblies stay attributed
 * to exactly one composition, and one boot amortizes the shared registries.
 *
 * The stack mirrors what the shipped host compositions keep on the host plane
 * (the registries, executors, and policy services a preset row injects but
 * must not own), mounting per platform the single shell executor the host
 * ships — the same `!!js` gate the presets' own shell rows apply.
 * @returns the booted context; the caller owns disposal.
 */
async function bootRosterContext(): Promise<Context> {
  const ctx = new Context()
  // The staged base: preset-row health resolves package names against it.
  ctx.baseUrl = pathToFileURL(stageHarnessBase()).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.group = Group
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(CommandRuntime)
  await ctx.plugin(GoalService)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(BashEnvPlugin)
  await ctx.plugin(process.platform === 'win32' ? PwshLocalExecutor : LocalBashExecutor)
  await ctx.plugin(LocalFileSystem)
  await ctx.plugin(LocalJobRegistry)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(SandboxPolicyService)
  await ctx.plugin(SubagentRuntime)
  // The real in-process backends the shipped presets' delegation rows name.
  await ctx.plugin(SubagentSpawnInProcess)
  await ctx.plugin(SubagentForkInProcess)
  // The Host-scope settings owner the delegation rows' model selection reads.
  await ctx.plugin(SubagentModelSelectionConfig)
  await ctx.plugin(TokenMeter)
  await ctx.plugin(WebRuntime)
  // The dynamic-package runner and inspect registry the `cordis` preset reads.
  await ctx.plugin(CordisHostRunner)
  await ctx.plugin(AgentPresets, { default: 'standard', roots: [], includeShippedRoot: true, includeUserRoot: false })
  return ctx
}

/**
 * Really boot every shipped preset and harvest its official assembly.
 *
 * A broken shipped preset fails the harvest rather than dropping out: the
 * roster reports the reason, and a composition doc-sync cannot mount is a
 * regression the generator must surface, not project around.
 * @returns every shipped preset's harvest plus the shipped id list, ordered by id.
 */
export async function collectLitePresetCatalog(): Promise<{
  readonly harvested: readonly LitePresetHarvest[]
  readonly shipped: readonly string[]
}> {
  // Ship-mounted skill discovery reads real homes through the shipped rows'
  // default config; point both at a scratch directory so the boot reads no
  // user state and the artifact stays machine-independent.
  const previousDshHome = process.env.DSH_HOME
  const previousAgentsHome = process.env.DSH_AGENTS_HOME
  const scratch = resolve(root, '.tmp/lite-preset-catalog')
  mkdirSync(resolve(scratch, '.dsh'), { recursive: true })
  mkdirSync(resolve(scratch, '.agents'), { recursive: true })
  process.env.DSH_HOME = resolve(scratch, '.dsh')
  process.env.DSH_AGENTS_HOME = resolve(scratch, '.agents')
  const ctx = await bootRosterContext()
  try {
    const presets = (await ctx.agentPresets.list()).slice().sort((left, right) => left.id.localeCompare(right.id))
    const harvested: LitePresetHarvest[] = []
    for (const preset of presets) {
      if (preset.broken !== undefined) {
        throw new Error(`gen-lite-preset-catalog: shipped preset "${preset.id}" is broken: ${preset.broken}`)
      }
      const persona = personaRowOf(await ctx.agentPresets.read(preset.id))
      // The cold-reader route: composes the standing scope without starting an
      // agent, session, or turn — the same mount a transcript read resolves.
      const scope = await ctx.agentPresets.standingKeyFor(preset.id)
      const assembly = await ctx.systemPrompt.assemble({ scope })
      const personaSection = assembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)
      if (personaSection === undefined || personaSection.text !== persona.prefix) {
        throw new Error(
          `gen-lite-preset-catalog: preset "${preset.id}" assembled without its declared persona prefix section; `
          + 'the projection would not be the official assembly',
        )
      }
      harvested.push({
        id: preset.id,
        ...preset.order === undefined ? {} : { order: preset.order },
        persona,
        assembly,
      })
    }
    return { harvested, shipped: presets.map(preset => preset.id) }
  } finally {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    if (previousAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
    else process.env.DSH_AGENTS_HOME = previousAgentsHome
    await ctx.fiber.dispose()
  }
}

/**
 * Assert every shipped preset lands in exactly one projection list. A preset
 * in neither — or in both — means the harvest silently dropped or duplicated
 * a composition, which is a generator bug, not a projection decision.
 * @param shipped - every shipped preset id.
 * @param projected - the ids the projection carries.
 * @param excluded - the ids the exclusion list carries.
 * @throws naming the first unaccounted, duplicated, or unknown id.
 */
export function assertCatalogCoverage(shipped: readonly string[], projected: readonly string[], excluded: readonly string[]): void {
  const known = new Set(shipped)
  for (const id of [...projected, ...excluded]) {
    if (!known.has(id)) {
      throw new Error(`gen-lite-preset-catalog: id "${id}" is projected but not shipped; the harvest invented a preset`)
    }
  }
  const carried = new Set([...projected, ...excluded])
  const missing = shipped.filter(id => !carried.has(id))
  if (missing.length > 0) {
    throw new Error(
      `gen-lite-preset-catalog: ${missing.length} shipped preset(s) in neither list: ${missing.join(', ')}. `
      + 'Every shipped preset must be projected or explicitly excluded.',
    )
  }
  const duplicated = projected.filter(id => excluded.includes(id))
  if (duplicated.length > 0) {
    throw new Error(`gen-lite-preset-catalog: id(s) ${duplicated.join(', ')} appear in both lists; a preset is projected or excluded, never both`)
  }
}

/**
 * Split one harvest into the committed projection rows and exclusions.
 * @param harvest - one preset's boot harvest.
 * @returns the projection row, or the exclusion record.
 */
export function projectHarvest(harvest: LitePresetHarvest): LitePresetProjection | LitePresetExclusion {
  const variables = requiresRuntimeVariables(harvest.assembly).sort((left, right) => left.localeCompare(right))
  if (variables.length > 0) {
    return { id: harvest.id, reason: 'requires runtime variables', variables }
  }
  const assembledSystemPrompt = renderPrompt(harvest.assembly)
  if (assembledSystemPrompt.length === 0) {
    throw new Error(`gen-lite-preset-catalog: preset "${harvest.id}" assembled to an empty system prompt; refusing to project emptiness`)
  }
  return {
    id: harvest.id,
    ...harvest.order === undefined ? {} : { order: harvest.order },
    persona: {
      prefix: harvest.persona.prefix,
      ...harvest.persona.suffix.length > 0 ? { suffix: harvest.persona.suffix } : {},
      complete: harvest.persona.complete,
    },
    includeRuntimeContext: harvest.persona.includeRuntimeContext,
    assembledSystemPrompt,
  }
}

/**
 * Render the committed Lite preset projection document (pure, deterministic
 * given its input): both lists ordered by id under the regeneration comment.
 * @param harvests - every shipped preset's boot harvest.
 * @returns the complete JSON file content.
 */
export function renderLitePresetCatalog(harvests: readonly LitePresetHarvest[]): string {
  const rows = harvests.map(projectHarvest)
  const presets = rows
    .filter((row): row is LitePresetProjection => 'assembledSystemPrompt' in row)
    .sort((left, right) => left.id.localeCompare(right.id))
  const excluded = rows
    .filter((row): row is LitePresetExclusion => 'variables' in row)
    .sort((left, right) => left.id.localeCompare(right.id))
  assertCatalogCoverage(
    harvests.map(harvest => harvest.id),
    presets.map(preset => preset.id),
    excluded.map(exclusion => exclusion.id),
  )
  const document: LitePresetCatalog & { _comment: string } = {
    _comment: 'Generated by scripts/gen-lite-preset-catalog.ts — do not edit by hand. Run `pnpm run gen-lite-preset-catalog` to regenerate. '
      + 'Lite persona projection (specification §33): each row is the OFFICIAL SystemPrompt assembly of one shipped agent preset, harvested by '
      + 'really booting the preset through the AgentPresets roster and calling ctx.systemPrompt.assemble() on its standing scope; there is no '
      + 'parallel prompt system behind this file. A preset whose assembled sections still reference {{variable}} groups is listed under '
      + '"excluded" instead — those values are registered per agent at runtime, and this projection never substitutes placeholders.',
    presets,
    excluded,
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

/**
 * CLI entry: default writes the artifact, `--check` fails when the committed
 * copy is stale. Guarded behind an entry-point check so importing this module
 * for tests neither regenerates the committed file nor calls process.exit.
 */
async function main(): Promise<void> {
  const content = renderLitePresetCatalog((await collectLitePresetCatalog()).harvested)
  if (process.argv.includes('--check')) {
    let committed: string | null = null
    try {
      committed = readFileSync(resolve(root, OUT), 'utf8')
    } catch {
      // Only ENOENT (not yet generated) is expected; either way the remedy is
      // the same — regenerate — so treat a read failure as "stale".
      committed = null
    }
    if (committed === content) {
      console.log(`gen-lite-preset-catalog: ${OUT} is up to date.`)
      process.exit(0)
    }
    console.error(`gen-lite-preset-catalog: ${OUT} is stale. Run \`pnpm run gen-lite-preset-catalog\` and commit ${OUT}.`)
    const committedLines = committed?.split('\n') ?? []
    const generatedLines = content.split('\n')
    const lineCount = Math.max(committedLines.length, generatedLines.length)
    for (let index = 0; index < lineCount; index += 1) {
      if (committedLines[index] === generatedLines[index]) continue
      console.error(`gen-lite-preset-catalog: first difference at line ${index + 1}`)
      console.error(`  committed: ${JSON.stringify(committedLines[index])}`)
      console.error(`  generated: ${JSON.stringify(generatedLines[index])}`)
      break
    }
    process.exit(1)
  }

  writeFileSync(resolve(root, OUT), content)
  console.log(`gen-lite-preset-catalog: wrote ${OUT}.`)
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  await main()
}
