# Agent Note: 会话事件词汇表进入 dsh-link-contracts

Status: implemented

[English](2026-08-30-session-event-link-contracts.md) | 中文

## 问题

CompanionUI 的时间线此前用通用递归文本探测折叠 follow 记录，测试喂的是自造的帧形状，plan/todo/goal 面板的生产数据源按约定留空——三者都在等上一份 CompanionUI 笔记点名的下一个契约增量。真实的记录词汇表（follow 快照里的 SessionEventEntry 信封与打包 chunk 行）与可合并扩展的 `SessionEventMap` 载荷形状只存在于 TypeScript 侧，原生伴侣端没有可执行的解码依据。

## 决策

`dsh-link-contracts` 的契约表扩展出一个封闭的、伴侣端渲染的会话事件子集。`LinkSessionEventKind` 枚举 13 个被渲染的标签（轮次/步区间、用户与助手消息及流式块、工具调用与结果、plan/todo/goal 状态、种子标记），`LinkChunkRowKind` 枚举打包的历史行；除无载荷的 `session/end-seed` 外每个标签都有载荷行，行上携带的 `sessionEvents`/`chunkRows` 元数据现在进入 manifest。载荷是投影视图而非无损镜像：`LinkContentBlock` 保留 `type` 判别标签加上展示字段（text、toolCallId、isError、嵌套 content），`LinkMessageSource` 展平可合并扩展的来源种类的展示字段，`LinkTurnEndReason` 只携带原因种类——超出建模集合的变体字段会被生成的解码器忽略，未知标签保持线缆合法，两者都写进 README。每个事件 fixture 都满足真实的 `SessionEventMap` 成员，插件合并通过 `dsh-plan-mode`、`dsh-tool-todo/types`、`dsh-goal` 上的类型边拉入程序；品牌化 id 用 `dsh-llm/brand` 的构造函数生成，goal id 因其构造函数藏在沉重的 goal 包根后面而采用本地断言。表的字段种类为这些新形状做了泛化：`role` 特例并入通用 `enum` 引用，`object-array`/`string-array`/`number-array` 进入联合，`camel()` 现在会拼接 `/` 分段使带斜杠的标签构成合法的 case 名，Kotlin 枚举项按大写蛇形发射。发射器校验引用解析到形状匹配的行、声称的标签是词汇枚举的取值——命名错误在生成期失败，而不是留到评审。CompanionUI 通过 `ContractCodec` 桥（对透传 `WireValue` 做 JSONSerialization）消费生成的结构体，`RemoteSessionViewModel` 折叠真实的 `{type: "event"|"chunks", event: {…}}` 信封并按种类渲染中文摘要，同一次折叠还以最后写入胜出的方式维护 plan/todo/goal 面板状态（`plan/mode` 是布尔——面板的 planSteps 列表收窄为线缆实际携带的内容）。面板视图直接读取 `@Observable` 模型；生产数据源按设计留空的过渡期 `PlanTodoGoalSourcing` 抽象已被移除。

## 后果

13 个新 fixture 走既有的漂移流水线：宿主侧对任何被建模载荷的变更会先被 link-contracts 的 typecheck（`satisfies` 钉住）拦下，再由 manifest/Swift/Kotlin 漂移门禁拦到产物重新生成为止，同步进 `apps/apple` 的拷贝与 macOS 车道上 Swift fixture 回放测试解码的字节完全一致。视图模型测试现在喂真实的信封形状——轮次开始、打包 text-chunks 行、计划模式、带 usage 的组装助手消息、整表待办写入、目标创建——并断言逐种类的时间线摘要与面板折叠（含目标清除墓碑）；fixture 回放套件对每个新 fixture 做生成模型往返并检查线缆标签枚举。Swift 在本机依然是"已编写未编译"（与核心层、UI 层相同的 macOS 车道告解）：正确性由 TypeScript 侧钉住、逐字节漂移门禁与 fixture JSON 承载。未知事件标签走通用路径渲染为标记行，因此封闭子集可以一次一个标签地增长而无需线缆变更。

## 考虑过的替代方案

镜像完整可合并扩展的 `SessionEventMap`（请求头、压缩记录、模型选择、标题）被否决：伴侣端渲染的是子集，未知标签无论如何都必须保持线缆合法，而建模 `EpochHeader`/`LlmCallConfig` 只会让表膨胀却换不到任何被渲染的像素。手写 Swift 事件枚举被否决——猜测线缆形状正是契约流水线要防止的事。面板的取数协议在存在生产数据源之后被否决：读取可观察模型给出实时面板更新，而快照加载式间接层只会在会话切换时重触发。
