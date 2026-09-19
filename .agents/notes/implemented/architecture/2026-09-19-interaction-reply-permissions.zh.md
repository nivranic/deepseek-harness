# Agent Note：交互应答权限的 Host 侧强制执行

Status: implemented

[English](2026-09-19-interaction-reply-permissions.md) | 中文

## Problem

待决交互携带 `requiredPermission`（`approval.respond` / `question.respond`），但网关接受任何持有投递的 client 的应答。该字段只是线上描述数据而非强制边界：规格第 15/16 节要求 Host 拥有交互结算权，第 70 节要求工具在 Host 侧强制——Host 未授权的应答不得触发工具副作用。

## Current upstream boundary

官方网关按投递成员、协议版本与 revision 匹配结算转发交互应答。Remote 事件路径上没有权限模型；本地 Web 认证把每个已连接 client 视为可信。

## Decision

网关从已验证配置解析 `interactionReplyPermissions`（两类默认 `true`），在 Remote 事件流注册时为每个 client 生成 `replyPermissions` 集合。`receiveRemoteEventResult` 在消费投递之前用待决交互的 `requiredPermission` 校验该集合：未授权应答以 `gateway/permission-denied`（HTTP 403 详情）失败，投递保持存活、调用保持未结算、底层工具副作用不会发生；有资格的应答者之后仍可作答。

## Alternatives considered

RPC 载体上的按路由权限声明看不到交互类型；拒绝流打开会连只读 client 的诊断一并拒绝。在审批服务而非网关执行会漏掉投递移除后的迟到应答。

## Contract

强制执行是 Host 权威的，发生在 `removeRemoteEventDelivery` 之前；被拒应答可由有资格 client 重试且幂等安全。集合在 client 创建时按 client 固定；Device Trust 角色（Phase 7）将以按设备解析替代部署级开关，不触碰结算路径。

## Persistence

无。权限集合只存在于内存中的 Remote 事件 client；Session 存储、事件与 writer 版本 3 未触碰。

## Security

被拒应答除 code/endpoint 外不泄露交互内容。重放 revision 无法绕过：每次应答都重新求值权限。

## Compatibility

默认配置授予两类权限，行为不变（227 项网关测试原样通过）。两处 Config 等值测试现包含默认字段。

## Failure handling

权限缺失或移除按失败关闭解析：应答被拒，交互对有资格应答者或最终过期/取消保持开放。

## Testing

`gateway-stream.host.spec.ts` 新增 protocol-1 与 protocol-2 用例：审批应答被 `gateway/permission-denied` 拒绝且调用保持未结算（无 resolve、无 reject），同一 client 的问答应答正常结算——证明按类型执行与拒绝无副作用。

## Rollout

仅配置；默认保持行为。组合按部署需要回收权限。

## Rollback

删除配置字段与按 client 集合；结算路径回到投递+revision 校验。

## Consequences

`requiredPermission` 从线上装饰变为网关强制状态：未授权应答永远无法运行工具，且该 seam 明确了 Device Trust 角色的接入点。只读诊断不受影响，因为强制只作用于应答而非流打开。
