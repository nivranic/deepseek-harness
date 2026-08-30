# Agent Note: CompanionUI 文件浏览器

Status: implemented

[English](2026-08-30-companion-files-view.md) | 中文

## 问题

宿主刚发布带契约模型的只读 `workspaceFiles` 端点，但伴侣端没有消费它的界面：没有东西列出已注册 Workspace、浏览目录树、或按宿主分页语义读文本，宿主的失败词汇（file-too-large、file-binary、path-outside-workspace）也没有原生呈现。交互 view model 还引用着领域状态重构时删掉的 summary 助手——一个被缺失编译车道掩盖的活断点。

## 决策

`FilesViewModel` 拥有三个线缆面：observer 级允许的 `workspace/follow` 流播种并维护 Workspace 选择器（baseline 加 upsert/remove；order 与 archive 帧不影响哪些 Workspace 可浏览，予以忽略），`workspaceFiles/list` 浏览一个 Workspace 的树（模型自行串联根相对路径），`workspaceFiles/read` 读取文本。读取器经 `ContractCodec` 桥消费生成的 `LinkFileListValue`/`LinkFileReadValue`/`LinkFileEntry` 模型。分页直接骑在宿主自身的语义上：宿主以 `file-too-large` 拒绝的无界读取自动重试为显式分页（`offset 0`、`limit 65_536` 个 UTF-16 码元），`loadMore` 追加下一页并跟踪 `loadedUnits`/`totalUnits`，各拒答渲染为中文读取器状态（`file-binary` 为 二进制文件，无法预览，`path-outside-workspace` 为 路径越出工作区根，另有未找到/类型/工作区各情形）。`FilesView` 是第五个标签页：Workspace 菜单、带类型与大小的目录列表、上级导航、以及带页计数与媒体类型的内联读取器。交互 view model 的死引用改为本地 `detailText` 探针。FakeWire 增加了按方法的顺序应答（`stubSequence`）——分页测试正需要它：同一个线缆方法在不同调用中给出不同应答。

## 后果

方案第 50 章的 Files 模块现在是一个完整消费宿主只读端点的原生界面，上限重试行为意味着大而可浏览的文件永不死路。view model 测试覆盖注册表跟随、根列表与参数形状、嵌套导航与上级、整文件读取、too-large → 分页 → loadMore 的完整序列（含精确线缆参数）、以及两种失败呈现；Swift 在本机仍是已编写未编译（既有的 macOS 车道告解），解码正确性由契约模型与 fixture 字节承载。上传附件与 artifact 下载仍是方案的未来端点；此界面刻意不暴露任何变更。

## 考虑过的替代方案

解析 file-too-large 消息里的字节数被否决——`refused` 只携带 code 与 message，页大小是客户端自己的策略。专门的页大小线缆参数被否决——宿主已接受高于其上限的显式有界 limit，那就是分页契约。以 sheet 呈现读取器暂被否决——内联区块保住列表上下文（同级条目仍可见）且不需要第二个导航栈。
