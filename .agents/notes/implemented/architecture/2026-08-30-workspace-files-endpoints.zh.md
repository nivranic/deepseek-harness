# Agent Note: 只读 workspaceFiles Remote 端点

Status: implemented

[English](2026-08-30-workspace-files-endpoints.md) | 中文

## 问题

伴侣端的 Files/Diff 面（原生化方案第 54 章）需要宿主侧的只读浏览与读取动词，但远程允许清单没有任何文件端点，原生侧也没有可解码的文件条目词汇。第 54 章强制要求：workspace 授权、路径规范化、根包含、路径穿越拒绝、大小上限、mime 探测、二进制守卫与范围读取——并要求复用现有 workspace 控制器及其 API，而不是发明平行的文件服务。

## 决策

`dsh-api-workspace-controller` 增加第三个 Remote owner：`WorkspaceFiles`（`ctx.workspaceFiles`，命名空间 `workspaceFiles`），作为 workspace 控制器的子插件挂载（与选目录子插件同型），在文件系统后端组合完成前保持 pending——已发布的桌面组合天然满足，因为 `dsh-fs-sandbox` 注册了 `ctx.fs`。两个动词 `list` 与 `read` 采用扁平线缆参数（网关把方法参数与 args 字段一一对应，即选目录动词的形状——单一请求对象参数在线缆上会要求嵌套的 `{request}` 包装）。包含判定是规范化的而非文本的：控制器把已注册 Workspace 的根与规范化后的相对路径都经 fs 能力 resolve，并要求 `fs.contains(root, target)` 成立，于是字符串层的 `..` 规范化只是便利过滤器，而指向根外的目录 junction（逃逸 symlink 的 Windows 可移植等价物）在解析后被拒绝——由一个无需特权、全平台可跑的 junction 测试证明。读取仅限文本，后端的 `FS_NOT_TEXT` 二进制拒绝透传为 `file-binary`；字节上限（`maxReadBytes`，schemastery 插件配置，默认 256 KiB）约束无界读取与返回范围，而显式有界的分页可以读超过上限的文件——分页正是伴侣端读大文件的方式，这一区分是被宿主单测逼出来的（第一个上限设计直接失败）。范围以 UTF-16 码元计（`offset`/`limit`、`truncated`、总 `size`），Swift 与 Kotlin 都原生按此计数。媒体类型来自紧凑的扩展名映射，已解码文本的兜底是 `text/plain`。远程允许清单以 observer 级收录 `workspaceFiles/list` 与 `workspaceFiles/read`；`dsh-link-contracts` 建模 `LinkFileEntryType`/`LinkFileEntry`/`LinkFileListValue`/`LinkFileReadValue`，fixture 钉住真实控制器类型，走既有漂移门禁。

## 后果

已配对设备可以只读浏览并读取任意已注册 Workspace 的文本树；文件系统的其余一切都不远程（不列注册根之外的目录、不写、不传原始字节）。desktop-composition e2e 现在证明这些动词经已发布组合的网关桥应答——包括线缆上的穿越拒绝——而该 e2e 启动的是构建产物 `lib/`，所以那里的契约变更需要先跑 `build:lib:host` 再跑 e2e（只跑 src 的单测曾掩盖一个陈旧 lib 的 404）。宿主单测在真实本地后端上覆盖包含（文本与规范化两层）、规范化、类型、范围、上限语义、二进制守卫与线缆边界校验。文本之外（图片预览、artifact 下载）仍是未来端点；Diff 面通过 `read` 范围读取整个文件。

## 考虑过的替代方案

独立 `files` 命名空间包被否决——第 61 章要求扩展现有 owner，而控制器包已经承载多个能力门控的 Remote owner。文本包含（对规范化路径做字符串前缀检查）被否决：只有规范化解析加 `contains` 能抓住链接与大小写/分隔符别名。请求对象参数（`workspace/create` 的形状）被否决——扁平形与选目录动词及伴侣端的组参方式一致；生成注册表的 `{request}` 线缆形状留给已在使用它的变更动词。
