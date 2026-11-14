# Agent Note: Android 进程重启后的持久化 follow 窗口（§25）

Status: implemented

[English](2026-10-02-android-follow-window-persistence.md) | 中文

## 问题

内存 follow 窗口会随进程结束而丢失。保留完整的有界窗口，让重启进程能把新的 Host 快照与较早加载的历史协调；单独游标无法重建视图。

## 决策

- 新 core 持久缝 `NativeJournalStore.kt`：`NativeJournalWindow`（sessionId、address、cut、hasMore、records）、`NativeJournalStoring`（load/save）与 `FileNativeJournalStore`——每 principal 一份加密 v1 文档（`<sha256>.journal`，沿用 `FileCompanionInputStore` 布局）、精确字段集、同目录原子替换、读写双界。
- 窗口是 Host 可重建的缓存而非用户输入：`load()` 把不可读字节（残缺文档、cipher 认证失败）隔离为 `.unavailable-<uuid>` 后按缺席读取——文档化的恢复路径是冷开，绝不崩溃也绝不静默替换。
- `save()` 超出字节上限时从最旧侧丢弃记录并强制 `hasMore=true`；截点与最新记录永不丢弃。单条记录超限则 fail-loud。
- live 事件可越过快照截点（内存中的常态），持久契约据此允许 `last >= cut` 并做连续性校验；空窗口携带空截点 `-1`。
- `NativeSessionJournal` 增加两个缝：`installPersisted`（为刚 reset 的所有者在校验后装入窗口，此后由既有续传合并治理下一快照）与 `checkpoint`（当前窗口的一份持久拷贝）。
- `SessionModel` 接线：每次 follow 打开时加载并仅在 session 与 address 双匹配时播种（子代理地址绝不播种）；替换性发布时持久化（完整窗口时刻）；两条关闭路径都持久化含越截点 live 事件的最终窗口。无 store 的全新模型仍冷开。
- `CompanionRuntime.followJournal` 按恢复安装构造一份 `FileNativeJournalStore`（`native-journal/`、`AndroidKeystoreCipher("dsh-native-journal")`、1 MiB，沿用 uploadDigests 先例）；两处 `CompanionModelSet` 构造点均传入。

## 备选方案

- **只持久化续传游标：**记录让重启合并走上既有内存路径（`beginFollow` → `mergeSnapshot` 保留一致前缀）；只存游标需要第二条分裂的合并规则。
- **每次 live 事件都持久化：**每事件全文档重写可达内存上限；替换性发布加关闭路径已覆盖合并可续传的每个状态——末次检查点之后的追加经普通快照重取即可。
- **不可读 store 视为致命：**草稿是用户输入须 fail-loud；窗口可从 Host 重取，隔离加冷开才是诚实的恢复。

## 结果

- 同一 principal 的进程重启在本地恢复记录，并请求完整 Host opening。一致的重叠保留较早历史，未覆盖的 opening 则替换窗口，不虚构缺失事件。
- 持久化窗口以 core 级收口；物理断网、前台与推送恢复及真机验收仍开放，本增量未跑模拟器进程重启车道。

## 开放工作

- 安装态进程死亡场景必须验证重启后的完整 opening 与持久化窗口协调。当前协议适配仍需安装态运行。
- §25 的物理断网与前台/推送恢复验收仍开放。
