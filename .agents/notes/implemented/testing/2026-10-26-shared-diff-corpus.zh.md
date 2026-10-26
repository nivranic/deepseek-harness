# Agent Note: 一份钉值 Diff 夹具矩阵喂给全部三个 diff 渲染面

Status: implemented

[English](2026-10-26-shared-diff-corpus.md) | 中文

## Problem

三个客户端面从同一 jsdiff 输出渲染 diff，却没有共享夹具：ui-primitives 经 `diffTotals` 计全文件两侧行数，trajectory 会话轨迹把 `structuredPatch` hunk 映成 prompt-diff 行，documentpreview 用 `parseUnifiedDiff` 解析累积的统一文本。各包只测自己手写的输入，jsdiff 升级或某一消费面重写都可能与另两件静默漂移——不会有任何测试点名分歧。trajectory 的映射还锁在 `TrajectoryTable.tsx` 私有函数里，不挂组件树就没法测。

## Decision

把夹具矩阵落在 `packages/client/ui-primitives/src/DiffCorpus.ts`（另两个消费面都已依赖的包），十一个钉值案例（`singleLineReplace`、`trailingNewlineAdded`、`identical`、`create`、`delete`、`scatteredHunks`、`farScattered`、`cjkEmoji`、`crlf`、`blankLineChange`、`blockReplace`）全部取自真实 `structuredPatch('', '', before, after, undefined, undefined, { context: 3 })` 输出。每案例记录 before/after 对、含 `\ No newline` 注记行的 hunk 前缀行、patch +/- 计数、两侧各自的内容行数。每消费面一份 spec 断自己的视图：ui-primitives 把 `diffTotals` 对到内容行数（create 是 `oldText: null`，delete 的空 `newText` 是零行）；trajectory spec 改测抽出的纯模块 `src/client/prompt-diff-lines.ts`（保留头行、hunk 间空 meta 分隔、丢注记行、identical 为空），`TrajectoryTable.tsx` 导入它；documentpreview spec 从 corpus hunk 拼出统一文本，断完整解析行序——hunk 起始、两侧行号逐行推进、note 行带反斜杠原样入行、add/del 计数与钉值 patch 计数一致。矩阵刻意让两个计数族并排可见：patch 计数（只计变更行）与全侧计数（计每一行），逐案例吻合但度量不同的东西。`farScattered` 钉住两 hunk 形态（`context: 3` 把更近的编辑桥接成一个 hunk，`scatteredHunks` 即是），identical 案例钉两侧零 hunk。

## Alternatives considered

在各 spec 内部自行推导期望值被否——夹具只剩叙事，spec 间漂移仍不可见。测试时用 jsdiff 现场生成夹具被否——那等于用被测代码重新推导钉值，只在库输出形态变化时才挂，消费面之间的分歧挂不出来。新建共享夹具包被否——ui-primitives 已是公共依赖，且矩阵的全侧计数正是 `DiffBlock` 自带的规则。

## Consequences

三个 diff 面共用一份夹具，jsdiff 升级或消费面重写漂移任一钉值字段都会在所属 spec 挂掉；§34 共享 Diff 矩阵随本 note 落地。partial download 恢复语义与接附件仓的 range 读窗留在台账——partial download 的呈现面（`data-diff-eof`、`copyLoaded`）既有 diff-body spec 已钉，余下是存储侧工作。回归跑动中 ui-primitives 图标集 spec 出现 79 对钉值 78 的失败：98802d5ad8 提交加了 `IconOverflowVertical16` 却没同步计数，是 2026-10-03 起的 HEAD 既有漂移——此处修到 79 并把该字形按名钉住；`code-block` 语法懒加载测试在整包并行满载下的 5 秒超时记为主机负载瞬态（单跑反复绿，且其面与本改动无关）。
