# Agent Note: 远程宿主设置与 link 管理面（Phase 1 宿主侧）

Status: implemented

[English](2026-08-30-remote-host-settings-and-admin-surface.md) | 中文

## Problem

原生化方案（E:\11585 方案，第 27–28、42–43 章）的 Phase 1 要求 Windows 宿主把跨设备访问作为产品设置暴露——启用跨设备访问、允许远程审批、设备名——并提供建配对与受信设备管理的本地管理面。PoC-2 之后，载体的 `enabled` 与 `allowRemoteApproval` 只是加载时的插件配置，宿主名硬编码为 `os.hostname()`，载体在构造函数里绑定一次便再无重启能力，也没有任何 Remote 命名空间能把这些事实送到客户端设置页。方案还钉死了信任规则：知道交互 id 绝不等于有权回答，且本地管理端点不得经远程载体本身触达。

## Decision

`ctx.linkAccess` 获得运行时控制：串行化的启用/停用队列（快速连按不会双绑定，已启用再启用、已停用再停用都是 no-op）、供状态面读取的绑定失败记录、实时的 `setAllowRemoteApproval`/`setDeviceName` 开关，以及永不抛出的 `carrierStatus()` 读取——观察者 promise 吞掉飞行中的绑定拒绝并通过 `bindError` 报告。两个新包补齐管理面。`dsh-link-settings`（`ctx.linkSettings`）注册 `remote` 设置命名空间——`enabled`、`allowRemoteApproval`、`deviceName`，默认全关/用操作系统主机名——并把每次提交推入载体，先名称与审批、后监听器，使新启用的载体通告已提交的身份；绑定失败被包含（命名空间保留用户意图），销毁桥接会注销命名空间使后续提交响亮失败。`dsh-api-link-controller`（`ctx.linkController`）支撑生成的 `ctx.remote.link` 命名空间：`status`（监听状态、端点、SPKI 指纹、绑定诊断、名称、审批开关、设备数）、`createPairing`（二维码载荷，停止或绑定失败的载体映射为 `link-disabled`）、`devices` 与 `revokeDevice`（设备行永不携带公钥；载体按调用惰性读取，因此控制器可以先于远程访问存在挂载）。该命名空间已挂入 `dsh-api-remotes` 供所有客户端使用；分发保持本地，因为远程 Allowlist 不收录任何 `link` 端点。

## Consequences

Phase 1 设置页的宿主侧已可端到端调用：翻转命名空间即翻转真实 TLS 监听器，端口冲突体现在 `status` 而不是卡死开关。测试：载体 35 项（重启/重绑定、串行切换、构造期绑定被排队停用追上的竞态、绑定失败恢复、失败帧及其中止跳过、线上实时名称/审批）并恢复逐文件 100% 覆盖——这次审计还发现并补齐了流失败路径与网络接口展平处六个此前就存在的未覆盖点；桥接 5 项、控制器 7 项，均逐文件 100%。客户端设置行、二维码对话框与设备管理器是基于 `ctx.remote.link` 与 `remote` 命名空间的下一个增量；桌面 bundle 挂载与组合 e2e 随该 UI 一起落地，使花名册承载一个完整特性。角色编辑与待配对取消列表在有 UX 需要之前不做。

## Alternatives considered

link-access 本可以直接注入 settings 服务并自持命名空间；这会把载体插件与产品设置的 UX 决策耦合，并让无头部署加载永远不读的设置机制。桥接也可以在每次切换时经 loader 整体重启插件；串行化的运行时队列以同样的效果完成工作，且没有会在配对中途丢掉状态的卸载/重挂窗口。按方法族拆分多个设备管理 Remote 命名空间的方案被否——单一 `link` 命名空间加仅本地可达，把授权故事收敛为一次 Allowlist 检查。
