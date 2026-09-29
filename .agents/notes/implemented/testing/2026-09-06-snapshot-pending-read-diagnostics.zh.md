# Agent Note: 保留未完成快照读取的诊断上下文

Status: implemented

[English](2026-09-06-snapshot-pending-read-diagnostics.md) | 中文

## Problem

异步持久化检查可能在截止时间到达时仍在读取。Vitest 此时没有 callback 失败可报告，只能给出通用超时。诊断会丢失会话和目标记录，因而无法区分缺少 turn 后事件与同一场景中的其他等待。

## Decision

[快照轮询适配器](../../../../packages/test-support/session-snapshot/src/wait-for-snapshot-check.ts) 记录断言是否曾拒绝。如果等待器失败时尚无断言拒绝，适配器报告场景自己的超时消息，并保留原失败作为 cause。已经观察到的断言失败保持原样传播，包括文本恰好与 Vitest 超时消息相同的失败。分类依据断言的实际结果，而非文本匹配。

[场景 harness](../../../../packages/test-support/session-snapshot/src/harness.ts) 的全部异步持久化等待都提供原有诊断。轮询间隔、截止时间、判断条件和格式错误 turn 的处理语义保持不变。较晚完成的读取不能将已拒绝场景转为成功；等待器不会取消底层文件系统操作。

## Alternatives considered

- 增加短测试超时仍可能在更慢的 I/O 下遇到首次读取竞态。
- 让断言接受通用超时会丢失具体失败步骤的证据。
- 仅按消息替换所有错误会隐藏已观察到的读取和解析失败；调用方仍应获得其原始值。

## Consequences

受控的 pending promise 可独立于磁盘速度复现未命名超时。测试还覆盖重试成功、较晚完成以及原样传播已观察到的失败。完整 harness 套件覆盖真实子进程路径和持久化记录。[ACP 快照决策](2026-06-19-acp-snapshot-tests.zh.md) 继续负责 replay 推导与 fixture 保真；该适配器只改变失败诊断。
