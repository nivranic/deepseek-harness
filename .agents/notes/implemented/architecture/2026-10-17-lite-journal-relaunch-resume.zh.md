# Agent Note: Lite 会话跨重启续读自己的 journal

状态：已实现

[English](2026-10-17-lite-journal-relaunch-resume.md) | 中文

## 问题

Lite 面持久化了 journal 却从不读回：`LiteChatViewModel` 恒构造空 `LiteSession`，重启后打开的是空白对话——更糟的是，重启后的第一次 send 持久化的 journal 只含这个新 turn，把之前所有 turn 的字节静默丢弃（第 46 节 silent-drop 形态）。第 67 节的恢复条款——移动端重启恢复 last session、绝不自动提交未完成的 draft——在 Lite 侧没有承载。一个相邻缺陷放大了损失：以 provider 或 network 失败收尾的 turn 仍会记一条 `message/completed` 事件、其文本复述用户 prompt——一条捏造的 assistant 回复，续读本会把它变成永久的。

## 决策

构造期播种会话：`seedJournal` 从 store 载入该 session id 的 journal 并重放为会话历史——fold 的全量重放即恢复，构造器既有的首次发射把恢复的对话带给 UI、渲染层零改动。载入失败的 journal 被隔离而不是崩溃：store 把文件在同目录重命名为 `<id>.litejournal.unavailable-<uuid>`、字节保留、会话冷开为空（原生 journal store 的「文档化恢复」模板）；隔离 rename 自身失败保持响亮——load 刚读过的文件改名失败是文件系统损坏，不是恢复决策。播种的会话携带历史，下一次 save 的整文件原子写因此包含全部既有 turn——静默覆盖经播种自愈。错误 turn 的捏造同步修复：以 `provider-error` 或 `network-error` 收尾的 turn 记录折叠面既有的 `provider/error`（code、message）或 `network/error`（kind）事件替代捏造的完成，失败的 turn 重放为它的错误、绝不是一条回复。播种仅按 session id 匹配：换 endpoint 或 preset 改变的是下一个 turn 的请求面，不是对话的历史。

## 备选方案

不可读 journal 上崩溃被否：加载器的 fail-loud 契约对直接调用者保持，但装配是重启路径，第 67 节要求恢复而非崩溃；隔离同时保住字节与失败的可观测性。迁移到增量磁盘格式被否：内存会话携带历史后，整文件原子替换已满足第 46 节，格式变更会把相邻版本迁移拖进一个恢复修复。播种驱动器自有 fold 被否：驱动器的逐事件状态与 journal 的 turn 级保真规则（chapter 64）是两个平面，合并会让流式 live 切面与持久化结果纠缠——恢复后第一个 live turn 期间切面只显示该 turn，turn 结束的 journal 重放恢复完整对话，这是被接受并记录的瞬时形态。扩 journal 词汇记录 tool/todo 状态被否：十六个 tag 的闭集与 TypeScript、Swift fold 三方互验；续读按 journal 已有记录恢复对话面。播种时按 endpoint/preset 匹配 journal 被否：配置改变请求面，不改变历史。

## 结果

重启后落在用户离开时的对话里——恢复的对话从首帧渲染——journal 跨重启增长而不是清零。损坏的 journal 只损失一次历史、可观测、不阻塞应用。provider 与 network 失败以其本来面目持久化。一处瞬时形态保留：恢复后的第一个 live turn 期间，流式切面只显示进行中的 turn；turn 结束的 journal 重放恢复完整对话。两个既有行为现在成为具名后续而不是被默默保留：handoff turn 仍记一条复述 prompt 的 `message/completed`（错误路径刚甩掉的同一捏造族）；驱动器的 `pendingHandoff` 在 journal 视图里跨后续非 handoff turn 粘滞。

## 开放后续

handoff turn 的捏造完成与粘滞的 `pendingHandoff` journal 视图；播种 live 驱动器状态以平滑恢复后的第一个 turn；RelayClient 的 java.net.http 迁移或退役；support export 的事实投影；审批 ask 档；归因头；第 54 节网络矩阵。
