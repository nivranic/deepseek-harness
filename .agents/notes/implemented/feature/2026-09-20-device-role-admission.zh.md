# Agent Note: 设备角色经签名准入映射到第 15 节接缝

Status: implemented

[English](2026-09-20-device-role-admission.md) | 中文

- 日期：2026-09-20
- 类别：feature
- 范围：`packages/api/device-trust`、`packages/api/gateway`

## 问题

Phase 7 第一增量落地了设备信任接缝，角色为三个（`viewer`、`collaborator`、`admin`），授权无权限执行；第二增量使授权持久。剩两个缺口：规格第 21 节表格实际命名 Viewer/Collaborator/Controller/Owner 并带五个权限列（查看/发 Prompt/Question/Approval/Device Admin）；网关的交互回复权限仍由部署级开关（`interactionReplyPermissions`）执行——第 15 节文档自己声明该开关将由 Device Trust 角色替代。

## 决策

把角色词表精确对齐第 21 节表格，并通过 Remote 事件流打开时的一次签名准入实现按 client 的替代。

- `DeviceRole` 变为 `'viewer' | 'collaborator' | 'controller' | 'owner'`；新的 `src/permissions.ts` 导出 `DEVICE_ROLE_PERMISSIONS`，把每个角色恰好映射到表格的列——`view`、`prompt.send`、`question.respond`、`approval.respond`、`device.admin`。第一版不做算术 RBAC，符合规格"第一版不要做复杂 RBAC"。持久 zod schema 随之改变；预发布阶段，旧的 `admin` 存储记录使域 open 拒绝（权威数据）。
- `admitDevice`（`device.admit.v1`）经[nonce 准入规则](../bug-fix/2026-09-26-durable-unordered-device-admission.zh.md)验证授权、时间戳、签名与重放记录，返回身份、角色与权限。持久化提交重新检查当前撤销状态；在准入提交前排队的单个或全部撤销使准入以 `device/already-revoked` 失败。
- Remote 事件流以 `args.device` 携带签名准入，空 `args` 保留本地浏览器身份。Gateway 在等待准入前订阅撤销，注册前复查生命周期；活动流撤销后不再发送排队帧。该订阅随流或准入失败一起释放。未组合 device-trust 时，呈现身份以 `gateway/service-unavailable` 拒绝。设备回复的逐请求证明由[按请求设备准入](2026-09-21-per-request-device-admission.zh.md)规定。

## 考虑过的替代方案

- **网关 `static inject = ['deviceTrust']` 硬依赖**：把存储栈强制进每个网关组合及其 432 项测试，并且违背 §13 能力协商模型（未组合的服务即未广播的能力）。惰性解析保持接缝可选但大声。
- **准入票据 RPC 返回令牌再由流打开呈现**：为每次连接一次验证的粒度引入重放状态与第二个机密，没有收益。
- **保留三角色词表**：第 21 节表格就是规格；角色开始门控行为的时刻就是线上命名必须对齐的时刻。

## 后果

- 撤销覆盖准入等待、流注册及活动流。回复权限仍由流准入时的角色决定；签名检查、取消或撤销失败均发生在消费投递之前。
- 网关新增对 `@deepseek-ai/dsh-api-device-trust` 的类型依赖（peer+dev），经 `tsconfig.base.json` paths 解析；host 程序新增 device-trust 项目引用。
- 定向测试覆盖四角色权限、撤销提交队列、准入后注册窗口、撤销后的排队帧及设备回复生命周期；真实 Web 组合的录制 Question 验证错误身份不结算、原设备签名可完成交互。
