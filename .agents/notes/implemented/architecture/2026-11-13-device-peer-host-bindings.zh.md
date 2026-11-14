# Agent Note: 设备 Peer 与显式 Host 绑定

Status: implemented

[English](2026-11-13-device-peer-host-bindings.md) | 中文

## 问题

原生设备角色在一个 Host 内授予操作权限。基于资源的 Remote Access 分别授权每个 Session、Workspace 与无身份的 `global` 资源。把设备当成本地 owner 会绕过资源校验，并掩盖持久用户消息的发起者。把设备角色当成 `global` grant 又会拒绝该角色原本可执行的资源寻址操作。

## 决策

签名验证成功后创建携带 DeviceId 的 `device` principal。即使设备角色名为 `owner`，它也与本地 owner principal 不同。未认证的 native 载体使用 `device-pairing` principal，唯一允许的操作是一次性配对兑换。每次签名一元请求和逻辑流各自拥有已准入 Peer 的生命周期。

Remote Access 保留 `host` 作为显式 binding 目标，其列出的 action 适用于所有合法资源；现有 `global` 与领域 binding 保持独立含义。Client 快照使用独立的 Host action 集合，删除它不会移除独立资源 grant。Host condition 收到实际请求的资源；只有其答案适用于所有资源时，才可在快照中声明 Host 级 grant。

设备 policy 根据活跃能力声明与当前存储角色推导端点 action。Bindings 收到服务访问 Context，以保留隔离 provider 的声明；还收到请求 action，以准入 Host 选择的通知而不将其加入端点快照。不从 Client 的能力声明推断授权。撤销会移除 grant 并终止已准入流；释放 listener 会等待其载体与 Peer 清理完成。

转发的问题和审批回复使用应用声明的答复权限。每次回复需要事件流所属设备的新签名准入，并在结算前再次检查权限。其他设备身份不能消耗该投递。官方的事件 id 与代际生命周期保持权威；设备载体不另建交互记录存储。

## 考虑过的替代方案

- 复用本地 owner 身份：拒绝，因为它绕过资源检查并丢失设备归属。
- 扩大 `global` 以覆盖领域资源：拒绝，因为现有 policy 依赖资源独立性。
- 在每个设备 grant 中枚举所有 Session 和 Workspace：拒绝，因为原有角色也覆盖新建资源，且不要求逐资源管理。

## 后果

TLS 测试覆盖按角色区分的通知与回复、跨设备冒答拒绝、独立设备身份、隔离 receiver、撤销与 listener 清理。Remote Access 测试覆盖 Host grant、非法资源拒绝、快照撤回与不变的 global 隔离。Native Client 组合与平台验收仍独立于这些 Host 测试。[Native 载体决策](2026-09-25-native-remote-connection-source.zh.md)负责 TLS 身份与部署限制；[Peer 与资源决策](2026-10-12-peer-principal-and-remote-access.zh.md)负责基础 Peer 模型。
