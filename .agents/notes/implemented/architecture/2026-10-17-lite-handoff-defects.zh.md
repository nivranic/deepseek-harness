# Agent Note：Lite handoff 回合如实入账——不再捏造完成、pendingHandoff 不再粘滞

Status: implemented

[English](2026-10-17-lite-handoff-defects.md) | 中文

## Problem

journal 续读代留下的具名两缺陷都坐在 handoff 路径上。其一，handoff 回合捏造完成：循环在 handoff 标记后直接返回、不落终态事件，`send()` 残余的 `else` 分支便记录一条 `message/completed`，文本取自 `conversation.lastOrNull()`——把用户自己的 prompt 行复述成助手回答——续读落地后这条捏造回复跨重启重放。其二，fold 在 `handoff/requested` 上写入 `pendingHandoff` 后从不清除：活体 fold 在进程余生一直携带该标志，下一个正常回合再次记录 `handoff/requested` 而非 `turn/completed`（后者从此在 journal 中绝迹），每次重启又把粘滞标志重放出来。相邻地，横幅读取平行的 `lastHandoff` 字段——设一次、进程内永不清、journal 终于标记处时重启后反而丢失——正是 §72 列为可删除债务的重复 UI 状态机形态。

## Decision

fold 在下一 `prompt/accepted` 到达时清除 `pendingHandoff`：新回合取代上一回合的挂起 handoff，标志恰从标记持有到下一 accepted prompt。`send()` 判别式以该逐回合标志增首臂——handoff 回合除自身标记对外零记录，尾部块本就记录 `handoff/requested` 且正确地不记 `turn/completed`；handoff 回合的 journal 恰为 `prompt/accepted` → `handoff/requested`，与 handoff conformance 参照的 fold 一致。横幅改读 state 切面的 `pendingHandoff` 并删除 `lastHandoff` 字段：唯一事实源，回合中活自驱动器 fold，终于标记处的 journal 重启后经播种 fold 持续可见，下一回合开始即清除。

## Alternatives considered

把驱动器局部的 handed-off 标记暴露为 `send()` 判别式被否决：取代语义落地后 fold 标志逐回合可靠，且 fold 正是 journal 重放的平面。在 `message/completed` 或 `turn/completed` 上清标志被否决——handoff 回合两者皆无；取代点是下一 prompt，恰为参照事件序列所钉。构造期播种 `lastHandoff` 而非删除被否决：两个状态要对齐、字段还需要自己的清除规则——读 fold 严格更简且一次解决双向。新 journal 标签被否决：十六标签闭集保持；标记对已精确承载该回合。标记后驱动器侧补终态事件被否决：循环契约钉住在标记处停——回合没有完成，它转移了。

## Consequences

handoff 回合如今重放为它自己：用户行加挂起 handoff 横幅，无助手回声，跨重启同样。`turn/completed` 在 handoff 回合后回归 journal——此后每回合重复标记 `handoff/requested` 的腐蚀消失。横幅与 fold 双向一致：下一回合开始即清除、终于标记处的 journal 重启后仍显示。同族捏造还剩一臂，具名而非静默保留：`turn/cancelled` 回合仍会落入 `else` 分支、把已送达前缀记成普通完成——今日 ViewModel 未暴露取消路径故不可达。

## Open follow-ups

取消路径出现后的 `turn/cancelled` 捏造臂；主仓库 TS/Swift 姊妹 fold 携带同样的只写不删 `pendingHandoff` 语义，其生成夹具集需镜像 handoff-后-下一-prompt 用例；播种活体驱动器状态以平滑恢复后首个回合；工具声明打包与 HOST_DECLARED 名域（本地名对齐随之承重）；RelayClient 迁移或退役；support-export 事实投影；审批 ask 档；归因头；§54 网络矩阵。
