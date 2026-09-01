# 持久产物

[English](artifact.md) | 中文

产物将面向用户的持久输出字节与 Session 日志分开。`artifact_create` 工具追加不透明引用与元数据，通过 [`ctx.artifacts`](#ctxartifacts--artifactstore-abstract-seam) 写入完整内容，再追加 ready 或 failed 状态。日志事件与 Remote projection 只携带引用、kind、title、format 与 status；内容字节永不进入 Session 日志。

真源：[`packages/artifact/artifact/src/types.ts`](../../packages/artifact/artifact/src/types.ts)

## 标识与生命周期

`ArtifactId` 是日志与内容通道共享的不透明 branded string。消费方不得解析 id，也不得从中推导路径。当 Session 日志中的引用证明 format 时，`text` 产物按 UTF-16 code unit 分页；`bytes` 产物按字节分页并返回 base64。内容对象缺失时操作失败，不会把它当成空内容。

`artifact/created` 在 provider 开始写入前发布 id、kind、title 与 `text | bytes` format。写入成功后，`artifact/status` 记录 `ready`；写入被拒绝后则记录 `failed`。Session Remote 控制器在获取字节前证明目标 Session 已记录该引用。`ctx.artifacts` 本身只按引用索引，不负责调用方授权。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxartifacts--artifactstore-abstract-seam"></a>

### `ctx.artifacts` — `ArtifactStore` (abstract seam)

Durable artifact content channel — chapter 56's resource channel. Journal events carry references only; the complete bytes of one artifact live here, keyed by the reference identity `artifact/created` minted.

```ts cordis-catalog
/**
 * Durably write one artifact's complete content bytes under its id.
 * @param id - the artifact reference identity from `artifact/created`.
 * @param data - the complete content bytes.
 */
abstract put(id: ArtifactId, data: Uint8Array): Promise<void>

/**
 * Read one artifact's content bytes back.
 * @param id - the artifact reference identity.
 * @returns the stored bytes, or null when nothing is stored under the id.
 */
abstract get(id: ArtifactId): Promise<Uint8Array | null>

/**
 * Remove one artifact's content bytes.
 * @param id - the artifact reference identity to delete.
 */
abstract remove(id: ArtifactId): Promise<void>
```

Source: [`packages/artifact/artifact/src/index.ts`](../../packages/artifact/artifact/src/index.ts)
<!-- END GENERATED cordis-surface -->
