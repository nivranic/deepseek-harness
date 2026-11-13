# Agent Note: 持久化 follow 窗口的后台载体断开与前台恢复（§25）

Status: implemented

[English](2026-10-03-android-follow-foreground.md) | 中文

## 问题

后台重连必须在不提交保留输入的情况下恢复观察，在没有可见窗口时消费实时记录，并在返回前台时呈现协调后的历史。

## 决策

- 恢复只观察：重连必须保留未发送输入，不发送业务修改。Host 当前 follow 接口提供完整有界 opening，原生日志负责重叠校验。
- 新车道 `apps/web/tests/android-follow-window-foreground.e2e.ts` 沿 outage 骨架：配对、打开预置 Session、加载一页旧史、追加三条并让设备显示（持久截点前移）、`systemHome`、轮询后台态（`foregroundSnapshot`：CREATED、无焦点、外来窗口），随后**在后台**执行 `terminateDeviceConnections({ deviceId })`。
- follow 循环属于 `viewModelScope`，独立于前台焦点。场景在后台销毁载体，验证以原请求字段重开，追加三条实时记录，再经启动器返回，检查完整保留窗口、未发送草稿和单设备授权。
- 如实保留边界：健康的后台往返按设计不产生新 follow 请求（流存活；按规格镜头两种结局均合法）；OS 后台回收行为（Doze、真机）与 FCM 投递未验收；重开快照形态不钉。

## 备选方案

- **不带载体销毁的纯 HOME→返回往返：**follow 流在后台存活，无法测试重开及新快照协调；确定性重开需要在后台销毁载体。
- **经真实推送通知返回（`clickPushNotification`）：** 否决——通知路径需要制造真实审批推送且与 push-foreground 车道声称重度重叠；普通启动器返回行使同一任务前置而无任何意图副作用。
- **`deliverSharedText` 作 op 内回前台：** 否决——经 `onNewIntent` 路由分享意图，污染 `getIntent()` 与 UI。
- **把夹具降到 ~192 条以下：** 否决——Host 窗口界吞下整个 Session，`loadOlderHistory` 无旧史可载。

## 结果

- 该场景定义后台重连与前台呈现验收。完整 opening 适配需要新的安装态运行，不代表推送投递或真机行为已验收。
- driver 单请求预算 40s→90s（测试基建而非断言）：整窗断言按 Host ~192 条窗口界滚动、负载模拟器上实测 ~60s 而 server 侧仍完成；提高预算从根上消除丢响应重试风暴。两连绿锚定稳定性。
- `bringToFront()` 进入 driver 的受控可达性面板，供后续生命周期车道使用。

## 开放工作

- 各原生轨道的真机资格验收与 OS 后台回收行为；FCM 投递按设计保持未验收。
