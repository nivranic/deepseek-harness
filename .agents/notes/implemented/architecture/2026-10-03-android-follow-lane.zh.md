# Agent Note: 持久化 follow 窗口的安装态进程死亡车道（§25）

Status: implemented

[English](2026-10-03-android-follow-lane.md) | 中文

## 问题

§25 持久化窗口此前只有 core 级证据（NativeJournalPersistenceTest 中共享 store 的两个 SessionModel 实例），已安装应用从未证明它：真实 Host 上、会话新增记录与其重开之间的真实 force-stop 是开放的安装态项。

## 决策

- `apps/web/tests/android-follow-window-persistence.e2e.ts` 依次配对、打开预置 Session、加载较早页面、强停应用，在停止期间追加三条记录，再重启同一安装实例并重开会话。
- 初始和重启后的 follow 请求使用相同地址与分页上限。完整 opening 包含新增记录及与持久化历史重叠的部分；应用必须无缺口、无重复地显示保留的较早页面。
- 窗口断言采用一次车道侧重试：恢复进程的列表从顶部起，首次全窗口滚动可能超过 driver 的单请求计时器而操作仍在 server 侧完成；重试观察已就位的列表。稳定性证据必须来自针对当前 opening 协议的运行。
- 断言未发送输入、单设备授权与零业务写请求；截图落 `.artifacts/screenshots/android-follow-window/`。

## 备选方案

- **先把 `persistJournalWindow` 移出主 dispatcher：**经评估并否认为挂起修复——每进程仅两三次有界写（数百毫秒级）且网关未观察到重连风暴，主线程文件 IO 无法解释四十秒的 compose 时钟冻结；同步的 save-before-load 顺序被 core 测试钉死。滚动边界重试针对实际观察到的机制。
- **仅在 kill 前追加：**这无法确认完整 opening 能读到旧跟随者不存在期间的变更。进程死亡后追加可检查 Host 的独立快照读取。
- **把所有记录计为消息：**消息上限不包含元数据记录。场景检查新增记录、重叠序号覆盖与合并连续性。

## 结果

- 该场景定义持久化窗口恢复的安装态验收。完整 opening 适配需要重新进行安装态运行；物理断网与真机验收仍为独立事项。
- 一次重试的窗口断言如实记录恢复进程的滚动成本，而非藏进基础设施超时。

## 开放工作

- §25 的物理断网与前台/推送恢复验收；各原生轨道的真机资格。
