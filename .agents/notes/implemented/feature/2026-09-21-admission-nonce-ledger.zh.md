# Agent Note: 设备准入携带重放 nonce 账本

Status: implemented

[English](2026-09-21-admission-nonce-ledger.md) | 中文

- 日期：2026-09-21
- 类别：feature
- 范围：`packages/api/device-trust`、`packages/api/gateway`、`packages/typert/protocol`、`apps/android/contract`、`apps/apple/contract`

## 问题

签名设备准入只覆盖 `deviceId` 与 `timestamp`，被捕获的信封在 ±5 分钟接受窗口内重放仍会通过验证——规格的重放要求在配对码上已解决，但请求准入没有重放防御，第 21 节 traceability 行还挂着未完成的 nonce 账本条款。

## 决策

每个准入现在携带全新 `nonce`，签名消息为三段式 `deviceId + "\n" + timestamp + "\n" + nonce`。网关 wire 解析器在按请求信封与流打开 `args.device` 两条路径上都只接受四键 `{deviceId, timestamp, nonce, signature}` 形状。签名验证之后、授权记录新高水位之前，`admitDevice` 以新错误码 `device/replay-detected`（`reason: timestamp-regressed | nonce-reuse`，分类 `authentication`）拒绝重放：时间戳早于授权持久化的 `lastAdmittedAt`、nonce 已被本进程准入过、或恰好等于持久化的 `lastAdmittedAt`/`lastAdmittedNonce` 对。高水位对存于授权记录，因此重放防护跨 Host 重启生效；进程内每设备 nonce 账本在两倍接受窗口后过期——超过该视界，重放的准入本就过不了窗口检查。持久化更新在存储 transform 内重新校验单调性，两个并发的准入竞争不会双双落盘。

`admitDevice` 因持久化更新改为 `async`；网关两条调用路径都在既有错误折叠区内 await 它。

修复契约镜像时暴露并顺带修复了一个潜在缺陷：deviceRoleAdmission 增量刷新了苹果 schema 夹具（90 分支）但把 Swift 守卫留在 85，且两个原生镜像都没有任何 `device/*` 码——自那次推送起 Swift 自检可执行件在主线候选上一直在失败。两个镜像现在都以 authentication 分类携带 `device/admission-expired` 与 `device/replay-detected`，Kotlin schema 测试钉住 92 分支/91 已知码，Swift 守卫钉住同样数字，全部夹具重新生成（夹具复制必须排在 schema 重生成之后——先复制会落后一个码）。

## 备选方案

- 只持久化严格高水位、不用 nonce：同一毫秒内的两次合法准入会冲突，且重启后最新信封的精确重放仍会通过。
- 用 `<=` 拒绝不增长的时间戳：一毫秒内的两次合法准入会失败；等值时间戳隐含的精确重放已由 nonce 账本拒绝。
- 保持重放窗口敞开并如实记录：被捕获的签名有五分钟可重放期，第 21 节剩余清单明确将其列为不可接受。

## 后果

- 被捕获的准入在原始请求到达 Host 的那一刻起即失效；重启后只有比持久化高水位更新且 nonce 未见过的信封能通过验证。
- 设备时钟回拨会在墙钟追上最后接受的时间戳之前使准入失败——受窗口约束，任何单调方案的固有行为。
- 先于原始投递到达的重放仍会成功一次（按请求 nonce 账本在不引入传输排序的前提下无法关闭的窄竞争）；窗口约束该风险，本 note 如实记录。
- Swift 泳道验证由 CI 负责（macos-15 跑自检可执行件）；本机无法本地运行 Swift。
