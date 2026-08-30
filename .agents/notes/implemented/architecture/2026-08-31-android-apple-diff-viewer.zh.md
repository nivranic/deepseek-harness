# Agent Note: Android 与 Apple 的只读 Diff 查看器

Status: implemented

[English](2026-08-31-android-apple-diff-viewer.md) | 中文

## 问题

工具轨迹只展示原始参数 JSON，write 或 edit 到来时是一串读不懂的转义文本：伴侣端能看到文件变了，却看不到变了什么。第 55 章为首版排定的是只读 Diff 审阅——文件列表、hunk、行数——不做移动端补丁编辑。

## 决策

投影是折叠旁的纯函数，不是折叠的变更：`fileChanges(toolCalls)` 把已完成的调用各映射为一个 `FileChange`，第 62 章的一致性 fixtures 因此分毫未动。它读宿主的模型可见 fs 词汇——`write`（`file_path`/`content`）、`edit`（`file_path`/`old_string`/`new_string`）、以及 `str_replace_editor`（`path` 加 `command`：`create` 用 `file_text`，`str_replace` 配对 `old_str`/`new_str`，`insert` 增 `new_str`；`view` 只读不投影）。只有已完成的调用投影：失败的 write 没改任何文件，执行中的还没改。参数在模型/工具 JSON 边界解码，畸形或非对象载荷按缺失引用跳过。每次调用一个 hunk——先删行后增行，跨调用不合并——单个尾随换行不开启末尾空行；空 write 诚实地投影为零行变更。

两侧 UI 对称渲染折叠呈现：卡片常显路径、绿色的 `+N` 与红色的 `−M`，hunk 行藏在展开开关后（Compose 在调用行下挂 `DiffReview`；SwiftUI 在 `ToolCallRow` 内用 `DisclosureGroup`）。

## 后果

两侧 FakeWire 驱动的测试钉住同一批场景：带尾随换行的 write 恰折出两行新增，edit 一删一增，`insert` 独增——而 `view`、失败的 write、未知工具、仍在执行的调用、畸形 JSON 全都不投影。第二个测试钉住零行的空 write 与多行 `str_replace`。两条车道验证全绿；工件查看器（第 56 章）仍是下一项排定的打磨。

## 考虑过的替代方案

跨调用按路径合并变更被否决——每次调用一个审阅单元让轨迹可审计、投影可平凡重放。消费宿主的结构化 diff 结果元数据被延后——折叠保留的 `resultText` 是拍平的文本承载不了它，为首版去拓宽折叠会动三语言钉住的 fixtures，而参数本身已经够用。
