# Agent Note: Session 能力按端点语义声明设备权限并拆分读写集合

Status: implemented

[English](2026-09-21-session-capability-permissions.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：`packages/api/session-controller`、`packages/api/gateway`（测试证据）

## 问题

按请求设备准入增量落地了能力 `requiredPermission` 词汇，首批声明只在 device-trust 与 host-description；业务 RPC 对设备在每个 session 能力上仍 fail-closed。第 21 节采纳队列把 session-controller 列为首个业务归属方。

## 决策

按端点语义声明全部 session-controller 能力，拆分两个混合集合使只读与变更权限可分开声明：

- 只读集合要求 `view`：`session.follow.v1`（跟随、分页）、新的 `session.list.v1`（列举）、`session.search.v1`、新的 `model.catalog.v1`（modelCatalog）、`file-reference.list.v1`、`skill.catalog.v1`。
- 会话变更集合要求 `prompt.send`：`session.control.v1`（控制、prompt、队列更新、取消）、`session.cancel-turn.v1`、`session.rename-at.v1`、`session.manage.v1`（现在仅 create、rename、fork）、`session.attachment.v1`、`model.select.v1`（仅 selectModel）。

拆分改变广播的能力集合：`session.manage.v1` 移出 `list`，`model.select.v1` 移出 `modelCatalog`。既有 UI 消费方本就把 `session.manage.v1` 读作"可建会话"，拆分是收窄而非破坏其语义；能力准入测试映射、host-description e2e 期望与浏览器 fixture 列表同步携带两个新 id。网关门控证据在既有 `device.admin`/`view` 用例旁新增一个 `prompt.send` 用例（viewer 拒绝、collaborator 准入）。

## 考虑过的替代方案

- 混合集合粗粒度 `prompt.send`：会剥夺 viewer 第 21 节"查看"权利（列举会话、读取模型目录）。
- 第三种"元数据"权限类别：第 21 节表格恰好五列；rename-at 与 manage 属 `prompt.send` 的会话参与。

## 后果

- 持有 `view` 的设备（所有角色）可跟随、列举、搜索、读目录；`prompt.send`（collaborator 及以上）门控全部会话变更——与第 21 节矩阵一致。
- Host 多广播两个能力 id；能力准入与发现期望同步更新。
- 一个预先存在的 Windows 环境失败（media-references symlink 测试）与本增量无关，不在其套件范围内。
