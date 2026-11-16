# Agent Note: 真实 Host 重启使暂存上传回执失效，而持久身份与字节存续

状态：implemented

[English](2026-09-30-android-host-restart.md) | 中文

## 问题

[回执恢复决定](2026-09-28-android-attachment-receipt-recovery.zh.md)证明了在同一 Host 进程内销毁 Session 对象会使其上传回执失效，且其场景明确排除了 Host 重启。此前没有任何测试把"Host 进程突然死亡"与"已配对的 Android companion"组合起来：设备配对、Host 身份、已上传字节与暂存回执是否跨真实 SIGKILL 重启存续，是三项彼此独立的未验证断言。

## 决策

[已安装 host-restart 场景](../../../../apps/web/tests/android-host-restart.e2e.ts)在隔离的 `DSH_HOME` 内驱动真实 Host 子进程（`apps/cli --profile hostrestart`），经私有 fixture IPC 签发的配对码完成模拟器配对，暂存一次 SAF 文件上传并 flush 会话，以 SIGKILL 杀死 Host，在同一固定 native 端口上重启，并通过 adb reverse 摘除与重建让存活的 companion 重连。观察到的语义已成为固定断言：暂存上传回执是进程本地的（`FileUploads.stagedUploads` 为内存映射），旧回执被以 `session/attachment-invalid` / `FILE_NOT_STAGED` 拒绝，companion 走显式恢复路径——丢弃 pending 意图、移除失效附件、重新选择来源、获得新回执（内容寻址的 `attachmentId` 不变）并一次发送成功。持久状态跨重启不变：`hostId`、TLS `spkiFingerprint`、固定 native 端口、已配对设备授权与 `<DSH_HOME>/attachments/v1` 下的已上传文件字节全部逐项相等；重启后的 Host 重新通告 `native-remote.http-request-budget.v1`，重选上传在派发前重新查询该预算。

Host 侧 [fixture](../../../../apps/web/tests/android-host-restart.fixture.ts) 是需要可杀死 Host 的设备场景的可复用模式：它以实时 native-remote 与 host-description 事实上报 `ready`，并经请求 id 关联的 IPC 应答 `issuePairing`、`describe`、`createSession`、`observe` 与 `flush`，绝不暴露携带凭据的 web URL。[文件预算决定](2026-09-28-native-http-upload-budget.zh.md)继续持有预算机制；本场景为其证据增加重启轴，不新增预算规则。

## 已考虑的替代方案

**用 `setHostReachable(false)` 模拟 Host 死亡。** 摘除 adb reverse 只测试传输丢失；它不能丢失进程本地暂存状态，对重启语义没有任何证明力。

**复用进程内 web scaffold 并销毁 Agent。** 那是回执恢复场景的 Session 销毁轴；Host 进程死亡是另一个失败域，还会重置 Agent 作用域保留的进程本地状态。

**持久化暂存回执使其跨重启存续。** 持久化需要 Host 侧暂存存储与半写上传的协调定义；显式重选路径已恢复用户意图，且持久上传字节使重传内容寻址。没有需求要求回执跨 Host 重启。

## 结果

该场景单用例在三方独立运行（子代理 r3/r4、主会话 r5）中均 exit code 0；已安装 APK 对与图片预算增量一致（产品代码零改动；仅有的 tracked 变更是两个新测试文件及其两行 tsconfig 面注册，与 `host-restart.fixture.ts` 同模式）。durable 会话日志恰好记录一条用户来源消息（替换文本+文件附件）、一个 completed 回合与一次 mock 模型请求。三张截图（`reconnected-session`、`rejected-old-receipt`、`final-send`）与机器可读观察记录保存在 `.artifacts/android-host-restart-ui/`。全量 typecheck、oxlint 与 17 项文档快速检查 exit code 0。

以上结果验证被测模拟器、子进程 Host profile 与 TLS 路径。物理设备、iOS companion、上传或流进行中的 Host 重启、并发多设备重连与回执持久化设计仍为独立资格工作。[回执恢复决定](2026-09-28-android-attachment-receipt-recovery.zh.md)持有 Session 销毁轴；本说明持有 Host 重启轴。
