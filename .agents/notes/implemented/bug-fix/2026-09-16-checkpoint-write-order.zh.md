# Agent Note: 检查点捕获顺序包含日志持久化等待

Status: implemented

[English](2026-09-16-checkpoint-write-order.md) | 中文

## 问题

同一 Session 的两个检查点可能按不同于捕获顺序的先后完成日志 flush。等到 flush 结束才将记录入队，会让较旧的切面覆盖较新的持久化检查点。领域关闭也可能遗漏仍在队列外等待的工作。

## 决策

[`KvTable.put`](../../../../packages/storage/storage-domain/src/domain.ts)接受可选的异步前置操作。领域先保留写入位置，在该位置调用前置操作，成功后才持久化并发布。同步抛错或异步拒绝都跳过记录更新与 `domain/changed`；后续已接受的写入仍可继续。已关闭的领域拒绝新操作且不调用其前置操作。领域关闭会等待已接受的前置操作及其写入完成。

[`SessionProjectionCache.write`](../../../../packages/session/session-projection-cache/src/index.ts)先捕获投影及完整生命周期身份，再将日志 flush 与记录替换放入同一个队列位置。Session store 仍是唯一的 flush 分派者。已分离的 Session 使用现有持久化退休排空与冷读水位检查。投影 registry 已经返回脱离活状态的值，其复制行为保持不变。

[缓存兼容决策](../architecture/2026-09-02-projcache-cross-version-read-compat.zh.md)继续负责格式与继承身份检查，包括 `inheritedEventCount`。[Session 观察决策](../architecture/2026-08-25-session-observations-and-projection-owned-client-state.zh.md)继续负责精确读取与 Client 投影归属。两项决策均未被替代，此变更不增加 Session 事件或存储格式代。

## 考虑过的替代方案

**等待结束后才保留写入位置。** 这会按完成顺序写入，也让等待落在领域清理范围之外。

**在投影缓存中添加第二条队列。** 这重复了领域的串行化与关闭归属。同一领域的其他写入也不会共享该队列。

**传入已经运行的 promise。** 较早的队列位置或已关闭的领域可能让它的拒绝无人观察。在已接受的位置调用回调，可将开始、失败和清理归属保持在一起。

## 影响

前置操作不得等待同一领域的其他写入或关闭，因为这些操作会排在它后面。它表达持久化依赖，不是事务或回滚钩子。后端拥有介质生命周期，并在关闭单元之前排空已注册的领域 owner，具体由 [owner 清理决策](2026-09-16-storage-owner-teardown.zh.md)定义。

回归测试覆盖延迟的较旧 flush 覆盖最新持久化值、可变投影隔离、前置操作失败、队列继续及关闭排空。手工编写的 [Web Session 记录](../../../../snapshots/web/checkpoint-order/session.v3.jsonl)通过正式 Loader 组合执行标题变更，并比较持久化事件日志。这些检查不构成其他平台、已安装产物或真实模型 provider 的验收。
