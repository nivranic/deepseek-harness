/**
 * §42 crash and last-error recording: a pid-safe boot marker under the harness
 * home turns an unclean previous shutdown into a durable crash fact, and the
 * agent error relay fills a process-local capped ring. Facts carry identity
 * and text only, so the diagnostics payload stays sanitized by construction.
 * @module recorder
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { DiagnosticsCrashFact, DiagnosticsErrorFact } from './types.ts'

/** History bound for the durable crash log; the boot scan keeps the newest facts. */
export const MAX_CRASH_FACTS = 8

/** History bound for the process-local last-error ring. */
export const MAX_LAST_ERROR_FACTS = 10

const MARKER_NAME = 'diagnostics-crash.marker'
const CRASH_LOG_NAME = 'diagnostics-crash-log.json'

/** The boot marker's durable form: which run is alive, and when it started. */
interface CrashMarker {
  readonly pid: number
  readonly runStartedAt: number
}

/** True when some process still holds this pid; a failed signal-0 probe other than ESRCH still means alive. */
function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
  } catch (error) {
    return !((error as { code?: string } | null)?.code === 'ESRCH')
  }
  return true
}

/** Durable-file validation for a crash fact. */
function isCrashFact(value: unknown): value is DiagnosticsCrashFact {
  if (typeof value !== 'object' || value === null) return false
  const { pid, runStartedAt } = value as Record<string, unknown>
  return typeof pid === 'number' && Number.isInteger(pid) && pid >= 0
    && typeof runStartedAt === 'number' && Number.isFinite(runStartedAt)
}

/** Durable-file validation for the boot marker. */
function isCrashMarker(value: unknown): value is CrashMarker {
  return isCrashFact(value)
}

/** Records §42 crash facts and the capped agent-error ring for the diagnostics service. */
export class DiagnosticsRecorder {
  private readonly crashFacts: DiagnosticsCrashFact[] = []
  private readonly errorFacts: DiagnosticsErrorFact[] = []
  private readonly markerPath = dshHomePath(MARKER_NAME)
  private readonly crashLogPath = dshHomePath(CRASH_LOG_NAME)

  constructor(ctx: Context) {
    this.loadCrashLog()
    this.detectUncleanShutdown()
    this.writeMarker()
    ctx.effect(() => {
      // Clean disposal removes the marker so the next boot reads a missing
      // marker as a clean shutdown; the effect body itself owns nothing.
      return () => {
        rmSync(this.markerPath, { force: true })
      }
    })
    ctx.on('agent/error', ({ agent, turn, step, error }) => {
      this.recordError(agent.id, turn, step, error)
    })
  }

  /** Detected unclean shutdowns, oldest first within the cap. */
  get crash(): readonly DiagnosticsCrashFact[] {
    return this.crashFacts
  }

  /** The newest agent errors, oldest first within the cap; carries no payload or stack. */
  get lastErrors(): readonly DiagnosticsErrorFact[] {
    return this.errorFacts
  }

  /**
   * Record one normalized agent error into the capped ring.
   * @param agentId - the failing agent's id.
   * @param turn - the turn in which the failure surfaced.
   * @param step - the step at which the failure surfaced.
   * @param error - the failure, verbatim; non-Error values normalize to name `Error`.
   */
  recordError(agentId: string, turn: number, step: number, error: unknown): void {
    const { name, message } = error instanceof Error
      ? { name: error.name, message: error.message }
      : { name: 'Error', message: String(error) }
    this.errorFacts.push({ time: Date.now(), name, message, agentId, turn, step })
    if (this.errorFacts.length > MAX_LAST_ERROR_FACTS) {
      this.errorFacts.splice(0, this.errorFacts.length - MAX_LAST_ERROR_FACTS)
    }
  }

  private loadCrashLog(): void {
    if (!existsSync(this.crashLogPath)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.crashLogPath, 'utf8'))
    } catch {
      // Only the crash log's own parse can fail here; a corrupt history row is dropped, not fatal to boot.
      return
    }
    if (Array.isArray(parsed)) {
      for (const fact of parsed) {
        if (isCrashFact(fact)) this.crashFacts.push(fact)
      }
    }
  }

  private detectUncleanShutdown(): void {
    if (!existsSync(this.markerPath)) return
    let marker: CrashMarker | undefined
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.markerPath, 'utf8'))
      if (isCrashMarker(parsed)) marker = parsed
    } catch {
      marker = undefined
    }
    // A marker whose pid still lives is a concurrent run's marker, not a crash;
    // an unparsable marker still proves the previous run never cleaned up, and
    // the file's mtime stands in for the unparsable start time.
    const fact = marker !== undefined && pidAlive(marker.pid)
      ? undefined
      : marker ?? { pid: 0, runStartedAt: statSync(this.markerPath).mtimeMs }
    if (fact === undefined) return
    this.crashFacts.push(fact)
    if (this.crashFacts.length > MAX_CRASH_FACTS) {
      this.crashFacts.splice(0, this.crashFacts.length - MAX_CRASH_FACTS)
    }
    writeFileSync(this.crashLogPath, `${JSON.stringify(this.crashFacts)}\n`)
  }

  private writeMarker(): void {
    mkdirSync(dirname(this.markerPath), { recursive: true })
    writeFileSync(this.markerPath, `${JSON.stringify({ pid: process.pid, runStartedAt: Date.now() } satisfies CrashMarker)}\n`)
  }
}
