# Agent Note: 观察持久化完成并为真实 Worker 往返保留时间

Status: implemented

[English](2026-09-06-ci-async-observations.md) | 中文

## Problem

正确的文件写入仍在执行时，短轮询期限可能已经结束。Worker 取消测试也可能在 Runtime 启用阶段就超时，尚未到达其本应验证的永不结算求值。完整 Workspace 类型分析还包含冷启动编译器与模块加载，需要采用同类 analyzer 测试的执行预算。

## Decision

[强制投影检查点测试](../../../../packages/session/session-projection-cache/tests/cache.spec.ts) 在读取存储之前等待实际创建和 turn-end 写入的 Promise。它断言写入次数，保留真实持久化实现，并在完成后检查已存储事件水位和数值。

[Inspector 期限测试](../../../../packages/experimental/inspector/tests/integration.host.spec.ts) 为真实跨线程往返保留一秒，要求 Runtime 启用成功，并验证永不结算的求值确实在期限前启动。后续求值证明同一 Client 仍可使用。产品默认超时时间保持不变。

[工具目录往返测试](../../../../packages/typert/generator/tests/tools-catalog.spec.ts) 采用与现有 Workspace analyzer 测试一致的六十秒预算。它仍分析完整 Host 程序，并通过 runtime registry 比较生成的服务、事件和类型记录。

## Alternatives considered

- 固定 sleep 既不能建立写入完成证据，也不能指出哪项异步操作失败。
- 重试失败断言可能掩盖丢失的写入，或根本没有到达 Client 的求值。
- 缩减 Workspace 输入，或用 mock 替代持久化和 Worker 通信，会移除这些集成用例负责的行为。

## Consequences

持久化失败会使被观察的写入拒绝，而不会表现为无关的轮询超时。Runtime 启用失败在启用处报告，期限拒绝用例约需一秒。Windows 与 Linux 必须运行相同的真实依赖；宿主沙箱失败与测试结果分别记录。
