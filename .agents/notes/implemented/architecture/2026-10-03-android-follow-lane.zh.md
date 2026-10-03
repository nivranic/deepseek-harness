# Agent Note: 持久化 follow 窗口的安装态进程死亡车道（§25）

Status: implemented

[English](2026-10-03-android-follow-lane.md) | 中文

## 问题

§25 持久化窗口此前只有 core 级证据（NativeJournalPersistenceTest 中共享 store 的两个 SessionModel 实例），已安装应用从未证明它：真实 Host 上、会话新增记录与其重开之间的真实 force-stop 是开放的安装态项。

## 决策

- 新车道 `apps/web/tests/android-follow-window-persistence.e2e.ts`（cursor-resume 骨架）：配对、打开种子 Session、加载一页旧史、在 follow 流仍打开时追加三条记录（Host 的已发布窗口仅在跟随者在场时推进——kill 后再追加对重开快照不可见）、force-stop（`driver.kill()`）、同安装态重启、`assertRestored`、重开。
- 网关侧 spy 钉契约事实：首请求无游标；重开请求携带持久化的最后保留序号；Host 续传快照省略已覆盖尾部、恰返三条新增记录（`first == cursor + 1`）；app 合并窗口连续保留较早页面（全范围 `assertSessionWindow`，`attempts: 1`——重启进程只计自己的 follow）。
- 窗口断言采用一次车道侧重试：恢复进程的列表从顶部起，首次全窗口滚动可能超过 driver 的单请求计时器而操作仍在 server 侧完成；重试观察已就位的列表。两次连绿锚定稳定性。
- 断言未发送输入、单设备授权与零业务写请求；截图落 `.artifacts/screenshots/android-follow-window/`。

## 备选方案

- **先把 `persistJournalWindow` 移出主 dispatcher：**经评估并否认为挂起修复——每进程仅两三次有界写（数百毫秒级）且网关未观察到重连风暴，主线程文件 IO 无法解释四十秒的 compose 时钟冻结；同步的 save-before-load 顺序被 core 测试钉死。滚动边界重试针对实际观察到的机制。
- **kill 后再追加：**Host 从已发布窗口服务重开快照，而该窗口仅在跟随者在场时推进——规格的中断形态（中断期间新增、自最后应用序号重开）要求追加先于 kill。
- **钉死续传快照超出契约的形态：**Host 可合法回退完整窗口；车道只钉 §25 保证的（续传游标、覆盖时省略尾部、合并连续性）。

## 结果

- §25 持久化窗口项获得真实 Host 上的安装态证据；物理断网与前台/推送恢复仍开放，真机资格同样开放。
- 一次重试的窗口断言如实记录恢复进程的滚动成本，而非藏进基础设施超时。

## 开放工作

- §25 的物理断网与前台/推送恢复验收；各原生轨道的真机资格。
