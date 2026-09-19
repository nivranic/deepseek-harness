# Agent Note: Host 发现失败的终止状态

Status: implemented

[English](2026-09-17-terminal-host-discovery.md) | 中文

## 问题

无限重试不受支持的协议或无效发现信息，会把应用不兼容显示为暂时断线。业务调用需要明确失败，不能一直等待无法准入的 generation。

## 决策

[Gateway Client](../../../../packages/api/gateway/src/client/index.ts)分类 generation 失败：Host/Gateway 协议不受支持、发现阶段缺少必需能力归为 `incompatible`；发现信息无效、preparation owner 被撤回归为 `fatal`。分类适用于共享 generation 的建立，不适用于普通业务调用失败。

[Connection 控制器](../../../../packages/client/connection/src/client/connection.ts)在 source 结束后调用分类回调，复用现有重试等待暂停。显式重连或浏览器网络状态变化会解除等待。取消后迟到的失败不能覆盖已请求的重连或离线状态。未分类失败保留[持续恢复](2026-09-05-continuous-client-recovery.zh.md)；本决策缩小该记录的重试范围，保留其期限、清理要求与唯一调度器。

Settings 提供本地化修正提示和手动重连，收起轨道中也可见。发现和事件就绪重新成功前，Gateway 拒绝业务调用准入。本改动不增加 Session 事件、持久化修改队列、新传输或授权。

## 考虑过的替代方案

**在 Connection 内分类。** Connection 不应依赖下游 API 包拥有的 Host 发现错误码。其回调接收失败，仅返回生命周期分类。

**重试所有失败。** 重复同一请求不能使不受支持的协议或畸形发现信息可用；显式处理提供可操作状态，同时保留普通断线恢复。

## 后果

手动重试重新执行发现，不能绕过准入。网络变化可能重新检查同一失败。HTTP 认证拒绝遵循[浏览器认证决策](../architecture/2026-08-24-browser-token-authentication.zh.md)。Host 就绪延迟遵循[持续恢复决策](2026-09-05-continuous-client-recovery.zh.md)。设备撤销仍需独立完成；这两种状态不代表完整 Connection UX 或设备权限执行。

## 测试

Controller 测试覆盖无活动定时器的暂停、手动恢复，以及监听器中重入的停止、重连和离线操作。Gateway 测试证明分类失败在载体发送前拒绝一元和 stream 调用。组件测试覆盖收起轨道中的本地化说明。Question 录制场景通过 `dsh --profile web` 启动，注入不受支持或畸形的发现版本，验证不自动重试，通过可见操作恢复，并将完整持久化 Session 与工作区和未改变的 fixture 比较。
