# Agent Note: 后端清理排空单元 owner

Status: implemented

[English](2026-09-16-storage-owner-teardown.md) | 中文

## 问题

领域可能持有尚未进入后端单元的已接受写入，包括正在等待 Session 日志持久化的检查点。只关闭单元会遗漏这些工作。仍在加载记录的领域也可能在设施开始关闭后返回句柄。

## 决策

[`KvFacet.open`](../../../../packages/storage/storage/src/backend.ts) 接受可选的 owner 清理回调。后端关闭等待进行中的打开操作，在关闭每个单元之前排空其已注册的 owner，最后释放介质。独立关闭单元会撤销其回调。回调停止新工作并排空已接受的工作；可以关闭自身单元，但不得等待后端关闭，因为后端正在等待回调。

JSON 与 SQLite 使用共享的 [`closeOwnedKvUnits`](../../../../packages/storage/storage/src/close-units.ts) 辅助函数。即使 owner 失败，也会尝试关闭其单元。所有独立 owner 结束后才释放介质，`AggregateError` 按注册顺序保留 owner、单元和介质的失败。并发或重复的后端关闭共享同一个清理结果。

[`DomainFacility`](../../../../packages/storage/storage-domain/src/index.ts) 在打开单元时注册 owner 回调。其终结性的 `closeAll()` 停止新的打开操作，并等待活跃领域与进行中的初始化。有效的初始化若被关闭操作打断，会以 `closed` 拒绝并释放单元，不发布句柄。初始化失败仍由打开调用方观察；并发关闭调用方也会收到初始化清理失败。即使清理拒绝，设施仍会执行卸载。

## 考虑过的替代方案

**只排空后端写入。** 后端无法观察领域队列中等待的前置操作，因此只排空后端无法保留全部已接受的工作。

**依赖插件清理顺序。** 插件清理之外仍可直接调用后端关闭。调整插件顺序无法约束这个公共操作的义务。

**添加另一套生命周期 registry。** 后端已经跟踪每个活跃单元。将 owner 回调与其单元保存在一起即可提供注册与撤销，无需第二个 registry 或 RPC。

## 影响

[检查点顺序决策](2026-09-16-checkpoint-write-order.zh.md)继续有效：每个检查点必须先保留领域队列位置，再等待日志持久化。后端清理将该排空责任延伸到介质释放。[缓存兼容性决策](../architecture/2026-09-02-projcache-cross-version-read-compat.zh.md)仍拥有记录版本与血缘语义；两项决策均未被替代，本次改动不新增 Session 事件或存储代际。

JSON/SQLite 共享一致性测试检查 owner 工作持久化、回调撤销、重复关闭和多项清理失败。领域测试检查初始化竞争与全部 owner 的排空。手工编写的 [Web Session 记录](../../../../snapshots/web/checkpoint-order/session.v3.jsonl)通过 Web Loader 在检查点等待期间关闭后端，并核对持久化缓存与 Session 日志。这些检查不构成已安装 Desktop 产物、真实模型 provider 或其他平台的验收。
