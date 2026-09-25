# Agent Note: 按请求设备准入以能力声明权限门控业务 RPC

Status: implemented

[English](2026-09-21-per-request-device-admission.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：`packages/typert/protocol`、`packages/api/gateway`、`packages/api/device-trust`、`packages/api/host-description`

## 问题

Phase 7 此前只在 Remote 事件流打开时准入设备：设备角色只门控交互回复，业务 RPC 没有按请求身份，第 21 节 remaining 清单把远端执行授权列为未完成。裁定授权面——哪种权限管辖哪些端点——是阻塞本增量的 plan-open 决策。

## 决策

把分类放在能力层、分发到每个 Remote 服务，由网关按请求执行。

- `TypertRemoteCapability` 新增可选 `requiredPermission: RemoteCapabilityPermission`（view/prompt.send/question.respond/approval.respond/device.admin——第 21 节表格列，现为 typert-protocol 词汇，协议层不引入 device-trust 依赖）。
- 版本化信封在 `args` 旁携带 `{deviceId, timestamp, nonce, signature}`，签名与重放规则由[nonce 准入](2026-09-21-admission-nonce-ledger.zh.md)统一规定；设备使用当前请求编解码。
- 网关经 `ctx.deviceTrust` 验证（同一 cheapest-first 阶梯）并解析端点的所属能力：角色缺少已声明权限、或能力未声明，均在派发前以 `gateway/permission-denied`（`details.role` + `details.required` / `reason: 'undeclared'`）拒绝。匿名浏览器业务请求不走设备准入；`$events` 持有流身份，`$events/result` 必须证明该身份后再执行第 15 节的投递、版本、revision 与权限检查。
- 首批声明：device-trust 的 issue/list/revoke 声明 `device.admin`（redeem 与 admit 保持未声明——它们先于任何设备身份）；host 的 describe/negotiate 声明 `view`（每个角色都持有，与诊断层只读姿态一致）。业务服务在各自增量中采纳声明；在此之前设备对其 fail-closed——这是刻意的安全姿态而非疏漏。

## 考虑过的替代方案

- 网关内集中的端点→权限表：把所有服务的授权面耦合进一个包且易漂移；能力声明让所有权留在操作归属处。
- 未声明能力对设备默认 `view`：对沉默 fail-open；fail-closed 使每个服务的声明成为显式授权行为。
- 复用流准入做 RPC 身份（套接字作用域状态）：mux 连接今天跨逻辑请求无状态，且按请求签名无需服务端会话。

## 后果

- `gateway/permission-denied` 的 details 扩为联合（HTTP 故障 | 带 role+required/undeclared 的设备拒绝）；错误信封 schema 重新生成。
- 设备交互回复每次重新签名；缺失证明、不同设备或对匿名流附加设备身份以 `gateway/permission-denied`（`reason: device-identity`）拒绝。错误签名不消费投递，校验期间取消或撤销阻止结算。
- 测试：网关 446 项，含八项按请求准入用例（角色持有准入、角色拒绝、owner 调 admin 能力、未声明拒绝、字段畸形、服务缺失、过期时间戳、匿名不变）及保留信封键的编解码测试。
