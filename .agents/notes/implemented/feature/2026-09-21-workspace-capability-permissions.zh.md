# Agent Note: Workspace 能力声明其设备权限

Status: implemented

[English](2026-09-21-workspace-capability-permissions.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：`packages/api/workspace-controller`

## 问题

session-controller 采纳后其余业务归属方对设备仍 fail-closed；workspace-controller 是下一个指定采纳方。

## 决策

按端点语义声明全部 workspace-controller 能力——每个集合本就同质，无需拆分。`workspace.follow.v1` 要求 `view`；`workspace.manage.v1`（create、rename、delete、insertBefore）与 `workspace.sessions.v1`（archiveSession、insertSessionBefore）要求 `prompt.send`，沿用 session 先例：工作区生命周期写入属会话参与。目录选择器对 `directory-picker.native.v1`（pick）与 `directory-picker.browse.v1`（list）声明 `view`，对 `directory-picker.create.v1`（createDirectory）——其唯一文件系统写——声明 `prompt.send`。缺少已声明权限的设备角色在派发前被拒绝；匿名调用不受影响。

按 session 清单的全仓锁面 grep 未发现整集 pin：host-preparation 准入映射、浏览器 fixture 列表与 e2e 过滤器引用的是同一批同质 id、不变；仅包内两处能力 deep-equal pin 增加了 `requiredPermission` 字段。

## 考虑过的替代方案

- 专门的 workspace-admin 权限类别：第 21 节表格五列中没有工作区管理；collaborator 及以上的会话参与是诚实的映射。
- 原生选择器因"只是选择"而给 `view`：pick 返回路径选择但不改变任何东西；`createDirectory` 是选择器唯一写操作、取 `prompt.send`。

## 后果

- viewer 设备可跟随工作区状态；collaborator 及以上管理注册表、会话顺序与选择器建目录。
- `transport.client.spec.ts` 中预先存在的 Windows 环境失败（耗尽载体重试）经干净树验证，不在本增量范围。
