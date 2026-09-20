# Agent Note: device-revoked 连接状态补齐第 18 节状态清单

Status: implemented

[English](2026-09-20-device-revoked-connection-state.md) | 中文

- 日期：2026-09-20
- 类别：feature
- 范围：`packages/client/connection`、`packages/client/ui-settings-general`

## 问题

第 18 节要求 Connection 至少区分十个状态——connecting、authenticating、ready、offline、reconnecting、host-not-ready、auth-expired、device-revoked、incompatible、fatal——每种提供对应 UX。九个已实现；`device-revoked` 缺失，因为当时不存在可撤销的设备授权生命周期。Phase 7 签名准入增量改变了这一点：授权被 Host 撤销的设备现在在流打开时收到 `device/already-revoked`，且规格自身的 remaining 清单把设备撤销状态列为未完成。

## 决策

把 `device-revoked` 加为第三种终态分类。`ConnectionSinks.classifyFailure` 现在可与 `incompatible`、`fatal` 并列返回它：blocked 路径撤回就绪状态、暂停自动重试直到手动重连或浏览器网络变化，设置界面经新 locale 键 `connection.deviceRevoked` / `connection.deviceRevokedAction`（重新配对指引）呈现，连接指示器经既有 blocked 标志显示断开。分类器仍归 Gateway 所有：设备感知的 generation source 对准入拒绝分类；Connection 只拥有调度与状态。

## 考虑过的替代方案

- 把撤销映射到 `auth-expired`：被撤销的设备无法通过重新认证恢复——必须经操作者仪式重新配对——UX 文案与恢复预期都不同，状态值得独立命名。
- 为 device-revoked 增加重配对后自动重试策略：Host 无法通知被撤销的设备已完成重新配对；仪式后手动重连是诚实的边界。

## 后果

- 该状态今天只能经分类器接缝到达（测试注入）；浏览器 generation source 要在设备客户端采用 `args.device` 流打开形式后才自然把 `device/already-revoked` 映射到这里。
- 第 18 节十个状态现均有双语言的 locale-owned UX 文案；该节剩余工作是完整多版本/多语言矩阵、闭合错误语义与变更身份确认。
