# Agent Note: 第 28 节名册的已保存 Host 本地重命名

Status: implemented

[English](2026-09-30-hosts-roster-rename.md) | 中文

## Problem

第 28 节的已保存 Host 名册只携带描述符身份事实，除「忘记」外没有任何本地编辑。描述符显示名相同的两行在设置区里无法区分，而用户自己对 Host 的称呼（「台式机」「工作笔记本」）无处安放；ui-settings-hosts README 把「除忘记外无名册编辑」列为延期工作。

## Decision

- `SavedHost` 增加可选 `customName`：客户端自选的显示覆盖。一个 `hostDisplayName(row)` 助手独占呈现优先级 `customName ?? displayName ?? hostId`，行标题与切换提示共用。
- `SavedHostsStore.rename(hostId, customName)` 原位设置或清除覆盖。顺序永不移动——近度是连接事实而非命名事实；不存在的 id 或无变化的重命名不改动、不通知；每次真实变化与 `record`/`remove` 完全一致地持久化并通知订阅者。`undefined` 让行回到描述符事实。
- `record()` 保证覆盖跨重连存活：描述符事实（`displayName`、`platform`、`origin`、`lastConnectedAt`）从新世代刷新，既有 `customName` 携带到刷新后的行上。
- `parseRow` 将 `customName` 校验为存在即字符串，重命名前的持久化行照常解析，损坏值随行一起丢弃，与其他字段的持久边界规则一致。
- `ConnectionHandle.renameSavedHost(hostId, customName)` 镜像 `forgetSavedHost`：纯名册接缝，无连接效应。主机区沿设备区的行内重命名模式——草稿从呈现名播种、空草稿行级警示拒绝、保存去首尾空白、回车保存——且仅当自定义名存在时出现「恢复原名」动作。
- 证明：单测覆盖 store 语义（原位设置/清除、无变化静默、重连保留、解析准入）、区呈现（空拒绝、提示名、重置接线、无自定义名时隐藏重置）、插件接线到持久化名册、外部重命名的订阅驱动重渲。`hosts-settings.e2e.ts` 扩展真浏览器车道：出厂设置区内空草稿被拒绝、`  Desk  ` 去空白后持久化进 `dsh-saved-hosts.v1`、重置回到重命名前的呈现名；golden 增加 Rename 行。

## Alternatives considered

- **手动行排序：** 与名册文档化的最近优先不变量冲突；继续延期。
- **空保存即清除覆盖：** 手滑会静默丢掉已选名称；拒绝空草稿与设备区先例一致，独立的重置动作让清除显式且可逆。
- **在 Host 侧改描述符名：** 描述符名属于 Host 部署，客户端覆盖无需 Host 往返，对当前不可达的书签同样有效。

## Consequences

- 已保存 Host 可本地命名；该选择跨重连、跨页面刷新、跨同一 Host 后续的描述符侧改名存活。
- cordis inspect 目录（`dsh-cordis-client-runner`）再生成并携带新方法契约；两个包的 README 更新，过期的「无名册编辑」限制条目被替换。

## Open work

- 覆盖存于浏览器 localStorage，按 profile 隔离；无跨设备或跨载体同步。
- 无手动排序；排序按设计保持最近优先。
