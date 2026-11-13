---
kind: upgrade-guide
description: 原生设备授权改用资源 policy 拒绝错误，并保留独立的 device principal。
---

# 原生设备授权

[English](guide.md) | 中文

## 变更

签名 native 请求使用设备 Peer 与显式 Host 级 Remote Access binding。名为 `owner` 的设备角色仍与本地 owner principal 不同。合法的资源寻址操作保留角色权限；非法资源身份在 lookup 之前被拒绝。

已认证设备调用未声明或未获授权的端点时，现收到携带 `{ action, reason }` 的 `remote-access/denied`。缺少签名身份仍返回 `gateway/permission-denied`。指向其他设备事件流的回复返回 `gateway/interactions-forbidden`；签名失败保留 Device Trust 错误码。访问快照可能包含 `{ kind: 'host' }` grant。

## 迁移

1. 在 native Client 错误处理里，将 `remote-access/denied` 归类为权限拒绝，保留原始 details。将 `gateway/interactions-forbidden` 视为回复被拒绝，不要自动重试。
2. 如果直接消费 `remoteAccess/follow`，将 `host` grant 的 action 应用于所有资源，并独立于 `global` 与单资源 grant 删除它。出厂 Client 访问服务已实现此更新。
3. 继续为每次请求与流发送新的签名准入。确认 Viewer 无法修改或答复交互，Collaborator 可回答问题，其他设备不能回复当前流的投递。

[设备 Peer 决策](../../../../.agents/notes/implemented/architecture/2026-11-13-device-peer-host-bindings.zh.md)说明身份与授权归属。配对码、角色名称和固定的 TLS 身份保持不变。
