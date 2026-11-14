# Agent Note：Remote 错误码的共享 Client 分类

Status: implemented

[English](2026-09-19-remote-failure-classification.md) | 中文

## Problem

Remote 失败词汇表可合并扩展，每个失败携带一个稳定 code，但需要恢复语义的每个 Client 表面都在用各自的 code 清单重新推导。Gateway client 的 `classifyFailure` 把六个码硬编码进连接阶段；UI 包里散布更多 `.code ===` 分支（`session/steer-unavailable`、`session/not-found` 族、`version-conflict`），没有"哪些码含义相同"的共享定义。规格第 45 节要求所有 Client 对同一错误呈现相同语义，第 18 节要求每个连接阶段有对应的恢复 UX，因此该映射不能停留在各消费者内部。

## Current upstream boundary

官方基线把失败词汇表放在 `@deepseek-ai/dsh-typert-protocol`（`RemoteError`、`remoteErrorOf`、可合并扩展的 `RemoteErrorDetailsMap`），呈现策略留给消费者。本任务已封存的增量补齐了编译器无关清单、正式 draft-2020-12 信封 schema 和生成器门禁；它们都没有定义 Client 侧语义。

## Decision

`@deepseek-ai/dsh-typert-protocol` 的 `src/failure-classes.ts` 拥有唯一封闭分类：`classifyRemoteFailureCode(code)` 与 `classifyRemoteFailure(error)` 把码映射到 `RemoteFailureClass`——`authentication`、`permission`、`host-state`、`compatibility`、`carrier-invalid`、`transport`、`conflict`、`unavailable`、`unknown`。映射有意只收录已有跨 Client 一致含义的码；可合并扩展的词汇表把其余的码（包括所有未来码）解析为 `unknown`。词汇表 owner 即分类 owner，因此每个 Client——现在的 TS，采用该契约后的 Swift 与 Kotlin——读取同一来源，而不是复制清单。

Gateway client 的 `classifyFailure` 现在把分类投影到连接阶段（`compatibility` → `incompatible`、`carrier-invalid` → `fatal`，其余保持默认重连行为）；对原有已分类码的可观察行为不变，由既有 133 项 client 测试覆盖。

## Alternatives considered

把分类表放进 `@deepseek-ai/dsh-client-connection` 会让裸传输包依赖协议；从 JSON Schema 生成分类则必须发明 schema 并不携带的语义。按 owner 各自提供呈现提示会重新制造本 note 要消除的清单复制问题。

## Contract

`classifyRemoteFailureCode` 是全函数：任意字符串都解析到一个类，`unknown` 从不修改或拒绝诊断。分类不授予能力、权限、重试策略或协议版本准入；它只命名 Client 接下来可做的事。`REMOTE_FAILURE_CLASSES` 以只读形式导出，供校验和未来的原生投影使用。`scripts/verify-remote-error-model.ts` 的 `verifyRemoteFailureClassification(expected, classes)` 拒绝引用仓库清单未声明码的分类；`analyzeRemoteErrorWorkspace` 在 `verify-remote-error-envelope` doc-sync 门禁内执行它，分类因此无法脱离词汇表漂移。

## Persistence

无。分类是错误码上的纯函数；Session 存储、事件与 writer 版本 3 均未触碰。

## Security

类名不携带秘密，也不携带权限。恶意或更新的 Host 发来未知码得到 `unknown`；Client 仍须原样呈现 code、message 与 details，不执行类名暗示的恢复动作。`permission` 描述 Host 的拒绝，不是 Client 侧授权决定。

## Compatibility

已分类码保持原有可观察连接阶段行为。向封闭 union 增加新类必须有消费语义；把码收进映射必须以全部 Client 能遵守同一含义为前提。Swift 与 Kotlin 投影仍是后续工作，必须镜像这一唯一来源。

## Consequences

词汇表拥有的唯一分类现在是赋予一个码 Client 侧含义的唯一位置；新增类或收录码成为可评审、受门禁约束的决定，而不是散落的代码编辑。未收录的码有意解析为 `unknown`，因此更新 Host 的词汇表退化为不透明诊断而不是错误分类。分类只承载呈现语义：Host 保持权威，类名不带来重试、权限或版本准入。

## Failure handling

`classifyRemoteFailure` 对非 Remote 值解析为 `unknown` 而不是抛出，catch 处的分类不会掩盖原始失败。清单门禁失败即关闭：未声明的已分类码使 doc-sync 叶子中止。

## Tests

`packages/typert/protocol/tests/failure-classes.spec.ts` 固定已分类码、词汇表内未分类码与未知未来码的不透明默认值、非 Remote 输入。`scripts/verify-remote-error-model.spec.ts` 为 `verifyRemoteFailureClassification` 增加接受与拒绝用例。`packages/api/gateway/tests/gateway.client.spec.ts`（133 项）在改接后原样通过。

## Rollout

从协议包根导出；消费者逐步接入。Gateway client 是第一个消费者；UI 文案接入是后续工作，须经由 locale 拥有的字典。

## Rollback

删除模块导出并恢复 Gateway client 的内联码清单；verifier 校验与其测试可独立删除。没有任何持久化数据引用分类。
