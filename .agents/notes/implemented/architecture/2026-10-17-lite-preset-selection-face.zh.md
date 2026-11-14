# Agent Note: Lite 会话从捆绑投影中选择自己的 preset

状态：已实现

[English](2026-10-17-lite-preset-selection-face.md) | 中文

## 问题

第 33 节以「Lite 只通过 profile/preset 组合不同上下文」收尾，但装配出的 Lite 会话始终运行投影中 order 最小的 preset：`LiteSessionAssembler` 不接受 preset id，`LiteChat` 提交的是 `presetCatalog.defaultSystemPrompt`，会话事实只报 preset 来源不报是哪一条。该节自己的 remaining 行钉死了缺口：preset 选择 UI 仍待实施。选择面还必须直面当前目录的两个事实：捆绑投影今天恰有一条可选 preset（`minimal`；其余三条 shipped preset 因需要运行时变量被结构性排除），而存储的选择是一次受第 46 节原子、可恢复、不静默丢弃规则约束的配置迁移。

## 决策

选择是既有目录上的查找，绝不是第二套 preset 模型。`LitePresetCatalog` 新增 `preset(id)`（纯查找）与 `resolve(id)`（一次性解析：null 取 order 最小的 default；目录不携带的 id 大声失败，点名该 id、来源与目录携带的全部 id——Lite 绝不猜替代品，即第 32 节规则应用到 persona 面）。`LiteSessionAssembler` 接受可选 `presetId` 并经捆绑目录解析；`LiteChatViewModel` 以 `selectedPreset` 携带解析后的描述符并提交其 assembled prompt——default 路径字节不变。会话事实新增 `presetId: String? = null`——解析值是目录数据、绝不是常量，故默认值对无投影构造面保持 null，而捆绑装配公开实际生效的 id（宿主 `agent-preset/selected` 可观测先例）。持久化复用可选字段先例：`LiteConfig` 新增可空 `presetId`，键缺席或 JSON null 时读为 null——选择前时代的密封文件原样可读，零迁移——保存时为 null 则省键，与旧三键形态逐字节同形。配置表单新增 preset 行，带覆盖目录实际条目的 picker 对话框；单条目录下诚实地只显示那一行，保存门控追加要求已存 id 被目录携带。装配缓存键纳入生效 preset id，选择变化即重装配而非复用缓存聊天。装配缓存键纳入生效 preset id，选择变化即重装配而非复用缓存的聊天。

## 备选方案

把 preset 钉在配置文件之外（纯 UI 态或侧路存储）被否：选择将活不过进程死亡，且绕开 endpoint 凭据已在使用的密封配置原子性。把 `presetId` 做成必填键被否：所有选择前时代的密封文件都会读作损坏并要求重录三项凭据——正与第 46 节可恢复规则相反。已存 id 未知时回退 default 被否：投影是「什么存在」的唯一权威，静默替代就是第 32/33 节禁止的猜；大声失败点名 id 让操作者重新保存即恢复。单条目录用禁用的固定行被否：列表恰好一项的 picker 是诚实形态——既不伪造多样性也不隐藏选择。宿主侧变化（重投影更多 preset、能力门控）被否：三条排除是结构性的（运行时变量），选择读取的是已捆绑的投影字节。

## 结果

装配出的 Lite 会话现在陈述自己运行哪个 persona——事实里的 `presetId`、provider 处的所选 prompt——default 路径与前代行为逐字节一致。选择前时代的配置原样加载，存储的选择在密封下往返、为 null 时省键。一条被接受的边界：若未来投影删掉已存 id，配置分支在组合期大声失败并点名 id（禁猜规则的直接后果；重新保存配置即恢复）。instrumented 链覆盖表单指名捆绑 default preset 与现在钉在 `presetId = "minimal"` 的事实等式。:core 测试净增九个，横跨 catalog、facts、stores 与 view-model；connected 轮四例通过，含新的 preset 行断言。

## 开放后续

为陈旧 id 的组合失败补一条配置面失败行（不重录凭据即自愈）；未来 preset 摆脱运行时变量后的重投影；RelayClient 的 java.net.http 迁移或退役；journal 续读；support export 的事实投影；审批 ask 档；归因头；第 54 节网络矩阵的设备端验证。
