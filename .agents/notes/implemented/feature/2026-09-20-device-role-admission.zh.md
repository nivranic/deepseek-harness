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
- `admitDevice`（`device.admit.v1`）验证一次签名准入：对 UTF-8 的 `deviceId + "\n" + timestamp` 做 base64 Ed25519，按代价从低到高检查——授权存在（`device/not-found`）、撤销（`device/already-revoked`）、时间戳窗口 `admissionWindowMs` 默认五分钟（`device/admission-expired`，归 `authentication` 类：重新签名后重试）、然后签名（`device/key-invalid`）。返回身份、角色与权限集。
- 网关的 Remote 事件流打开把准入接受为流的参数——`args: {}` 保持匿名，`args: { device: { deviceId, timestamp, signature } }` 标识设备。`device` 放在 `args` 内（而非 `apiProtocolVersion` 旁）保持了版本 2 信封契约：`decodeRemoteRequest` 只对恰好两键的形状剥离元数据。被准入 client 的 `replyPermissions` 改为其角色的权限集；回复时既有的第 15 节检查（`gateway/permission-denied`、不结算、不消费投递、不执行工具）无需改动。device-trust 服务经 `ctx.get` 惰性解析：未组合它的部署不广播设备能力，呈现身份时以 `gateway/service-unavailable` 大声失败而非静默降级为匿名默认。

## 考虑过的替代方案

- **网关 `static inject = ['deviceTrust']` 硬依赖**：把存储栈强制进每个网关组合及其 432 项测试，并且违背 §13 能力协商模型（未组合的服务即未广播的能力）。惰性解析保持接缝可选但大声。
- **准入票据 RPC 返回令牌再由流打开呈现**：为每次连接一次验证的粒度引入重放状态与第二个机密，没有收益。
- **保留三角色词表**：第 21 节表格就是规格；角色开始门控行为的时刻就是线上命名必须对齐的时刻。

## 后果

- 撤销在设备下次流打开时生效而非连接中途；按请求的业务 RPC 签名保持延期。接受窗口是重放卫生而非 nonce 账本——包 README 如实记录该限制。
- 网关新增对 `@deepseek-ai/dsh-api-device-trust` 的类型依赖（peer+dev），经 `tsconfig.base.json` paths 解析；host 程序新增 device-trust 项目引用。
- 测试：device-trust 18 项（每角色与每失败码的准入套件）、网关流 49 项（真实 WebSocket 传输上的四角色 × approval/question 矩阵、错误密钥、已撤销、字段畸形、服务缺失）——两包共 455 项。
