# Agent Note: 物理 Android 车道上待确认 Question 只属于其已保存 Host

Status: implemented

[English](2026-09-30-android-host-question-isolation.md) | 中文

## Problem

第 28 节记录「Question 与待确认输入跨主体隔离有 core 证据」——待确认 Question 的跨主体隔离此前只有 core 级（单元/JVM）证据。既有物理验收车道要么只覆盖双已保存 Host 的提示草稿（`android-host-roster.e2e.ts`），要么只覆盖单 Host 的 Question（`android-companion-question.e2e.ts`）；不存在设备实跑证据，证明同一应用、同一 Session id 下，一个 Host 的待确认 Question 及其作答草稿在选中另一个已保存 Host 期间不可见、不可作答、不残留。

## Decision

- 验收 op 词汇新增 `assertNoQuestion`：打开交互页，先等待观察流的 `ready` 帧（client id 置位——Host 快照已落定），再断言提交回答控件缺席、模型收件箱无待处理交互、调用方指名的题目文本不渲染。先等就绪再断言缺席，使检查对「事件尚未到达」免疫。
- `android-host-question.e2e.ts` 将隔离验收应用与两个真实 Host 配对（普通脚手架 A；重放已录制 Question 回合的脚手架 B），共用一个 Session id，在 `emulator-5554` 上核验：A 从不暴露待处理交互；B 升起 Question；选中 A 时 Question 卡片、选项与草稿全部隐藏；切回 B 恢复 Question 与保留草稿；另一进程重启后两者都恢复；草稿仅经 B 提交一次（`$events/result` 恰一次派发到 B、从不派发到 A），完成 B 的录制回合，而 A 既无提示也无应答；作答后退役的 Question 在 A 上仍从不出现；每个 Host 恰保留一个设备授予。
- 车道在 Host 边界断言应答送达：仿 roster 车道的 `session/prompt` 业务 spy，spy 各脚手架原始 `dispatchRpc` 的设备签名 `$events/result` 调用，使「只作答了自己的 Host」成为 Host 侧证据而非设备侧推断。

## Alternatives considered

- **扩展 roster 车道加入 Question 步骤：** 单条车道将同时持有切换/重启矩阵与 Question 矩阵，拉长本已 240 秒的验收并混合两套 golden 叙事；姊妹车道共享脚手架模式而保持聚焦的 golden。
- **不等流就绪直接断言缺席：** 朴素的 `assertDoesNotExist` 可能在 Host 快照到达前通过，无法区分隔离与时机；ready 帧闸门让缺席有意义。
- **像单 Host 车道那样经浏览器客户端驱动回合：** roster 车道已证明设备 composer 能升起录制重放回合；本车道保持无浏览器，让证据只关于设备本身。

## Consequences

- 第 28 节 Question 跨主体项有了物理平台证据：隔离在 Host 切换、进程重启与作答之间成立，双脚手架确认单一 Host 分发。
- 任何把一个 Host 的待处理交互泄漏进另一已选主体模型（收件箱、UI 或持久化作答）的回归都会破坏本车道。
- 验收仍限模拟器（`emulator-5554`、`nativeacceptance` 应用 id、重放夹具）；真实物理硬件与推送投递按既有授权边界留在本车道之外。

## Open work

- 审批（`允许一次/拒绝`）交互类型共享同一收件箱与同一按主体划分的模型；本车道显式演练 Question 类型，审批跨主体隔离依赖同一机制但没有专属物理车道。
- 后台/推送行为与完整 Session 位置元数据仍是第 28 节开放项。
