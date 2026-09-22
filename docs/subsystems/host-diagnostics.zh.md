# Host 诊断

[English](host-diagnostics.md) | 中文

Host 诊断接缝的 wire 类型：第 41 节 health/readiness 快照与第 42 节跨平台诊断载荷，来自 [`packages/api/host-diagnostics/src/types.ts`](../../packages/api/host-diagnostics/src/types.ts)。

## Health 与 readiness

第 41 节区分存活（进程应答）与就绪（是否可接受 Agent 请求）。本第一版 health 基于存在性：每个组件指名它探测的服务，`down` 即缺失的 owner，而不是猜测的故障原因。readiness 不包含 connection 组件——无网络载体的 profile（CLI、desktop pipe）同样是 Host。

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

## 构造即脱敏的载荷

第 42 节载荷以构造方式脱敏：字段集即非秘密事实的枚举——任何 API key、bearer、配对秘密或原始凭据都无法到达它。crash 与 last-error 尚无记录接缝，在它落地前这两个数组保持为空。

```ts type-equiv
/** One §42 plugin row: inventory facts only, never configuration values. */
interface DiagnosticsPlugin {
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: string
}
```

## Support Bundle

第 43 节 bundle 是确定性工件：条目按键序规范序列化后取 SHA-256 进 manifest，链式校验和覆盖有序 manifest 行，collector 重算全部摘要并对篡改大声失败；脱敏器对任意深度的秘密形状键递归拒绝。

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

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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
 * Loader inventory, the released migration chain, and the health snapshot.
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
