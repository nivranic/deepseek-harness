# Agent Note: 持久化 follow 窗口的后台载体断开与前台恢复（§25）

Status: implemented

[English](2026-10-03-android-follow-foreground.md) | 中文

## 问题

§25 持久化窗口已有逻辑中断、进程死亡与前台载体断开的安装态证据，但追踪台账仍带「前台与推送恢复」验收标签：没有任何证据证明**后台化**的进程会自行以持久化游标重开 follow、消费后台期间到达的记录、并在返回前台后完整呈现合并窗口。

## 决策

- 先做规格钉准：§25 原文只点名网络中断与游标续传；「前台/推送恢复」是台账标签。有约束力的规格句是 §80「断网、后台、Host restart 后可恢复」加 §25 游标语义与 §19/§67 的禁止偷发/禁止自动提交。推送观察的一次性前台重启属 push-foreground 车道（§64/§50），本道不重复声称。
- 新车道 `apps/web/tests/android-follow-window-foreground.e2e.ts` 沿 outage 骨架：配对、打开预置 Session、加载一页旧史、追加三条并让设备显示（持久截点前移）、`systemHome`、轮询后台态（`foregroundSnapshot`：CREATED、无焦点、外来窗口），随后**在后台**执行 `terminateDeviceConnections({ deviceId })`。
- follow 循环生命周期无关（viewModelScope、无前台钩子、1s 重试）：后台进程自行重开——车道钉 `requests[1].fromSeq == cursor + 3`，**后台期间**再追加三条（被重连的后台跟随者消费、游标无 UI 也推进），经普通启动器 `am start`（singleTask、无意图路由，经 driver 新增 `bringToFront()` 助手）回前台，断言合并窗口 `first..cursor+6` 连续（`attempts: 2`）、未发送草稿保留、零业务写、单设备授权。
- 如实保留边界：健康的后台往返按设计不产生新 follow 请求（流存活；按规格镜头两种结局均合法）；OS 后台回收行为（Doze、真机）与 FCM 投递未验收；重开快照形态不钉。

## 备选方案

- **不带载体销毁的纯 HOME→返回往返：** 否决为核心路径——follow 流在后台存活，不发生重开、观察不到游标声称；确定性的重开时刻需要后台中销毁载体。
- **经真实推送通知返回（`clickPushNotification`）：** 否决——通知路径需要制造真实审批推送且与 push-foreground 车道声称重度重叠；普通启动器返回行使同一任务前置而无任何意图副作用。
- **`deliverSharedText` 作 op 内回前台：** 否决——经 `onNewIntent` 路由分享意图，污染 `getIntent()` 与 UI。
- **把夹具降到 ~192 条以下：** 否决——Host 窗口界吞下整个 Session，`loadOlderHistory` 无旧史可载。

## 结果

- §25 前台恢复标签获得本地安装态证据：后台携持久化游标重开、后台消费、前台完整呈现、全程零业务写。
- driver 单请求预算 40s→90s（测试基建而非断言）：整窗断言按 Host ~192 条窗口界滚动、负载模拟器上实测 ~60s 而 server 侧仍完成；提高预算从根上消除丢响应重试风暴。两连绿锚定稳定性。
- `bringToFront()` 进入 driver 的受控可达性面板，供后续生命周期车道使用。

## 开放工作

- 各原生轨道的真机资格验收与 OS 后台回收行为；FCM 投递按设计保持未验收。
