# Agent Note: 设备身份变更以确认而非重试收口

Status: implemented

[English](2026-09-21-device-identity-confirmation.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：`packages/api/device-trust`、`packages/api/gateway`、`packages/client/connection`、`packages/client/ui-settings-general`、`apps/android/core`、`apps/android/support`

## 问题

第 22 节丢失设备清单只落了一半（revoke one、fingerprint、pairedAt、role），revoke-all、rename、last seen、platform 与"撤销后立即断开该设备已有流"缺失；§18 的 `device-revoked` 连接态没有生产方分类器，在出厂组合中不可达；而身份不再被 Host 认可的客户端（re-key 或 Host 重置——§22 的设备 re-key 路径）对着不透明失败无限重试、没有重配对指引——即记录链一直挂着的"变更身份确认"事项。

## 决策

第 22 节在 Host 侧补全：`revokeAllDevices`（device.revoke-all.v1）撤销全部活跃授权并返回共享时间与数量；`renameDevice`（device.rename.v1）只改显示名，不动身份、密钥、角色；列表暴露由准入派生的 `lastSeenAt` 与客户端声明的 `platform`（兑换请求携带——Android 发送 `android`，夹具接受）。撤销现在自我播报：device-trust 派发类型化事件 `deviceTrust/grantsRevoked`，网关为每个已准入 Remote 事件流 client 记录 `deviceId`，事件到达即终止对应流——流测试以撤销后出现的 wire `end` 帧断言（优雅的流结束不会关闭 mux socket；该帧即观测点）。

身份变更在连接面确认：网关 client 的 `classifyFailure` 把 `device/already-revoked` 映射为 `device-revoked`（顺带修复该状态缺失的生产方），把 `device/not-found`/`device/key-invalid` 映射为新的 `identity-changed` 状态；两者都暂停重试并以 locale 键呈现重配对指引。`device/replay-detected` 刻意保持自动重试：针对我们自家全新信封的重放判定是噪声而非身份判定。码比较用普通字符串匹配，因为 client face 不链接 device-trust 的 details-map 声明——词表按 wire 可合并扩展。

## 备选方案

- 身份丢失复用 `device-revoked`：语义错误——没有任何东西被撤销；指引（"已撤销" vs "请重新配对"）不同。
- 用每流 abort 信号做撤销断连：queue-end 路径本就终止生成器；把事件路由到 `removeRemoteEventClient` 复用唯一的生命周期所有者。
- 用设备侧 re-key 仪式替代重新配对：规格自己的答案是"安全存储清空后重新配对"；陈旧授权留在列表里（带 last-seen 与 platform）供操作者撤销对账。

## 后果

- 丢失设备的流在撤销时刻终止，不等下一次准入；revoke-all 是恐慌路径。
- `revokeAllDevices` 跳过已撤销授权（保留原时间），只为本次撤销的身份派发事件。
- identity-changed 分类在 wire 边界信任这三个 device 码；其余 `device/*` 判定仍走 `classifyRemoteFailure` 的 authentication 类（自动重试）。
- rename/revoke-all 的管理 UI 归 §7-§11 产品线；Remote 面即是当前的操作者 API。
