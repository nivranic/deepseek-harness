# Agent Note: 设备授权存于持久的 device_trust 存储域

Status: implemented

[English](2026-09-20-device-trust-durable-store.md) | 中文

## 问题

设备信任接缝的首个增量把授权存在进程内 `Map`：授权随 Host 进程消亡——重启会静默解绑所有设备并遗忘所有撤销——这对权威访问数据不可接受。

## 决策

授权现存于 `device_trust` 存储域（`packages/api/device-trust/src/spec.ts`）：`defineDomain` 声明以 `DeviceId` 为键的 `grants` 表，`single` 布局（授权集在每次仪式步骤整体重写），版本 1，非法记录采用默认拒绝策略——未通过 zod schema 的已存授权使整个 open 拒绝而不是跳过，因为静默丢失一条撤销是安全洞，不是缓存未命中。`DeviceTrustService` 注入 `storageDomain`，在 `[Service.init]` 打开域并以 `ctx.effect` 关闭，读取来自域内存表的同步状态，而写入（`put`、`update`）先落盘。待定配对码刻意保持进程内：一次性过期机密不得在重启后存活，仪式重启后重新签发即可。兑换只在持久 `put` 完成后才标记码值已消费，因此存储写入失败时码值保持可兑换；撤销以原子 `update` 执行，其变换在队列槽位上的记录已撤销时抛出 `device/already-revoked`，写链的 `missing-key` 映射为 `device/not-found`。

两个行为测试固定持久化契约：授权（含撤销状态）在同一 json 根上跨 Host 重启存活；待定码值不跨重启存活。

## 备选方案

- **非法记录 backup-and-skip。** 否决：该策略面向可弃的派生数据；授权是权威数据，不可读的授权必须让 open 大声失败而非消失。
- **把待定配对码也持久化。** 否决：超出签发者生命周期的一次性码值在重启间扩大机密暴露窗口，对操作者毫无价值。
- **SQLite 后端。** 推迟：出厂组合把所有域路由到 `<dshHome>/storages` 下的 json；授权集极小，按域路由（`routes`）以后可单独迁移而不动本包。

## 后果

Phase 7 的存储已持久：配对跨重启存活，撤销不会因崩溃被遗忘，失败排序保证存储失败不烧码值。服务现在要求组合 `storageDomain`（经 base 栈存在于每个 bundle）。Phase 7 剩余步骤不变：经第 15 节接缝的角色映射权限检查与请求签名准入。
