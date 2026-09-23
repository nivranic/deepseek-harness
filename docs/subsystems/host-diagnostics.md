# Host Diagnostics

English | [中文](host-diagnostics.zh.md)

Wire types of the host-diagnostics seam: the section 41 health/readiness snapshot and the section 42 cross-platform diagnostics payload, from [`packages/api/host-diagnostics/src/types.ts`](../../packages/api/host-diagnostics/src/types.ts).

## Health and readiness

Section 41 distinguishes liveness (the process answering) from readiness (whether Agent requests are acceptable). Health is presence-based in this first cut: every component names the service it probed, so a `down` is a missing owner, not a guessed cause. Readiness excludes the connection component — a profile without a network carrier (CLI, desktop pipe) is still a Host.

```ts type-equiv
/** One §41 health component's evaluated state; `degraded` is reserved for probe seams that can see partial failure. */
type ComponentHealth = 'up' | 'degraded' | 'down'
```

```ts type-equiv
/** One §42 migration step this Host build knows, by name and version pair. */
interface DiagnosticsMigration {
  readonly name: string
  readonly fromVersion: number
  readonly toVersion: number
}
```

## Sanitized payload

The section 42 payload is sanitized by construction: the field set is the enumeration of non-secret facts — no API key, bearer, pairing secret, or raw credential can reach it. Crash and last-error recording is always on: a pid-safe boot marker under `$DSH_HOME` turns an unclean previous shutdown into a durable capped crash log (a live pid is a concurrent run, not a crash), and the agent error relay fills a process-local capped ring of normalized facts.

```ts type-equiv
/** One §42 plugin row: inventory facts only, never configuration values. */
interface DiagnosticsPlugin {
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: string
}
```

## Support Bundle

The section 43 bundle is a deterministic artifact: entries serialize canonically (key-sorted) into per-entry SHA-256 manifest rows, a chained checksum covers the ordered rows, and the collector recomputes every digest and fails loud on tampering; the sanitizer recursively refuses secret-shaped keys at any depth.

```ts type-equiv
/** The §43 support bundle: sanitized entries, their manifest, and the chained checksum. */
interface SupportBundle {
  readonly manifest: readonly SupportBundleManifestEntry[]
  /** SHA-256 over the ordered manifest rows' `path:sha256` lines. */
  readonly checksum: string
  readonly entries: readonly SupportBundleEntry[]
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxhostdiagnostics--hostdiagnosticsservice"></a>

### `ctx.hostDiagnostics` — `HostDiagnosticsService`

Host-diagnostics service (`ctx.hostDiagnostics`) composing §41/§42 facts.

```ts cordis-catalog
/**
 * Evaluate the six §41 health components. Answering IS the process and
 * runtime proof; the remaining components probe their owning services, so a
 * `down` names the missing owner instead of guessing a cause.
 * @returns the health snapshot with the derived readiness verdict.
 */
@Remote('health') health(): HealthSnapshot

/**
 * Compose the §42 diagnostics payload: the Host descriptor facts, the
 * Loader inventory, the released migration chain, the recorder's crash and
 * last-error facts, and the health snapshot.
 * @param signal - optional request cancellation; a cancelled inventory read
 * aborts the composition.
 * @returns the sanitized diagnostics snapshot.
 */
@Remote('describe') async describe(signal?: AbortSignal): Promise<DiagnosticsSnapshot>

/**
 * Produce one §43 support bundle seeded with the just-composed §42
 * diagnostics entry; the collector validates the same artifact.
 * @param signal - optional request cancellation passed to the composition.
 * @returns the sealed, self-checksummed bundle.
 */
@Remote('supportBundle') async supportBundle(signal?: AbortSignal): Promise<SupportBundle>
```

Source: [`packages/api/host-diagnostics/src/index.ts`](../../packages/api/host-diagnostics/src/index.ts)
<!-- END GENERATED cordis-surface -->
