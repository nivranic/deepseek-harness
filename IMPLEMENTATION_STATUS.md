# 新版 Agent 实施状态

状态：IN_PROGRESS。Phase 0、1 / Gate 0 已完成，Phase 2、3、4 正在实施。采用新 Upstream-First 规格，在隔离分支继续收敛到官方实现；旧 Gate 的历史 PASS 不迁移为新方案 PASS。[Git 基线](UPSTREAM_BASELINE.md)、[差异审计](UPSTREAM_DELTA.md)和[机器回执](artifacts/upstream-first/evidence.json)共同限定本状态。

| Phase | 工作 | 状态 | 当前结果或下一步 |
|---|---|---|---|
| 0 | Upstream Refresh | PASS | 官方 HEAD 已 fetch，17 个工作树已采集，隔离分支已建立 |
| 1 | Delta Audit | PASS | 已审 129/129 个归属；0 个待审 |
| 2 | Desktop Convergence | IN_PROGRESS | 官方 unsigned Windows 安装包已构建，实际打包应用的设置/主题/托盘/恢复/退出通过；插件安装、安装/更新/系统登录、macOS 与其余迁移待完成 |
| 3 | Contract Stabilization | IN_PROGRESS | checkpoint/Storage、Host 发现、协议 2/1 与主要能力 UI 已验证；Prompt 去重、普通 Session 目标取消及条件重命名已验证；其他变更幂等、其余入口、完整兼容、错误体系及转换待完成 |
| 4 | Interaction Reliability | IN_PROGRESS | 版本、过期、Host 重启、回答丢包、Question 答案竞争、取消/重试交错及页面刷新已验证；后台恢复、权限执行及变更确认语义仍待完成 |
| 5 | Responsive Shared Client | NOT_STARTED | 官方 UI、locale 与浏览器矩阵 |
| 6 | Diagnostics | NOT_STARTED | health/readiness/support |
| 7 | Device Trust | NOT_STARTED | Pair、角色、撤销、secure store |
| 8 | Remote Transport | NOT_STARTED | 受信任 Carrier，保留 local auth |
| 9 | Follow/Attach/Handoff/Multi Host | NOT_STARTED | 先实现查看位置转移 |
| 10 | Thin Native Companions | NOT_STARTED | Apple/Android 依赖前述稳定 Contract |
| 11 | Lite | DEFERRED | 前置能力完成后再准入 |
| 12 | Release/RC | IN_PROGRESS | Windows runtime/wheel 与 unsigned Desktop 先行验证；completeRc=false，安装、签名及跨平台证据缺失 |

## 浏览器响应式矩阵与手机层抽屉

[当前来源记录](artifacts/upstream-first/responsive-phone-drawer-source.json)以 chrome-devtools 实测矩阵收口 §6/§7 断点族：低于 600px 时框架完全放弃侧边栏轨道（三列显式 grid-column 1/2/3，脱离文档流的抽屉列不再滑动后续轨道），对话区横向占满，展开侧栏以 280px 悬浮抽屉呈现，遮罩点击与 Esc 同径关闭；输入框左端由媒体查询控制的 32px 开关占用 session-maybe 的 conversation.input.left 列表席位，空白首页亦可导航。恰好 600px 回归轨道层，720/960 折叠轨与 1440 桌面布局实测不变。三包 603 项组件测试、lint、typecheck、catalog 与 doc-sync 36 门全绿。视觉通道本会话不可用，验收以观测日志中的 DOM 几何断言为准，截图留存人工复核。

## 诊断层级协议塔量

[历史来源记录](artifacts/upstream-first/diagnostics-only-tier-source.json)把 §14 兼容矩阵的 N-2 行落为网关权威语义：显式 apiProtocolVersion 0 声明诊断层级，请求沿用冻结协议 1 编解码，仅对只读 Host 发现端点（host/describe、host/negotiate）准入；业务 RPC、流与事件结果结算以同一 compatibility 失败（gateway/protocol-unsupported，相同 endpoint 与 supportedApiProtocolVersions 详情）拒绝，Client 呈现常规 incompatible 升级指引。Unknown 版本拒绝语义保持不变。host/negotiate 仍只接受正整数报价，诊断层 Client 无法协商进完整编解码器。Gateway 套件 432/432（解码、RPC 准入、流准入三向），失败码与详情结构未动，信封 schema 与 Kotlin/Swift 镜像保持一致。真实多版本互通矩阵仍是缺口。

Session writer 保持 V3。

## Swift 契约列 CI 证据回收

[历史来源记录](artifacts/upstream-first/swift-ci-recovery-source.json)把 swift-contract lane 的 PENDING_CI 落实为已执行的全绿证据：XCTest 包在托管 macOS runner 上无法稳定构建（macos-14 镜像对任何导入同级 Swift 模块的 SPM 测试目标非确定性失败，最小全新包在两套工具链与串行构建下复现；二十轮探针定界），改为单一可执行目标 dsh-contract-check 以退出码断言同样四项证据（镜像等值 28 码、已分类码均被 schema 声明、未分类解析 unknown、不透明分支排除全部 84 已知码），夹具移至 contract/fixtures/ 由生成脚本刷新。macos-15 lane（Swift 6.1.2，CI run 35450241173 job 105916046840）四项 PASS 全绿，日志随来源记录归档。

镜像不再是可导入的库模块；未来 Swift 外壳消费生成 JSON 投影或在自身模块内重建镜像。Session writer 保持 V3。

## Android core 与 app 迁入契约构建

[历史来源记录](artifacts/upstream-first/android-migration-source.json)把历史 companion 的 core 领域（Lite 折叠、Link/Noise 栈、handoff、支持导出、诊断）与 Compose 外壳原样迁入 apps/android：settings 组合 :contract/:core/:app，根声明 AGP 8.10.1 + Kotlin 2.2.21（apply false），product-version.properties 原样迁移。:core 37 个 JVM 测试类全绿；:app 配置通过；:app:assembleDebug 由 verifyScannerResources 门禁——支持扫描器 AAR（Go+NDK 链）未建，外壳编译证据未声明，模拟器 lane 待门禁解除。

迁入模块尚未消费 :contract，Gateway 失败分类接线随 Gateway 接线增量落地。Session writer 保持 V3。

## Interaction 回复权限的 Host 权威执行

[历史来源记录](artifacts/upstream-first/interaction-permission-source.json)在 Gateway 回复边界落地 §15 requiredPermission 的 Host 权威执行：无对应权限的 Remote 客户端回复以 403 gateway/permission-denied 拒绝，PendingInteraction 不结算、Remote event 投递不消费，底层 Tool 不产生副作用；approval 与 question 两方向均有正反向 fixture 测试（Gateway 套件 431 项全绿）。部署级开关 interactionReplyPermissions 默认双授权，Device Trust 角色化落地后按角色替代。

apps/apple/contract/Package.swift 的 Swift 5.9 尾随逗号修复随本来源记录提交；swift-contract CI lane 待重调度回收首跑结果。原生外壳、模拟器/真机、多版本行为仍未完成；Session writer 保持 V3。

## Swift 契约列与 macOS CI lane

[历史来源记录](artifacts/upstream-first/apple-contract-source.json)在 apps/apple/contract 建立 Swift 包：RemoteFailureClass 枚举与 28 码镜像消费与 Kotlin/TS 同一权威，测试资源由生成脚本从协议包刷新。Swift 侧只固定结构证据——镜像等值、分类 ⊆ schema 已声明码、不透明未知分支排除全部 84 已知码、未分类词解析 unknown；payload 校验仍由 Ajv 与 networknt 列持有，未用脆弱的 Swift 校验器复实现。

ci.yml 新增 swift-contract 作业（macos-14，pull_request/workflow_dispatch 条件下运行 swift test）；本机 Windows 无法运行 swift，该检查在来源记录中如实标记 PENDING_CI，待调度的 macOS lane 回报后由下一来源记录接续。gen-remote-failure-classes-json.mjs 同时刷新 Apple 测试资源，漂移由测试拒绝。

原生外壳、模拟器/真机、多版本行为仍未完成；Session writer 保持 V3。

## 失败分类的扩展与首批 UI 采纳

[历史来源记录](artifacts/upstream-first/failure-classes-adoption-source.json)把共享分类扩展为 9 类 28 码：新增 invalid-input（调用方输入非法，原样重试不可能成功）并纳入 attachment/title/preset/workspace 路径校验码，unavailable 族补充 not-regular-file 与 not-directory。session/steer-unavailable 有意保持未分类——静默跳过消费者具有类检查会不当放大的 owner 语义。

ui-workspace 的会话重命名冲突分支与 ui-deliverables 的呈现文件缺失映射改为消费 classifyRemoteFailure/classifyRemoteFailureCode，对既有码行为不变、同类码按同一语义路由；Kotlin 镜像枚举与映射同步并经 28 码投影等值测试验证。定向 451 项通过（ui-deliverables 的 1 项 symlink 失败为已知 Windows EPERM 环境类，非回归，由 CI 仲裁）；限定 lint、doc-sync 36/36、§45 追踪测试通过。

其余 client 表面、N-2 诊断层级、Swift 列与多版本行为仍未完成；分类仍不授予能力、权限、重试或版本准入，Session writer 保持 V3。

## Kotlin 契约列与 apps/android 起步

[历史来源记录](artifacts/upstream-first/android-contract-source.json)在 apps/android 建立全新 Gradle 工程（Gradle 8.14、Kotlin 2.2.21），首个 contract 模块以 Kotlin JVM 库镜像候选 Remote 失败契约：RemoteFailureClass 枚举与 RemoteFailureClasses.classify 镜像 TypeScript 权威，未收录码解析为 UNKNOWN 不透明呈现；schema 在测试期直接从协议包复制，分类投影由 scripts/gen-remote-failure-classes-json.mjs 生成并提交，漂移由测试拒绝。

8 项 JUnit 测试（networknt 2020-12 校验器）验证 schema 结构（84 已知分支 + 1 不透明未知分支）、5 个真实录制 HTTP payload、未知未来码保持不透明、非法已知码详情被拒、缺 message 被拒、Kotlin 镜像与 TypeScript 投影一致、分类只引用已声明码。双语文档与配对、doc-quick 17/17、doc-sync 36/36 通过。

CI 通道同步解锁：候选分支的 ci.yml 增加 workflow_dispatch 并放宽 job 事件条件（因候选基于 upstream 基线与 origin/master 冲突、PR merge ref 无法创建），已通过 API 调度在分支 ref 上运行九作业 lane。Kotlin 证据仅为本地 JVM 测试，非安装应用、模拟器或真机资格；原生外壳尚未迁入，Swift 列与多版本行为仍未完成。

## Remote 失败码的共享 Client 分类

[历史来源记录](artifacts/upstream-first/remote-failure-classes-source.json)在词汇表 owner @deepseek-ai/dsh-typert-protocol 中建立封闭 RemoteFailureClass 分类：authentication、permission、host-state、compatibility、carrier-invalid、transport、conflict、unavailable、unknown。classifyRemoteFailureCode/classifyRemoteFailure 把码映射到这些呈现语义；映射只收录已有跨 Client 一致含义的 21 个码，可合并扩展词汇表的其余码（包括所有未来码）有意解析为 unknown，按不透明诊断呈现，不推断恢复动作或权限。

网关 client 的 classifyFailure 改为消费该分类：compatibility 投影为 incompatible、carrier-invalid 投影为 fatal，其余类别保持默认重连行为；对原有已分类码的可观察行为不变，133 项网关 client 测试原样通过。scripts/verify-remote-error-model.ts 新增 verifyRemoteFailureClassification，analyzeRemoteErrorWorkspace 在 doc-sync 的 verify-remote-error-envelope 门禁内执行它，分类引用未声明码即失败，分类因此无法脱离清单漂移。

定向 32 项测试（分类单元、协议回归、verifier 门禁）、限定 lint、两面构建导出、envelope 门禁 84 码保持 current、note 格式与双语配对、doc-sync 36/36 通过。新增 Agent Note 记录决策、替代方案、契约与回滚。

以上为本地 TS 证据。其余 client 表面的接入、Swift/Kotlin 投影、多版本行为与 UI 文案统一仍未完成；分类不授予能力、权限、重试策略或版本准入，Session writer 保持 V3。

## 正式 Remote 错误信封 schema

[历史来源记录](artifacts/upstream-first/remote-error-envelope-schema-source.json)以编译器无关错误模型为唯一输入，生成正式 Remote 失败信封 JSON Schema（draft 2020-12，$id=urn:deepseek-harness:remote-errors），并随 @deepseek-ai/dsh-typert-protocol 打包导出。84 个已知码分支各自携带由解析详情根生成的对象 schema；未知码分支保留不透明对象诊断，并以 not-enum 明确排除全部已知码，非法的已知码不能假扮未知码绕过校验。输入投影接受扩展字段，消费方须保留原始诊断对象而不是清洗未知字段。

生成复用 emitRemoteErrorSchemas(face) 的 Zod emitter，经 data URL 在生成期执行 emitter ESM，不另写 TypeScript 解释器；同 face 重复码、未声明 schema、跨面不一致和 Map 原型键碰撞均被拒绝。当前 Zod JSON Schema 转换遗漏元组基数，固定/可选/rest 元组的详情一律使生成失败，未放宽为无约束数组，也未手写近似 schema。doc-sync 中的 verify-remote-error-envelope 门禁取代原 remote-error-model 叶子，校验独立清单、解析详情根、跨面一致与产物新鲜度，叶子总数保持 36。

定向回归 117 项通过、5 项按既有条件跳过；负向控制拒绝过期产物、非 JSON details、元组基数与跨面不一致。plain Node 下 built emitter 与源码输出精确一致，144 个面/码组合全部加载。本地打包协议 tarball（0.1.5-rc.2，未发布 registry）经 Ajv 2020-12 校验器消费：84 分支、五类真实 HTTP payload 接受、五类非法输入拒绝、未知字段保留。

以上均为本地 Node 证据。Swift/Kotlin 消费、旧版已发布 Client、多版本 N/N-1/N-2 行为与设备矩阵仍未验收；本增量未新增运行时 UI、Session 事件或 Session 格式，writer 保持 V3。§45 追踪已加入本 schema 的候选证据，acceptanceProven 仍为 false。

## 可移植校验诊断与解析后的错误详情

[历史来源记录](artifacts/upstream-first/remote-validation-details-source.json)将 gateway/bad-request 的问题条目明确为 code、message、path。Settings、Credentials、Subagent 和目录创建通过协议辅助函数转换；通用 Connection 在自己的 envelope 解析处复制相同字段，保持不依赖 Typert。库专用元数据与附带输入不跨端传输；消息保留拥有方原文，不据此宣称通用脱敏。

错误模型在保留原始类型引用的同时，复用严格 Remote checker 投影，生成独立 Host/Client 的 JSON 详情根。全部 84 码、144 个面/码组合可生成 Zod 与 JSON Schema；60 个两面共有码的 schema 一致。品牌、条件和映射类型经实际生成的 validator 验证；unknown、any、object、bigint、symbol 和可调用详情明确拒绝。完整 schema 尚未发布，转换成功不等于全部 payload 等价或原生兼容。

领域/载体回归 86 项、目录/协议补充 26 项、生成器回归 214 项通过，生成器另有 28 项按既有条件跳过；21 项聚焦检查包含在生成器范围内，不重复累计。隔离的真实 shipped Web Loader Host 对五类 HTTP 校验拒绝录制并重放一份 owner-local 快照，五类实际详情均通过生成 Zod 与 JSON Schema 消费验证，无模型请求。构建后的生成器模型与源码模型完全一致。

初次类型检查发现新 Host 快照误入 Client 编译面，以及遗漏的目录创建生产者。测试已按既有配置归入 Host，556 个误生成文件经时间、源映射与未跟踪状态核对后备份隔离；两面类型检查通过。最初 HTTP 夹具把 subagents 写成单数；修正后又发现 Connection 陈旧 bundle，旧观察保留，按正常构建更新该包并加强 envelope 字段断言后重新录制和回放通过。

最终 doc-sync 36/36、快速文档 17/17、定向 lint、类型、追踪与空白检查通过。未新增浏览器 UI、真实模型、物理设备、签名、安装或发布验收；Session writer 保持 V3。可选元组 schema 等价性、完整已发布详情/envelope、全 Client 一致呈现、多版本和原生矩阵及后续 Phase 仍未完成。

## readonly 数组与元组 schema

[历史来源记录](artifacts/upstream-first/readonly-schema-source.json)补齐既有 Zod 生成器对 readonly 数组和元组的处理：验证元素后冻结解析容器。keyof、unique 及不支持的元素类型仍明确拒绝。109 项 schema 与 Remote codec 测试通过，定向 lint 通过。

实际错误类型图经构建后生成器探测：144 个编译面/错误码组合中 130 个可生成 Zod，129 个可转换为 JSON Schema；这只说明可生成，不证明全部 payload 等价。实际协议版本错误的数字数组在 Host、Client 两侧均验证有效值、拒绝错误元素，并保留解析结果冻结语义；该数组的 JSON Schema 往返也通过。

14 个 Client 跨面引用仍无法直接投影，gateway/bad-request 的宽泛 object 仍被 JSON Schema 转换拒绝，没有改为任意 JSON。首次测试还发现 Zod 4.4.3 的可选元组 JSON Schema 往返会改变接受范围；独立对照确认普通可变元组同样存在，保留失败记录，不宣称该路径已具可移植等价性。

文档聚合为 35/36；为生成器双语 README 补齐一致稳定锚点后，快速文档检查 17/17 通过，链接复核通过。初次中文片段修改造成的配对失败也保留。完整详情 schema、跨平台 Client 一致呈现、多版本互通与 Phase 3 仍未完成。

## Remote 错误详情类型图

[历史来源记录](artifacts/upstream-first/error-type-model-source.json)记录 Typert 的 analyzeRemoteErrors() 投影。它复用独立 Host/Client 编译程序和既有 TypeGraph 转换，直接读取基础错误表及扩展，保留未被 service 或 schema 根引用的错误。Host 有 80 码、Client 有 64 码，合集为 84 码；四项 Client 特有声明不再依赖 Host 图覆盖。

普通 Node 加载构建后的生成器，所得模型与保存的源码模型完全一致。生成器相关回归为 202 通过、28 跳过；投影、清单和调度的 102 项通过与前者重叠，修正 fixture 路径后的 7 项也不累计为新增测试。Host/Client 类型检查及定向 lint 通过。

文档聚合先通过 34 项、失败 2 项；修正中文事件源码行号、中文链接及 fixture 路径后，双语配对和包路径两个失败项均通过，未重新宣称完整聚合 36/36。类型图保留声明结构，尚不是可执行 codec、可移植详情或 envelope schema；完整 §45、原生多版本互通和 Phase 3 仍未完成。

## 已知码语义与历史来源校正

[历史来源记录](artifacts/upstream-first/error-code-schema-accuracy-source.json)将 gateway/result-invalid 的说明收窄为实际产生条件：流方法返回值既不是 Iterable 也不是 AsyncIterable。Gateway 保留弱结果 codec 元数据，不由此宣称一般返回 payload 已被验证；本轮只修改声明说明与生成的 schema，未增加运行时解码器。93 项相关结果、codec 与流测试通过，另有 82 项因名称筛选未执行。

新本地 tarball 内的修正 schema 和双语 README 与源码一致；标准 JSON Schema 消费验证识别 84 码并拒绝五种未知或非码输入。当前新鲜度、四项实际 CLI 负向对照、Gateway 双端类型与六项追踪检查通过。此前生成器、门禁调度和文档证据保留其原始范围；不新增完整聚合、浏览器、原生或真实模型验收。

原报告生成失败还指出历史 profile composition 使用了更新后的 run-gates.ts。已封存旧文件与历史 SHA 完全一致，报告来源选择器已接入该副本；未改写历史预期摘要或跳过校验。原 schema 记录和失败日志保持不变。完整 §45 的跨平台语义、详情验证、Client 一致呈现及兼容矩阵仍未完成。

## 已知错误码 schema 与语义声明门禁

[历史来源记录](artifacts/upstream-first/error-code-schema-source.json)绑定从 14 个拥有方、84 条 RemoteErrorDetailsMap 声明派生的[已知码 JSON Schema](packages/typert/protocol/remote-error-codes.schema.json)。协议包导出并携带该文件；49 条声明补齐失败语义。生成器拒绝重复归属、缺少说明、可选码、开放索引和间接成员，忽略私有嵌套、函数局部及外部模块的同名类型。新鲜度检查与其测试接入 doc-sync 和 test:docs。

102 项生成器和门禁回归通过，五项平台用例按既有规则跳过；最终作用域调整后的 14 项生成器测试另行通过，数量与前者重叠。实际 CLI 的四项负向对照拒绝过期 schema、缺少说明、重复归属和开放索引。最终本地 tarball 中的 schema、导出和双语 README 与当前源文件一致，标准 JSON Schema 消费验证识别全部 84 码并拒绝五种未知或非码输入。

Host/Client 类型、限定 lint、六项需求追踪及空白检查通过。doc-sync 初次 34/35，仅事件关系图源位置过期；重建后原失败门禁通过，未重跑聚合。Publint 无错误，保留原有未发布 src 通配导出警告。四个产品声明文件的去注释 AST 与前一封存相同；本轮无运行时或 UI 行为变化，不新增浏览器或真实模型验收。

该 schema 只识别当前构建的已知错误码，不验证完整错误 envelope 或 details；TypeScript 详情注解只是诊断参考。源码表仍可扩展，未知新版或插件码保留原诊断；码被识别不代表能力已挂载、权限已授予或可以自动重试。Swift/Kotlin 消费、跨版本互通、统一 Client 呈现与完整 §45 仍未完成，完整目标继续 IN_PROGRESS。

## 无效流数据与显式连接恢复

[历史来源记录](artifacts/upstream-first/invalid-stream-errors-source.json)记录无效 WebSocket 帧、事件就绪信息与交互记录的错误分类。Gateway 保留解析原因和流标识，以 gateway/stream-invalid 终止受影响流；事件代次的验证失败发布 fatal，暂停自动协商直到显式重连。真正的载体断开保留既有重试策略，业务错误和交互回答保留策略不变。共享中英文控件显示 Host 数据不可用，并说明自动重试已暂停。

800 项相关回归、七项隔离真实 Host/Windows Chrome 场景和两项既有 Question 录制回放通过。六个新增场景分别向中英文页面注入无效 JSON、二进制帧及无效交互记录，虚拟浏览器时钟前进 60 秒无自动重连，显式恢复后草稿保留且无 Prompt 提交。既有传输中断仍自动恢复；Question 经 dsh web 完成后与原始录制 Session 比较。中英文截图已视觉检查，不代表物理网络、实际设备、新旧发布版本或真实模型验收。

Host/Client 类型、两份 Client bundle、限定 lint、doc-sync 34/34、六项追踪检查通过。初始测试夹具及构建时序错误已修正，失败日志保留；沙箱 tsx ENOMEM 的 lint 与 dsh 回放在主机原样通过。完整 GUI 聚合未重跑。错误表仍允许领域扩展，§45 跨领域闭合语义及完整呈现、多版本/多语言兼容、后续 Phase 和完整目标均未完成，Session writer 保持 V3。

## 交互回复拒绝与协议不兼容恢复

[历史来源记录](artifacts/upstream-first/interaction-reply-errors-source.json)记录内部 interaction-result RPC 的错误保留。除仍按本地完成处理的 interaction-closed 外，失败 envelope 转为保留 code、message、details 的 RemoteError；协议不支持由既有 Connection 状态机进入 incompatible，暂停自动协商。冲突及未知错误沿用既有恢复策略，不新增重试控制器、协议字段或 Session 事件。

740 项 Gateway、Remotes、Connection 回归与两项真实隔离 Host/Windows Chrome 场景通过。浏览器仅将回复请求的协议版本改为不支持的版本，观察实际 Host 拒绝；界面显示 Update required，虚拟浏览器时钟前进 60 秒无自动协商和回答重放。显式重连后同一待决审批恢复，用户重新拒绝才记录一次 rejected。现有双 Client 冲突和交互关闭场景通过。截图已人工视觉检查；这不是实际新旧二进制升级、物理设备睡眠或真实模型、Tool 执行验收。

Host/Client 类型、Gateway Client 构建、限定 lint、doc-sync 34/34、六项需求追踪与空白检查通过。完整 GUI 聚合未重跑；§45 完整错误语义、呈现与兼容矩阵及后续 Phase 仍未完成，Session writer 保持 V3。

## 共享 Client 错误传播与重连候选刷新

[历史来源记录](artifacts/upstream-first/remote-error-propagation-source.json)记录 16 处共享 Client 回调与命令目录等待的错误传播修复。Prompt、Queue、Stop、子会话重命名、模型、命令、权限、技能、搜索、清单和文件读取保留原始 RemoteError 的 code、details、cause，不再转成丢失结构的普通 Error。Gateway 对未知 Host 码保持原值；这不代表当前 Client 已理解未知语义，也不授予额外能力。

1464 项相关回归、五项真实隔离 Host/Windows Chrome 场景通过。中英文清单页收到受控未知错误时显示现有本地化通用失败，显式重试后读取真实 Loader 清单；未知命令错误显示 Host 原始诊断，执行处理器未运行。现有命令/清单能力撤回、迟到结果和不重放检查也通过。新错误由 HTTP envelope 注入，不是实际新旧应用、其他语言 SDK、原生设备或真实模型验收。

浏览器回归发现重连菜单永久等待，封存的旧命令 bundle 也复现相同结果。定向测试证明相同查询的重新识别会更换命中对象，误使排队刷新失效；修复使用既有菜单查询代次和最新范围，不新增状态机，改查询、关菜单与销毁仍会取代旧工作。修复前后的截图、RPC 状态、负向对照以及构建产物恢复摘要均保留。

Host/Client 类型、受影响 Client bundle、打包 PDF 许可检查、限定 lint、doc-sync 34/34、六项需求追踪与空白检查通过。旧 File 测试夹具补齐文件上传能力，权限夹具改为真实 RemoteError；产品准入未放宽。早期 1317 与 281 项测试包含重复场景，不相加。完整 GUI 聚合未重跑，§45 闭合错误语义、完整错误呈现、兼容矩阵及后续 Phase 继续 IN_PROGRESS。

## 传输中断的统一错误语义

[历史来源记录](artifacts/upstream-first/transport-failure-semantics-source.json)记录 Connection 请求发送/正文读取与 Gateway 逻辑流的故障分类。已识别的请求或正文中断，以及逻辑流载体重试耗尽，均使用 gateway/transport-interrupted；请求携带 endpoint，逻辑流携带 stream，只有实际收到 HTTP 响应时才有 httpStatus。JSON 解码和未识别异常仍为内部错误，取消与 Host 业务拒绝保留原有语义。没有更改请求重试策略、业务错误码或 Session V3。

704 项 Connection/Gateway/Session/Workspace 回归通过，包含先前 229 项定向测试，两组数量不相加。真实隔离 Host 与 Windows/Chrome 用例中断 Prompt 后显示正确错误并保留草稿，替换 WebSocket 后请求数保持 1，显式再次提交才增加为 2，已接受用户消息始终为 0。该用例不调用模型；另一项录制 Prompt 去重回放通过。故障由浏览器控制，不证明真实网络拓扑、独立设备身份、旧版应用或真机。

最终 Host/Client 类型、限定 lint、Node/Client bundle、doc-sync 34/34、六项需求追踪与空白检查通过。初次类型编译因新浏览器用例未划入正确编译面，产生 500 个源码旁生成文件；按未跟踪状态、既有封存、编译时间和 source map 逐个核对后移入保留目录，原源码未改动，Client 目录恢复到先前字节。失败检查和浏览器定位修正记录保留。规格 §45 进入 IN_PROGRESS；跨领域闭合错误语义、本地化呈现、完整兼容与 Phase 2/4–12 仍未完成。

## 子 Agent 按轮次停止

[历史来源记录](artifacts/upstream-first/subagent-interrupt-target-source.json)记录 subagent.interrupt-turn.v1 与 subagents.interruptTurnByParent。Client 每次点击捕获 subagentTiming.active.startSeq；Host 先检查持久父子地址，再匹配仍打开的子级自身轮次。过时、null、不存在或已结束的目标均不取消后续工作，继承的父级轮次也不能授权取消子级。缺少目标时，新 Client 不在声明此能力的 Host 上退回旧操作。Host 不增加父 Agent 在线查询，既有 inbox 保留与 FIFO 恢复语义继续成立。

308 项定向测试与 66 项 Client 回归通过，两组包含重复的五项取消测试，数量不相加。真实 Web 的 10 项子 Agent 对话、1 项能力撤回、3 项 Stop 录制与 5 项 Windows Cordis 回放通过。Stop 录制重发首次已接受请求时，第二轮保持运行；新的点击停止第二轮，既有 UI、转录及 FIFO golden 保持只读。父级离线表现通过目录响应控制，不构成物理断开的父级或 Device Trust 证据。模型响应仍是录制/脚本回放。

Timing checkpoint 版本 3 从既有事件重建目标，Session writer 保持 V3，没有新增 Session 事件或通用 mutation ledger。新的 Remote 声明、受影响 bundle、最终类型、lint、依赖与 Client 包规则通过，doc-sync 34/34 及六项需求追踪校验通过。临时录制文件名已与 V3 头一致，版本校验与仓内 golden 未放宽。旧 interruptByParent、旧普通取消和模型祖先中断保留各自当前活动语义；完整兼容矩阵、设备撤销、handoff 及后续 Phase 仍待完成，完整目标保持 IN_PROGRESS。

## 子 Agent Prompt 重复请求识别

[历史来源记录](artifacts/upstream-first/subagent-prompt-idempotency-source.json)记录子 Agent Prompt 的重复请求处理。Host 复用已有 requestId，在子级自身已接受事件中查找原消息 id；并发 Queue/Steer 重试只入队一次，消费或移除后的请求仍确认原消息。Host 内部 subagentPromptReceipts 投影不进入 Client 快照，并排除 fork 继承的父日志。已结束子级及新运行时中的重复请求在恢复激活前完成确认，不重新启动子级；父级权限和取消检查仍保留。

179 项定向测试通过，覆盖继续执行、权限、移除后重试、新运行时恢复、投影 checkpoint、继承与生成目录。真实隔离 Host/Chrome 的 10 项子 Agent 对话录制用例通过：并发 HTTP 重发返回同一消息 id，冷状态重试前后的完整实际子 Session 日志逐项相等。既有组合 UI golden 未更新，模型响应仍为录制回放，不是 live-provider 验收。受影响构建下的 Windows Cordis 5 项回放通过。类型、定向 lint、构建和 doc-sync 34/34 通过；完整需求追踪的六项校验继续通过。

规格 §17 已进入 IN_PROGRESS，按普通 Prompt、子 Agent Prompt、交互、按轮次取消、条件重命名及后续设备/handoff 操作分别定位证据。clientMutationId 是建议字段；本轮没有增加通用 mutation ledger、Session 事件或 wire 字段，Session V3 保持不变。旧取消、子 Agent 中断、设备撤销、handoff 等仍需分别核验，Phase 3/4 与完整目标仍未完成。现有子 Agent 回放中的旧隐藏输入框断言已对齐当前可见且禁用的加载状态，浏览器路径覆盖和等待路由清理也已补齐；这些测试维护不代表新增产品 UI 行为。

## 交互回答的 Host 归属与迟到确认

[历史来源记录](artifacts/upstream-first/interaction-reply-scope-source.json)记录 Gateway Client 回答保留的范围。应用发现将校验后的 HostId 提供为显式回答 scope；只有 scope、待处理 id 和 revision 均匹配时才重发内存中的回答。缺少 scope 或待处理快照时禁用保留，Host 身份变化后重新请求回答。旧连接的迟到成功或 interaction-closed 确认只能清除其发送的那份回答，不能清除替换 Host 的回答。

267 项 Client/准备/发现测试和 178 项 Host/协议测试通过。真实隔离 Web 的 4 个完整 Question 回放覆盖同 Host 接受前后丢失、认证中断，以及受控更换发现身份后重新作答；原录制与完整 Session 比较保持不变。该身份场景使用一个真实 Host 和受控发现响应，不构成双物理 Host 或 Device Trust 验收。公开类型进入生成的 Cordis Client API 目录后，目录相关 6 项单元测试及构建产物的 5 项 Windows Cordis 完整回放通过。类型、定向 lint、依赖与 Client 包规则通过；初次文档检查发现目录过期，重新生成后 doc-sync 34/34 通过。

回答保留仍仅在内存中，刷新或卸载即丢失，不提供授权或持久化回执。没有增加 Session 事件、wire 字段或通用 mutation ledger，Session V3 保持不变。§17 的 Prompt、定向取消、条件重命名、交互与后续设备/handoff 操作仍需逐项核验；Phase 3/4 和完整目标均保持 IN_PROGRESS，既有安装、原生平台、跨版本及发布缺口仍保留。

## 原规格恢复与完整需求追踪

[历史来源记录](artifacts/upstream-first/specification-traceability-source.json)记录原规格恢复和需求追踪入口。[原始文件](artifacts/upstream-first/original-specification.md)来自本任务首次读取命令的完整日志，恢复字节的 SHA-256 与初始 UPSTREAM_DELTA.json 中的 4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80 完全相同。原外部路径缺失不再阻止需求核验；[恢复回执](artifacts/upstream-first/original-specification-recovery.json)保留来源和输出处理方式。

[逐项追踪记录](artifacts/upstream-first/specification-traceability.json)覆盖 0–80 共 81 个编号章节及全部 1,983 行非空原文，包含嵌套旧能力清单、代码示例、矩阵和未编号的 Gate 1–4。它定位候选证据与剩余工作，保留建议、示例、实验和硬性要求的原文语境。当前是需求核验入口，verificationStatus=NOT_STARTED 表示尚未逐项审查本节全部要求，不表示已有实现被删除，也不授予整节 PASS。

六项校验测试拒绝漏章节、漏原文、改写内容、规格 SHA 不符、非法状态、无证据位置和未经审查的完成声明。顶层审计命令同时核对原规格字节、完整源覆盖及报告状态词汇。生成报告仅使用 NOT_STARTED、IN_PROGRESS、BLOCKED、PASS、FAIL、DEFERRED；历史原始回执保持不可变。架构摘要已区分已验证的协议 2/1 局部路径与尚未完成的完整 N/N-1 矩阵。

完整目标仍为 IN_PROGRESS。Phase 2 的安装/插件/升级/原生平台证据、Phase 3 的完整 Error/Idempotency/兼容矩阵，以及 Phase 4–12 的恢复、共享响应式 UI、诊断、Device Trust、Remote、Native、Lite 和同候选发布均继续保留。源覆盖通过不证明这些功能完成。以下历史增量保留其采集时的结果与限制，当前待办需结合完整规格和各专属矩阵核验。

## 上传完整回放与 Harness home 路径表示

[历史来源记录](artifacts/upstream-first/upload-home-replay-source.json)绑定上传完整 Session 回放修复。文件实际保存在隔离 Harness home，旧比较在序列化后直接替换路径，漏掉 Windows 工具参数中的 JSON 转义以及结果里的斜杠路径。Web fixture 适配器按路径字段、工具参数路径属性与 read 结果的 path 标记处理显式 home token：比较前展开预期，再与真实日志完整比较；录制捕获使用理解 JSON 转义的逆向操作。共享 Session 归一化器不变。

范围处理保留精确 home 根、目录后缀、文件名和读取内容；相邻目录、无关参数与普通文本不被改写。13 项单元及 fixture 代际测试通过，覆盖 Windows 原生和斜杠表示、空格/中文/引号、嵌套工具调用、POSIX 字面反斜杠、保留参数空白和错误路径/内容。两项真实浏览器反向对照分别修改预期结果的文件路径和行内容：六个交互用例仍通过，但完整 Session 比较拒绝错误预期；随后恢复原字节。

最终只读浏览器回归包含上传录制、上传能力恢复和 Windows 原生 Cordis，3 个文件、12 个用例及各套件收尾全部通过。上传使用实际字节持久化与真实 read 工具；能力恢复仍采用受控发现与回复交付；模型输出使用录制回放。原上传和 Cordis 录制、预期文件以及共享归一化器逐项哈希不变，没有刷新黄金文件来绕过差异。Host/Client 类型、范围 Lint、两对文档和 doc-sync 34/34 通过。

本项上传完整回放标为 PASS，复用既有产品构建。本轮没有真实提供商、POSIX 浏览器、设备或安装包证据；早先 GUI 聚合未重跑。后续继续其余 HTTP/UI、变更回执、兼容错误矩阵、原生与后台恢复、Device Trust 和后续阶段。原外部规格仍待恢复，完整需求审计不能据当前通过项缩减范围。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理，总目标保持执行中。

## Windows 原生 Cordis 完整录制回放

[历史来源记录](artifacts/upstream-first/cordis-native-replay-source.json)绑定 Windows 原生组合的完整 Cordis 回放。官方 Web profile 在 Windows 提供 PowerShell，在 POSIX 提供 Bash；两者模型可见提示词与工具 schema 不同。驱动按实际 Host 平台选择独立 header class，Windows 新增自己的 V3 Session 与完整预期文件，POSIX 原有各代录制和固定文件保持不变。没有修改产品 profile、工具提示词或快照归一化器。

Windows 新归属通过相同已录制模型轮次和真实工具、审批与浏览器生成。审查确认：V3 Session 和 UI 预期与原 POSIX 文件逐字节相同，提示词仅替换 shell 退出说明，工具 schema 仅将 Bash 换成 PowerShell，其余工具逐项相同。随后在只读 replay 模式运行，五个用例与整套收尾均通过，完整持久化 Session、完整提示词、完整工具 schema 和 UI 均严格比较，运行前后 fixture 哈希不变。

两项反向对照分别故意修改 Windows 预期提示词和 PowerShell schema；每次五个交互用例通过但整套在对应固定值比较处失败，恢复原字节后完整回放通过。该对照证明没有跳过或放宽请求头检查。语料归属与存储策略 3/3、Host 类型、范围 Lint、两对文档同步及 doc-sync 34/34 通过。本增量复用上一阶段的 Client 构建，不声称新增产品构建或执行了 PowerShell 中止行为。

本项 Windows 完整回放标为 PASS；先前将 POSIX 固定值用于 Windows 的失败保留为历史证据。这不代表 POSIX 本轮实测、真实模型提供商、Windows CI 矩阵或完整 GUI 聚合通过。上传完整 Session 的 harnessHome 差异与其他阶段仍待处理；Phase 3、Phase 4 和完整目标保持 IN_PROGRESS。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理。

## 动态 Cordis UI 与真实浏览器连接恢复（回放仍有失败）

[历史来源记录](artifacts/upstream-first/dynamic-cordis-ui-source.json)绑定清单、面板和 @pluginId 补全的 Connection 归属。无清单支持时不发起读取、不注册入口；只读清单不显示变更控件。Run、Approve、Decline、Stop 和 Remove 分别检查必需操作，拒绝请求不依赖启动能力。每次连接代际变化都替换面板与补全源，即使能力相同；旧读取、回调和补全选择不能修改替换状态。迟到 Remove 不能移除新行，迟到 Stop 不能改变新面板的选择或发布错误。已记录工具卡片仍由 Session 派生。

真实隔离 Host 与 Chromium 场景通过，发现声明和 Stop 回复交付受控，模型调用数为零。场景实际执行纯 Host 启停、双半部加载、拒绝与移除，核对完整变更调用顺序。只提供请求确认时，待审批请求在重连后从清单恢复且仍可拒绝；重连卸载 Client 激活、不自动重放，显式运行才重新加载。Stop 已被 Host 接受但回复尚未交付时断线，旧确认释放后新面板仍保留另一版本选择和输入草稿。这不证明 Host 变更回滚、真实模型提供商、原生设备或跨平台行为。

相关测试为 18 个文件、386 项通过；Host/Client 类型、范围 Lint、生成目录、两个 Client 包构建、依赖刷新及 doc-sync 34/34 通过。最初浏览器失败分别来自空 Session 不在侧栏、零尺寸标记的可见性等待，以及第一次 Stop 未收完回复就重连；驱动分别补充已落盘会话、等待标记挂载和响应完成检查，严格取消计数仍为 1。

录制模型 Cordis 回放在沙箱内遇到 EPERM realpath，使用原命令进行宿主重试后五个用例通过，但整套仍因 system-prompt pin 失败：当前 Windows 进程退出说明与既有录制不同。没有刷新录制 Session、提示词固定文件或放宽归一化来消除差异。因此本阶段整体保留 IN_PROGRESS，浏览器能力验收通过不等于完整录制回放通过。既有上传完整 Session 回放失败和 GUI 聚合 5657 通过、3 失败、1 跳过未重跑。

87 个已选业务 Remote 与 2 个发现引导方法的分类保持不变。后续仍需处理完整回放差异、其余 HTTP/UI 与变更回执、兼容错误矩阵、原生和后台恢复、Device Trust 及后续阶段；恢复原方案外部文件后才能完成逐项需求审计。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理，完整目标保持执行中。

## 动态 Cordis 操作准入与 Client 运行时撤回（部分完成）

[历史来源记录](artifacts/upstream-first/dynamic-cordis-runtime-source.json)绑定十二项独立动态 Cordis 操作声明，分别覆盖清单、Host 启动、Client 代码、请求确认、用户结算、停止、移除、inspect 清单与响应、两类失败报告以及调用。每项已选 Remote 在派发前检查精确能力，不以插件清单或普通 Session 控制支持替代。能力不改变 Session 归属、精确运行身份、人工批准与 Host 原有校验，也不使变更具备重试幂等性。

Client 用户双半部运行在首次 Host 激活前检查其必需操作集合；模型驱动的运行要求对应请求确认支持。连接撤回清除旧批准与失败状态，使旧编排步骤失效。迟到的 Host 启动、代码获取、Client 加载与结算结果不再触发后续请求，也不能清除相同 Plugin 的替换尝试。加载引擎清空已加载视图、撤销排队加载，并保留拆除与替换加载的逐 Plugin 顺序；旧 host.call 闭包不能访问新连接。迟到激活会先清理，再允许新加载完成。已被 Host 接受的激活不回滚。

inspect 撤回取消活动查询和排队清单，保留本地 provider 注册。新发布链不等待旧的停滞发布；旧查询结束时只有仍持有该请求 controller 才能清理，避免释放相同 ID 的替换请求。服务销毁后停止查询与发布。不支持的清单和诊断报告不探测 Host。

本阶段为源码、单元行为、类型、Lint 与构建证据：359 项测试通过，Host/Client 类型、范围 Lint、相关构建与依赖检查通过，四对文档同步后 doc-sync 34/34 通过。两次文档失败分别发现配置目录中的源码行号过期及对应中英文配对未同步，均已按生成目录与配对流程修复并保留日志。没有运行新的动态 Cordis 浏览器场景或录制会话快照。

静态清单为 87 个已准入业务方法、2 个发现引导方法、0 个未分类方法；这不证明完整 HTTP/UI 或重连恢复验收。动态 Cordis 面板的独立按钮准入、旧回调隔离、清单撤回、迟到变更回执，以及真实 Host/browser 和录制会话覆盖仍未完成，当前阶段明确标为 IN_PROGRESS。Windows 文件上传完整 Session 快照差异和既有 GUI 聚合失败仍保留；原方案外部路径仍需恢复后才可完成逐项审计。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或使用子代理，完整目标继续执行。

## 插件清单能力与设置页的连接归属

[历史来源记录](artifacts/upstream-first/plugin-inventory-capability-source.json)绑定 plugin.inventory.v1 只读能力、Host 取消读取和设置页注册生命周期。缺少声明时不注册插件列表标签、不探测 Remote；Client Gateway 也在派发前检查声明。能力不授予 Loader 或预设变更权限，不增加历史、变更订阅或第二套缓存。

每次连接拥有独立标签注册与组件身份；替换连接即使声明相同能力，也取消旧读取并丢弃旧搜索、预设选择、卡片展开和菜单状态。保留的旧回调在派发前拒绝，迟到结果不能覆盖替换页面。恢复后按需读取当前 Host，独立输入框草稿保留。Host 在检查前及等待预设发现完成后检查取消，取消请求不返回清单，但不声称中止 roster 内部发现过程。

真实隔离 Host 浏览器用例读取实际 Loader 行，控制发现声明及首次读取的响应送达。首次响应暂留后移除旧行、安装新行，再以相同能力重连；旧请求取消，新页面读到新行，旧响应释放后保留新搜索与展开状态。随后撤回入口并恢复，页面状态清空、输入草稿不变。共三次读取、一次取消，不调用模型。最终构建复验通过，不代表真实模型提供方或原生设备验收。

155 项定向测试通过，Host/Client 类型、范围 Lint、相关构建、依赖和 51 个 Client 包检查通过。四对文档与生成目录同步，doc-sync 34/34 通过。初始类型检查发现 list 未声明取消参数，已补齐 Host 方法与生成 Remote 后通过；该失败日志保留。

已选 Remote 清单推进到 75 个已准入、2 个发现引导、12 个待分类方法，剩余均为动态 Cordis。Windows 文件上传完整 Session 快照差异仍未修复；既有全 GUI 聚合 5657 通过、3 失败、1 跳过也未重跑。原方案外部路径当前不存在，已请求新路径，最终完成审计必须取得原文后逐项核对。Session V3 不变，未提交、推送、发布、迁移用户数据、改变自启动或调用子代理，完整目标继续执行。

## 文件上传能力准入与草稿、回执的连接归属

[历史来源记录](artifacts/upstream-first/file-upload-capability-source.json)绑定独立的 file-upload.stage.v1 声明。生成 Remote 与原始字节载体均在起始连接内准入，缺少能力时不读取 Blob、不创建 Worker、不探测上传端点；连接撤回或服务卸载取消载体，旧进度和回执不能发布到替换连接。共享的能力缺失错误由 Gateway 声明，上传服务不反向依赖应用 Remote 组装。Session 归属、字节存储和回执消费仍由原有 Host 服务负责，能力声明不替代授权。

输入框撤回活动与排队上传，也使已经完成的回执失效，同时保留浏览器 File 对象、图片和文本草稿。能力恢复不会自动重新上传；用户显式点击重试后才暂存到当前连接。缺少能力时本地文件命令显示为图片，选择器筛选图片，普通文件接收被本地拒绝，失败卡片保留移除操作但隐藏重试。选择器回调绑定打开时的 Host；普通消息与命令附件序列化均拒绝跨连接完成。

真实隔离 Host 浏览器用例控制发现声明及原始上传响应送达，不调用模型。原生选择器验证图片独立接收、旧选择器拒绝，以及已完成回执、两个活动上传和一个排队文件的撤回。Host 实际接受前三次上传，旧响应释放不恢复回执，排队文件未派发，支持恢复后仅显式重试产生第四次请求。用户草稿保留；已存储字节不回滚。

360 项定向测试通过，Host/Client 类型、范围 Lint、相关构建、依赖与 51 个 Client 包校验通过，五对文档和生成目录同步后 doc-sync 34/34 通过。初始类型引用缺失导致的 112 个源码旁编译产物，均通过报错路径、Git 与归档排除、生成时间和 source map 核对，并按字节哈希备份后逐个清理。夹具、Lint、选择器、Chromium 缺失和 sandbox ENOMEM/EPERM 的失败日志保持可查。

完整回放仍有明确未通过项：宿主运行中，上传恢复用例和原有模型回放合计七项断言通过，证明字节持久化、真实 read 工具执行与浏览器展示；套件收尾的完整 Session 快照比较因 Windows 原生及斜杠路径没有匹配既有 harnessHome 占位符而失败。未修改归一化器或刷新黄金文件来绕过该差异，不能宣称完整回放通过。没有真实模型提供方或原生设备验收结论。

已选 Remote 清单为 74 个已准入、2 个发现引导、13 个待分类方法。后续继续插件清单与动态 Cordis，并保留 Windows 完整回放、HTTP/UI 矩阵、变更回执、兼容错误、后台恢复、Device Trust 与后续阶段。未重跑全 GUI 聚合，既有 5657 通过、3 失败、1 跳过状态保留。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍未完成。

## Feedback 能力准入与跨连接反馈隔离

[历史来源记录](artifacts/upstream-first/feedback-capability-source.json)绑定消息反馈读取、写入、删除以及 Session 备注记录的四项独立能力。Client Gateway 在派发前检查对应声明；消息 CAS 变更还需要读取支持以取得当前版本。Host 原有的 Session 归属、目标消息校验、版本冲突与持久化保证保持，Session 备注仍只确认日志追加，不承诺落盘刷新或幂等重试。带文本的 Host 反馈命令继续由命令执行能力单独准入。

缺少消息读取能力时不显示入口、不探测列表；只读评分以静态图标呈现，提交与撤回分别要求 put 和 delete 支持。Session 弹窗独立要求 record 能力。Connection 撤回立即清除反馈版本、队列请求归属、弹窗草稿与提示，保留独立消息输入框草稿。排队操作在等待前捕获 Host，旧读取不能释放替换请求，旧 put/delete 回执不能改写新版本，旧对话框成功或失败不能关闭新草稿或发布旧 toast。传输拒绝变为可显式重试的失败；同一连接内主动关闭草稿后的成功确认语义保持。

真实隔离 Host 浏览器用例播种一条已完成助手消息，不运行模型。受控发现声明验证无能力、只读、独立 put/delete/record，以及未提交对话框撤回。一次真实 put 在 Host 提交后暂留响应，连接替换取消送达；新连接独立打开的反馈草稿在旧回执释放后仍保留，没有旧提示。随后实际撤回评分并记录一次 Session 反馈；日志恰为一次 message-put、一次 message-delete 和一次 feedback/record，变更请求也各一次，无自动重放。该证据不说明已接受变更可回滚，也不证明真实提供方或原生设备行为。

Feedback 领域、UI、控制器与弹窗、代际竞态、Remote 准入和 Client 纯度共 284 项测试通过。最终构建后的真实 Host 浏览器复验通过，Host/Client 类型、范围 Lint、相关构建、依赖检查和 51 个 Client 包校验通过。七对双语文档及生成目录已同步，doc-sync 最终 34/34 通过。初始夹具、销毁后上下文访问、Lint、sandbox ENOMEM 和源码别名位置错误均保留失败日志；源码别名已放在手写区域，未修改生成器来豁免检查。

已选 Remote 清单推进到 73 个已准入方法、2 个发现引导方法、14 个未分类方法。后续继续文件上传、插件清单和动态 Cordis 操作与消费者；完整 HTTP/UI、变更回执、兼容错误矩阵、后台恢复、Device Trust 和其余阶段仍未完成。未重跑全 GUI 聚合，既有 5657 通过、3 个 Windows sandbox/前提失败、1 跳过的状态不变。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍在执行。

## Subagent 能力准入与目录、输入、中断的代际归属

[历史来源记录](artifacts/upstream-first/subagent-header-source.json)补充目录不可用时的标题回退：普通 Session 标题由 Conversation 页眉持有，Subagent 插件只为子会话保留文字，避免重复显示父级标题。35 项 Subagent UI 测试、增强后的真实 Host 浏览器场景、Host/Client 类型检查、局部 Lint 与 Client 构建通过。浏览器同时复验目录和提示词撤回、草稿保留、独立 Stop 与一次持久化中断。该局部修正没有重跑下述 925 项回归和 doc-sync；两者保留为已绑定的核心增量证据，完整目标仍未完成。


[核心增量来源记录](artifacts/upstream-first/subagent-capability-source.json)绑定 subagent.catalog.v1、subagent.prompt.v1、subagent.interrupt.v1 三项独立能力及 Client Gateway 操作准入。能力声明只表示 Remote 支持，持久父子归属、在线激活与提供方校验仍由既有领域层负责，提示词和中断没有新增幂等重试承诺。

目录撤回清除缓存、打开菜单、刷新请求归属与父级可用提示，保留持久子级地址、已选驻留 Session 和草稿。目录响应同时绑定起始 Host 和请求槽位，旧结算不能发布旧内容，也不能移除替换连接的新请求。输入区分别解析 Send 与 Stop 能力；保留的 Stop 回调不能跨 Host 或子级地址调用，图片编码期间替换连接会阻止子级提示词派发，旧 prompt 和 interrupt 回执不发布新连接错误或确认状态。

真实浏览器验收发现：父级目录提示被撤回后，旧布局等待逻辑会无限隐藏整个输入区，包括仍可用的 Stop。修复后驻留输入框保持可见，未知父级可用性继续禁用发送，Stop 独立可用，草稿保留。提示语也区分仅缺少发送能力与同时缺少发送、停止能力，目录动作缺失时仍保留身份文字。

真实隔离 Host 启动实际可继续子级，模型调用通过脚本化回放保持等待，发现响应受控撤回目录和提示词能力。浏览器最终验证一次实际 Stop 请求、一次持久化 aborted 轮次、零提示词请求，恢复支持后没有新轮次或自动重放。这是受控模型输出下的真实运行时和浏览器集成证据，不是真实提供方、原生设备或权限边界的完整验收。

最终选定回归为 925 项通过、1 项跳过，共 52 个文件；另一次修正 Connection 夹具后的 159 项复验与其部分重叠，不相加为独立测试总数。真实 Host 浏览器用例通过，Host/Client 类型、范围 Lint、相关构建、依赖声明和 51 个 Client 包校验通过。双语 README、能力决策记录、浏览器说明及生成目录已同步；初始文档聚合的事件图来源行号过期已修正，最终 doc-sync 34/34 通过。初始夹具、选择器、布局、构建过滤和 sandbox 失败保留记录；realpath EPERM 与 tsx ENOMEM 通过最小宿主权限重跑解决，没有放宽产品权限检查。

已选 Remote 清单为 69 个已准入方法、2 个发现引导方法、18 个未分类方法。下一步继续 Feedback、文件上传、插件清单和动态 Cordis 操作集及消费者；完整 HTTP/UI、变更回执、兼容错误矩阵、后台恢复、Device Trust 和后续阶段仍未完成。未重跑全 GUI 聚合，原 5657 通过、3 个 Windows sandbox/前提失败、1 跳过的状态保持。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍在执行。

## Goal 能力准入与目标栏代际归属

[历史来源记录](artifacts/upstream-first/goal-capability-source.json)绑定 Goal 读取、创建、编辑、暂停、恢复、完成与清除的独立能力声明，以及既有 Client Gateway 的请求准入。领域层继续负责 Agent 归属、revision/CAS 和状态转换校验；能力表示对应 Remote 的支持，不替代授权，也不改变命令与模型工具各自的调用策略。

目标栏要求 goal.read.v1，各操作还要求对应能力。缺少读取能力时不探测 API、不显示目标栏；只读 Host 保留目标信息而不提供变更按钮。激活源订阅已有 Connection 代际源，撤销时立即清除旧激活状态，忽略旧读取与无能力期间的事件。动作回调捕获起始 Host 身份，拒绝保留回调跨代际派发，旧成功或失败回执也不能成为新连接的操作结果。传输拒绝被转换为可显式重试的本地错误。

替换权限快照为 GoalBar 提供新的组件 key，明确丢弃旧 Host 编辑器和等待动作状态，消息输入框草稿保持。真实隔离 Host 浏览器用例播种 active 但 disarmed 的 Goal，分别验证无能力、只读、仅编辑及完整支持。真实编辑先提交，暂留 HTTP 回执因重连取消；随后新打开的编辑器草稿在旧回执释放后仍保留，消息草稿不变，持久事件只有 create、edit，没有自动重放。该结果不证明回滚已接受变更，也不涉及真实模型提供方执行。

Commands 浏览器用例增加了连接变更提示的结算屏障，再断言提交文本保留；该用例与 Goal 真实 Host 用例均通过。原 GoalBar keyless 回放最初因缺少 Playwright 默认浏览器而未启动；启动器改为读取既有 DSH_PLAYWRIGHT_EXECUTABLE_PATH 后，两项回放及 fixture 清单检查通过，active/inactive 原有快照不变。keyless Connection fixture 与真实 Host 场景分别记录，未混为实际后端验收。

Goal 领域、UI、代际竞态、Gateway 准入、Connection fixture 与 Client 构建边界共 245 项测试通过。Host/Client 类型检查、范围限定 Lint、相关 Host/Client 构建、51 个 Client 包边界检查及依赖检查通过；新增 Connection 类型依赖只更新一个 UI manifest 和锁文件。中英文 README、能力决策记录、浏览器说明和配置来源行号已同步，doc-sync 34/34 通过。初始 Lint 与旧回放浏览器启动失败日志保留。

已选 Remote 清点为 66 个已准入方法、2 个发现引导方法、21 个未分类方法。后续继续 Subagent、Feedback、文件上传、Host inventory 和动态 Cordis 操作集及消费者，完整 HTTP/UI、变更回执、兼容错误矩阵、后台恢复、Device Trust 与其余阶段尚未完成。未重复全 GUI 聚合，既有三个 Windows sandbox/前提失败仍不标绿。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍未完成。

## Commands 能力准入与代际归属

[历史来源记录](artifacts/upstream-first/commands-capability-source.json)绑定 Commands 目录和执行能力声明、Gateway 准入以及 Client 连接切换处理。command.catalog.v1 与 command.execute.v1 分别由已有命令注册表所有者声明；没有目录能力时不发探测请求，仅有目录能力时不提供可执行 Host 行。独立 Client 贡献项保留自身可用性，Host 装饰要求当前可执行描述符。

Command UI 订阅已有 Connection 代际源，连接撤销时立即清理候选、关闭弹窗并结束等待目录的 Enter 操作。保留的候选和输入提交回调绑定起始 Host 身份，不能在同样具备能力的新连接上执行；旧执行回执不发布本地完成事件，分离执行的旧失败也不产生过时通知。当前提交因连接变化拒绝时保留草稿与附件并提示显式重试。传输取消仍由 Gateway 负责，未引入第二套连接生命周期。

真实隔离 Host 与 Chromium 的五阶段预期输出匹配：无能力、仅目录、完整能力、执行后撤销、恢复且不重放。测试命令处理器真实运行一次，发现能力声明与 HTTP 回执延迟受控；断连后原提交文本保留，恢复后执行请求及处理器次数仍各为一。该验证不代表回滚 Host 已接受的操作，也不是 live-provider、原生 OS 或设备验收。

命令注册表、UI、目录、弹窗、Remote 准入与 Connection fixture 共 320 项测试通过，Client 构建边界另有 25 项通过。完整 Host/Client 类型检查、范围限定 Lint、相关 Host/Client 构建、51 个 Client 包边界检查及 doc-sync 34/34 通过。构建只允许精确的 Commands 能力声明入口，负用例仍拒绝 Host 实现和任意子路径。

初始能力子路径映射、测试错误结果字段、浏览器用例编译归属、Client 内联声明及 Lint 失败日志保留。错误的 Client 编译归属产生 552 个源码目录编译文件；清单记录创建时间和哈希，核对其未跟踪状态及工作区范围后保存字节并逐个清理，未修改已跟踪的 vendor 源码。tsx 的 sandbox 用户信息 ENOMEM 启动失败按相同命令进行 Host 窄范围重试。

本轮未重复 GUI 聚合，上一封存增量仍为 5657 项通过、3 项 Windows sandbox/前提失败、1 项跳过，不能声称全 GUI 通过。已选 Remote 描述符清点为 59 个已准入方法、2 个发现引导方法、28 个未分类方法；接下来继续 Goal、Subagent、Feedback、文件上传、Host inventory 与动态 Cordis 的操作集和消费者，以及完整 HTTP/UI、兼容错误矩阵、变更回执、后台恢复、Device Trust 和后续阶段。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动，完整目标仍未完成。

## Session 原生 Remote 入口收敛

[历史来源记录](artifacts/upstream-first/session-native-retirement-source.json)绑定无生产 Client 调用方的 Session 原生 Remote 入口移除。canOpenWorkspacePath 查询已删除；openWorkspacePath 保留为 Host 本地方法，与既有 workspaceDesktop 一起服务声明文件所有者。Client 原生文件操作仍使用 presentedFiles 的持久化文件坐标，由其所有者负责 Session 授权、文件系统到 Host 的路径验证与原生策略；没有增加并行的任意路径入口或兼容别名。

生成的 Client Session 类型排除这三个辅助方法名，Connection fixture 同样拒绝调用。真实隔离 Host 验证匿名请求为 401、已认证旧路径为 404、Gateway 直接派发为 gateway/invocation-unavailable。测试以空路径作为防副作用哨兵：若入口回归，响应将不再满足 404 断言，也不会意外启动原生应用。现有交付文件菜单七阶段快照仍精确匹配，草稿及种子 Session 日志不变；桌面元数据与成功原生响应受控，不构成 OS 应用启动验收。

Host 原生适配器、生成 Client 类型、fixture 派发、认证及文件预览 10 个测试文件 153 项通过。Host 本地打开、显示位置、失败和取消行为的 9 项测试通过；本地派发前保留调用方的原始 abort reason，文档与生成目录已明确此异常语义。UI 预览的负断言针对当前 presentedFiles 原生操作，继续证明预览只进入侧栏。生产源码和 Python 中没有保留旧 Session 原生 wire 调用。

Host/Client 类型检查、范围限定 Lint、相关 Host、Client 和 Cordis 工具目录构建通过。初次 doc-sync 为 33/34，差异仅为 Workspace files 配置来源行号；同步中英文对侧后完整聚合 34/34 通过，最后的 Cordis 目录检查确认 99 个生成文件或区域新鲜。双语包文档、Session API 文档与仍有效的 Sidebar 归属记录已同步；原 Sidebar 记录修改前的字节另行归档。

GUI 汇总为 5657 项通过、3 项失败、1 项跳过。失败仍是 Windows 文件符号链接前提、sandbox 用户目录访问与原生对话框 worker；后两项在上一封存增量的 Host 窄范围复核通过，本轮未重复不受修改影响的系统验证。最终符号链接拒绝断言仍未执行，GUI 汇总不标为通过。初始本地测试转换中的 helper import 错误及配置目录失败均保留日志。

重建的已选 Remote 描述符清点为 57 个已准入方法、2 个发现引导方法、30 个未分类方法。后续继续 Commands、Goal、Subagent、Feedback、文件上传、Host inventory 和动态 Cordis 操作集及消费者；完整 HTTP/UI 覆盖、兼容与错误矩阵、变更回执、后台恢复、Device Trust 和后续阶段尚未完成。Session V3 不变，未提交、推送、发布、迁移用户数据或改变自启动。

## Settings 代际撤销与权限默认值保存

[历史来源记录](artifacts/upstream-first/settings-generation-repair-source.json)绑定 Settings 镜像即时撤销、权限默认值保存的 Host 归属检查和旧设置测试夹具修复。Settings 所有者直接订阅 Connection generation；连接撤销立即清除共享文档和写入权限，不等待重连完成。权限默认值要求当前代际已接受的描述、读写能力和可写 provider；旧选择不能发送给替换后的 Host，旧成功或错误不能发布到新镜像。

新连接可独立保存而不等待旧连接的延迟响应；旧请求不重放，已提交的 Host 写入不回滚。销毁拒绝新选择并等待已发出的写入结束，销毁后的保留回调也不会读取已撤销的 Context。当前代际的传输错误保留在行状态中，用户可显式重试。测试夹具补齐明确的 Settings 能力与 Connection 订阅，没有放宽生产准入。

Settings、权限、主题、语言及相关消费者 14 个测试文件 156 项通过；最后的权限控制器与销毁回归 17 项通过。GUI 汇总为 5654 项通过、3 项失败、1 项跳过，原先主题、语言和权限设置失败及 5 个未处理错误已消除。剩余用户目录访问和原生对话框 worker 失败有 sandbox EPERM/ENOMEM 证据；两个测试在 Host 原样复核通过。最终文件符号链接测试仍在创建链接时遭遇 Windows EPERM，未进入拒绝断言，GUI 汇总不标为通过。

最终构建的浏览器验证 2 个文件 3 项通过：七阶段快照覆盖可写、旧保存等待、发现前撤销、只读恢复、可写恢复、新保存以及旧响应释放；保留输入草稿，没有自动重放操作。两次权限变更都由隔离真实 Host 写入 settings.yaml。能力描述受控，首次真实变更响应被延迟；不能把此场景称为跨设备或安装产物验收。冷启动仍只发出一次 Settings describe，既有发现准入场景也通过。

Host/Client 类型检查、Client 构建、范围限定 Lint、51 个 Client 包声明检查、依赖策略和 doc-sync 34/34 通过。初始夹具遗漏、测试参数化、异步销毁 Lint 和浏览器未先选择 Workspace 的失败保留日志；修正后的浏览器使用正常目录选择流程。Windows 用户目录读取与原生对话框打开后中止仅构成两个 provider 行为的窄范围实测。

后续继续核实未使用的 Session 工作区原生 Remote 暴露，处理其余 32 个未分类的已选 Remote 方法及全部 HTTP/UI 消费者，再完成兼容与错误矩阵、变更回执、后台恢复、Device Trust 和后续阶段。Session V3 未变；没有提交、推送、发布、迁移用户数据或改变自启动。完整 Goal 仍为进行中。

## Session 搜索与附件读取的独立能力准入

[历史来源记录](artifacts/upstream-first/session-extra-capabilities-source.json)绑定 Session 搜索和持久化图片读取的独立能力声明。session.search.v1 与 session.attachment.v1 由既有 Remote 所有者提供，Gateway 统一执行准入和连接代际取消，不增加第二套连接生命周期。附件读取仍须通过 Session 日志引用授权。

Workspace 搜索在缺少能力时保留本地标题与 Workspace 匹配，不发出内容查询。连接代际撤销会清除内容结果并取消待完成查询；能力恢复后重读当前查询。同能力的新 Host 代际也会使已完成的旧结果失效。查询文本、已选 Session 和输入草稿不因这些变化被改写；旧响应和旧错误不能恢复结果。Workspace Host 信息订阅改为即时的 generation 通知。

相关准入与 Workspace 测试 270 项、Host 搜索与附件授权测试 42 项、Gateway 准入及代际取消测试 26 项、Connection fixture 测试 47 项通过。隔离真实 Host 的浏览器文件 5 项通过，四阶段快照覆盖能力均缺失、仅搜索、仅附件、两者均具备；内容查询只在具备搜索能力时发出。真实 Gateway 拒绝匿名和 schema 无效的搜索、附件请求，种子 Session 日志和草稿未改变。发现描述受测试控制，搜索响应来自真实 Host。构建 Client 的图片装配回放 4 项通过；该回放使用受控 fixture 图片，并补齐 fixture 已实现的 Workspace 能力声明，不等同于真实 Host 附件字节传输验收。

Host/Client 类型检查、相关构建、范围限定 Lint、差异检查与 doc-sync 34/34 通过。Windows sandbox 的 tsx 启动出现 uv_os_get_passwd ENOMEM，相关命令经窄范围 Host 重试通过。初始 Connection 夹具、类型、箭头函数格式、图片测试配置和 Workspace fixture 声明失败均保留日志。

GUI 汇总没有通过：5626 项通过、21 项失败、1 项跳过，并有 5 个未处理错误。PDF 打包许可证检查补齐 Windows pnpm 路径后单独通过；主题、语言、权限设置夹具与原生/系统前提失败仍待处理。九个失败测试文件与本轮前归档或基线一致；此文件比对不证明运行时行为未变，也不能确认各失败的引入时间。没有把 GUI 汇总失败计为通过，也没有完成原生设备验收。

已选 Remote 描述符清点为 57 个有准入的方法、2 个发现引导方法、32 个未分类方法。这不是全 HTTP/UI 覆盖。后续先处理已发现的设置测试问题，核实 Session 工作区原生接口的 Remote 暴露，再继续 Commands、Goal、Subagent、Feedback、文件上传、Host inventory 和动态 Cordis 能力。兼容与错误覆盖、变更回执、后台恢复、Device Trust 及后续阶段仍未完成。Session V3 保持不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 交付文件的原生 Remote 操作与能力准入

[历史来源记录](artifacts/upstream-first/native-file-actions-source.json)绑定交付文件的原生接口迁移、Client 准入及超时依赖分类修正。既有 ui-deliverables 所有者通过生成式 presentedFiles Remote 提供 desktop、open、reveal，分别声明独立能力。两条旧原生 HTTP 路由已移除，真实 Gateway 的认证和严格参数校验继续负责入口，不增加第二个能力注册表。

Client 仅在声明元数据能力时读取桌面信息，每个原生菜单项还要求对应操作能力和当前代际已接受的桌面信息。缺少条件时移除入口，侧栏预览独立保留。连接替换取消元数据与操作请求、清除临时确认状态并拒收旧结果，不自动重放用户操作。Host 保留持久 Session 声明、当前文件、分叉工作目录及进程路径映射验证；销毁等待尚未结束的适配器，适配器忽略取消并迟到返回成功时也拒绝确认。错误信息不泄露私有 Host 路径。

相关测试 8 文件 210 项通过，单独排除一个无法创建真实符号链接的用例；该用例的 Host 原样复核仍在创建链接时返回 EPERM，尚未到达拒绝断言。依赖策略、Gateway 交互及超时回归另有 3 文件 110 项通过。TimeoutReason 的类身份要求通过共享 peer 依赖保留，既有两项 Gateway 导入分类问题已修正，没有增加可重复安装的安全豁免。Client 包规则检查通过。

最终构建上的两个浏览器文件 10 项通过；原有 POSIX 原生命令场景的两个用例在 Windows 上按原规则跳过。七阶段快照精确比较元数据缺失、只有动作、只有元数据、仅打开、仅显示位置、撤回和恢复时的菜单数量。真实隔离 Host 验证匿名请求拒绝、负索引和不符合 schema 的参数拒绝，以及旧路由 404；草稿与完整种子 Session 保持不变。原生桌面元数据及成功操作响应由测试控制，未启动系统默认应用，不构成原生设备或安装产物验收。

Host/Client 类型检查、范围限定 Lint、Host 与 Client 构建、依赖分类、Client 包检查及最终 doc-sync 34/34 通过。初始迁移 fixture、类型链接、编解码器依赖、生成目录说明与类型归属问题已修正；初次 doc-sync 为 32/34，补齐服务职责分类、配置目录和双语对侧后全部通过。失败日志保留。离线安装最初因沙箱无法访问 pnpm SQLite 存储失败，Host 原样重试成功；未运行安装脚本。

静态比对已选入 BFF 的构建 Remote 描述符：55 个方法有能力准入，2 个是发现引导方法，34 个仍未分类。该清点不调用业务接口，也不涵盖所有 HTTP 路由和 UI 消费者。后续处理 Session 的 search、attachment、canOpenWorkspacePath、openWorkspacePath，以及 Commands、Goal、Subagent、Feedback、Host inventory 与动态 Cordis 的操作集和消费者。完整兼容与错误覆盖、变更回执、后台及原生恢复、Device Trust 和后续阶段仍未完成。Session V3 与模型指引不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 文件、会话与技能的独立发现能力

[历史来源记录](artifacts/upstream-first/reference-discovery-source.json)绑定三类 Host 发现声明、Gateway 请求准入及 Client 消费者。fileReferences/list、sessionReferenceResolver/candidates、skills/list 分别要求自己的能力，不通过失败请求探测功能。文件和会话来源仍负责引用序列化；撤回发现能力不撤回独立可用的文件预览。

InputTrigger 的候选失效订阅独立于名称词表，连接变化立即取消旧查询、清空候选和面包屑，随后刷新当前菜单并重试去重预热。程序化入口保持单一来源，来源移除或销毁会释放订阅并取消排队刷新。文件和会话查询丢弃旧 Host 响应；技能缓存与连接代际绑定，迟到请求不能恢复旧名称或预览。缺少技能能力时保留已输入的文字及 Host 调用语义。

最终相关测试 13 文件 341 项通过，最终构建上的两个浏览器文件 9 项通过，包含原有引用编辑回放、既有文件预览场景和新增独立发现场景。六阶段快照比较实际文件、会话、技能候选数量；缺少能力时没有对应发现请求，文件引用可继续预览，技能文本在撤回和恢复后保持不变，两个完整种子 Session 的事件保持不变。浏览器使用隔离真实 Host、真实发现提供者及受控能力声明，不替代真实模型、原生设备或安装产物验收。

Host/Client 类型检查、范围限定 Lint、两个 Host 所有者和五个 Client 构建、doc-sync 34/34 通过。初始卸载回调错误、来源路径别名遗漏、测试类型及 Lint 问题、空目标 Session 不显示的浏览器 fixture 已修正，失败日志保留。tsx 路径生成器受沙箱 ENOMEM 限制，原样 Host 重试成功；初始构建过滤只选中 Node companion，最终改为明确选择五个 /client 产物后验证浏览器。

仓库依赖分类检查仍有两项失败：Gateway 的 deadline 与 timeoutOf 导入未被策略分类。源码与本轮前归档一致，策略与 HEAD 一致；此项作为已有未通过结果保留，没有将整套检查报告为通过。下一步处理该分类问题、原生文件菜单发现及剩余能力清单。完整兼容与错误覆盖、变更回执、后台及原生恢复、Device Trust 和后续阶段仍未完成。Session V3 不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 工具、产物与正文的文件预览准入

[历史来源记录](artifacts/upstream-first/transcript-file-previews-source.json)绑定工具路径、产出文件标签、显式交付卡与收尾正文的预览入口。它们通过既有 Chat、Tool 和 Turn-tail props 共用当前查看器查询，没有新增文件探测请求。查看器撤回时保留文件名、工具结果展开与持久内容，撤回预览按钮和正文链接；保留回调在执行前再次检查。嵌套工具调用经相同查询更新。

显式交付卡移除不可用的卡面预览及左侧预览按钮，保留文件说明和独立的原生菜单；选择原生操作后的焦点在没有预览按钮时回到菜单按钮。原生路径不可用且没有当前查看器时，不再建议使用不存在的侧栏预览。原生操作本身的发现和准入仍属于后续工作。

初始包测试为 769 项通过、19 项失败：18 项是旧的 Client 组合 fixture 未提供查看器注册表，修复后的六个相关文件 128 项通过；嵌套路径和提示补充测试两文件 23 项通过。剩余一项原有 Host 测试在创建临时文件符号链接时返回 EPERM，宿主复核仍相同，尚未到达符号链接拒绝断言；该项保留为受权限限制的未通过证据，没有记为整套通过。

最终构建的三个浏览器文件共 4 项通过，包括原有文件行布局、正文精确匹配和两项能力场景。新增四阶段快照精确比较工具、产出文件、交付卡、正文的实际按钮数量，并核对草稿与完整种子 Session 不变；不可用、恢复、撤回、再恢复均通过，可用时逐个入口能打开内容。原生桌面元数据和 422 拒绝由测试控制，没有启动系统默认应用。原有两个浏览器入口仅增加既有本机 Chrome 选择约定。

Host/Client 类型检查、范围限定 Lint、三个 Client 及目录所有者构建、doc-sync 34/34 通过。早期 fixture 类型遗漏、测试局部变量遮蔽 Node process 和测试查询参数错误均已修正并保留初始日志。浏览器结果是隔离真实 Host 加受控能力声明，原生拒绝是受控响应；不替代真实模型、安装产物或设备权限验收。

下一步处理 Host 的 fileReferences、skills、sessionReferenceResolver 操作声明与消费者、原生文件菜单发现及剩余能力清单。完整兼容/错误覆盖、变更回执、后台/原生恢复、Device Trust 和后续阶段仍未完成。Session V3 不变，没有提交、推送、发布、迁移用户数据或修改自启动。

## 输入框及已发送消息的引用预览准入

[历史来源记录](artifacts/upstream-first/reference-previews-source.json)绑定 Composer、InputTrigger、文件引用、技能和 Chat 的改动。预览入口查询当前 Sidebar 查看器，技能还要求该 Session 的目录已缓存提供方路径；查询和冷点击均不发起目录请求或保留延迟打开。来源、词表和查看器变化会更新可用性，实际打开时再次检查。不可预览的已发送引用显示为标签。临时可用性不进入草稿序列化或 Session 日志。

Chat 通过框架绑定的可观察值更新引用按钮，多个读者共享订阅，最后一个读者离开后释放订阅。可选 InputTrigger 服务的挂载与卸载会更新技能入口。连接替换仍按原有目录规则失效缓存，正常菜单发现重新加载后才恢复技能预览；草稿、技能调用和引用序列化语义保留。

相关单元测试涉及 72 个文件、1028 项。初始集合为 1024 通过、4 失败，失败均来自旧的局部控制器 fixture，且有一项关联的未处理错误；补齐后两个失败文件的 106 项全部通过，后续技能 fixture 调整另有 26 项通过。范围限定 Lint、Host/Client 类型检查、六个 Client 构建、目录所有者构建与 Web shell 构建通过。文档总检初次为 33 项通过、JSDoc 检查失败；补齐三个说明项后单独重跑该门禁通过，没有把这描述为总检重新运行。

最终构建上的两个能力浏览器用例通过，其中新增场景验证不可用、恢复、撤回、再恢复，草稿和 Session 日志不变。原有引用流程最初因 Windows 临时路径在 ARIA 中转义而有一项差异；仅补充该场景已知路径的精确替换后，原有 6 项回放通过，golden 和共享规范化器未改。Question 首轮的子进程因沙箱 uv_os_get_passwd ENOMEM 未启动；相同用例在宿主环境通过，完整 22 条 Session 与工作区比对一致。受控能力声明配合真实隔离 Host、单元生命周期测试和无 Key 回放分别记录，不作为真实模型或原生设备验收。

工具行、产物文件卡片及正文链接仍需审查查看器可用性；Host 的 fileReferences、skills 和 sessionReferenceResolver 操作声明、剩余能力清单、完整兼容/错误矩阵、变更回执、后台/原生恢复和 Device Trust 等后续阶段未完成。Session V3 不变，没有提交、推送、发布、迁移用户数据或修改系统自启动。

## 文件列表与文档渲染器能力准入

[历史来源记录](artifacts/upstream-first/file-ui-capabilities-source.json)绑定文件树、文档预览和 Sidebar 注册表的改动。只有 Host 声明列目录能力时才注册 Files 入口；不能被当前查看器认领的文件仅显示名称。文本分页与完整字节读取分别决定预览器选项，HTML 另外要求关联文件读取。仅完整读取可预览图片/PDF，无需文本读取；文件预览也不要求列目录能力。

文件树和文档注册属于已准入 Host 快照。连接替换会取消旧请求、丢弃旧内容 store，并通过新注册重新读取保留的 tab。单元测试分别证明迟到列表/文本结果不写入、保留回调不再请求，以及旧 HTML 关联文件结果被拒绝。渲染器注册变化通过 subscribeAvailability 通知 Sidebar 类型快照，使文件行更新动作而不替换 tab；订阅启动失败会回滚类型。

47 个文件中的 452 项相关测试通过。最终构建后的两项真实 Host 能力浏览器用例通过，分别验证文件资源恢复与列表/文本/图片/HTML 子集；观测到缺失能力对应的请求为零。既有完整文档预览回放也通过，覆盖 Markdown、隔离 HTML、固有尺寸图片、PDF、代码分页与 Copy，原 fixture 和 golden 未改。Question 回放继续比较完整 22 条 Session 与工作区。最终类型、范围限定 Lint、三个 Client 构建、打包 PDF 许可证检查及文档总检 34/34 通过。

初次 PDF 打包检查缺少 Windows npm_execpath，最终使用已核验的本地 pnpm.cjs。完整预览最初无法启动缺失的缓存 Chromium，改为遵循已有本机 Chrome 选择约定；随后发现系统剪贴板将 LF 转为 CRLF，最终用已知源码先测得系统表示，再精确比较产品 Copy 结果。两项能力用例在包含该启动失败的集合中已通过；完整预览随后独立通过。初始失败日志与截图均保留，不把失败集合描述为整体通过。

新浏览器文件最初误入 Client 编译范围，失败编译于 00:10 在源码旁生成 1092 个输出。已逐项验证未跟踪状态、生成时间、source map、源码对应与工作区路径后归档并移走，字节及清单保留。测试现由 Host aggregate 检查，Client face 明确排除；最终类型检查通过且这些生成路径未重现。先前 native 生成文件未移走。

文件引用、技能和对话记录中的文件入口仍需审查当前查看器可用性；其他能力、完整兼容/错误覆盖、变更回执、后台/原生恢复、Device Trust 及后续阶段未完成。真实浏览器、受控迟到结果、无 Key 回放和未验收的原生/设备权限分别记录。Session V3 不变，没有提交、推送或迁移用户数据。

## 文件操作能力与元数据资源恢复

[历史来源记录](artifacts/upstream-first/file-capabilities-source.json)绑定 Workspace Files 的七项独立操作声明、API Remotes 派发前准入及文件资源生命周期。元数据、列目录、文本分页、字节窗口、完整读取、关联读取与变更观察分别协商；支持一项不意味着支持另一项，也不授予文件系统权限。

Client 仅在 Host 声明 stat 能力时注册文件资源。每次连接快照替换会取消旧注册、移除旧元数据，并为仍被持有的资源重新 stat。缺少 changes 能力时只读取一次元数据，不打开变更流；能力存在时沿用共享 Session 流及 ready 顺序。等待前驱释放期间已取消的后继流不会再发送请求。保留回调与迟到结果不能作用于替代 Host。

相关测试 253 项通过，6 项 Windows 符号链接用例显式跳过。首次集合与宿主原样重试都在这六项创建符号链接时得到 EPERM；另一个旧重叠关闭预期已更新为验证取消后不再打开流。符号链接访问检查尚未在本机通过，本轮不把它们计入验收。

真实隔离 Host 浏览器用例通过：无能力和撤回期间元数据及变更流请求为零；仅元数据模式可读取文件，并在连接替换后发现断连期间的实际文件写入；恢复观察能力后收到真实写入版本。测试显式发出 fs/observed 事件，不代表 OS 文件监听或真实模型执行。最终截图确认文件预览保留已加载内容，元数据重新取得。完整 Question 回放比较原 fixture 的 22 条 Session 记录及工作区，类型、范围限定 Lint、受影响构建和文档总检 34/34 通过。

初次浏览器配置未选中用例、空 Session 没有侧栏、直接写入未发观察事件、误以为 reload 是 disabled、连接状态包含隐藏测量标签等失败日志全部保留。最终用例在已有内容的真实 Session 上点击受保护的 reload，并用请求观察确认撤回后不派发。纯声明模块的精确打包例外通过反向测试拒绝实现包与嵌套路径；配置目录更新了源码行号并确认双语配对。

文件列表、预览渲染器与关联文件入口的按能力隐藏和内容读取生命周期仍待完成。其余能力所有者、完整兼容与错误覆盖、变更回执、后台和原生恢复、Device Trust 及后续阶段继续推进；Session V3 不变，没有提交或推送。

## 目录选择能力与 Gateway 连接恢复

[历史来源记录](artifacts/upstream-first/directory-capabilities-source.json)绑定原生目录选择、目录浏览和目录创建三项独立能力。Host 根据生命周期内稳定的后端种类声明实际支持的操作；未知扩展后端不声明现有操作集。API Remotes 在派发前逐项检查，Workspace 管理能力不能替代目录能力。

原生与浏览 Client 只在对应能力存在时注册入口。浏览仍可用而创建缺失时，隐藏新建文件夹并保留已有目录选择。目录回调捕获已准入 Host 和所属注册生命周期；连接替换或注册释放会取消读取与原生请求，拒绝旧回调和迟到结果。已派发的目录创建可能已经提交，不能据此承诺回滚或变更回执。

1088 项相关单元与组装测试通过。14 项真实浏览器回归包含两个能力用例和全部 12 项 Workspace 管理用例。目录用例实际创建文件夹后替换连接，观察到待响应请求取消、磁盘目录保留、旧交互没有继续列目录或注册工作区；恢复后通过新操作显式接纳目录，并等待其 Session 被选中。原生选择的实际 OS 对话框、Device Trust 和打包桌面不属于本轮验收。

浏览器选中态断言暴露了实际的 Workspace 投影丢失：Host 已保存两个目录及各自 Session，Client 却把新 Session 显示在 Ungrouped，且丢失原有工作区。限定复测在第二次失败后停止；两个确定性 Gateway 用例在修复前失败。Gateway 现在按 ConnectionGeneration 的数字 id 约束流打开与帧交付，丢弃旧连接的 Remote/carrier 失败及迟到帧，并为新连接重置独立重试预算。同连接重试上限不变，未分类本地错误仍终止流。旧测试中持续撤回健康替代连接的 fixture 已纠正。

修复后相关测试、14 项浏览器集合及四次限定目录复测全部通过。最终录制 Question 回放比较完整 22 条 Session 记录与工作区，保持原 fixture。最终类型、范围限定 Lint、受影响 Host/Client 构建和文档总检 34/34 通过；失败截图、观察记录与修复前日志保留并绑定。

初次浏览器失败来自空工作区可编辑态等待、对已取消请求等待正常响应，以及异步查询未等待；已改为观察实际状态。重复连接辅助函数被合并为共享状态。会话中断期间的浏览器和文档检查缺少完整结果，保留了部分日志及 Windows 启动退出码；确认旧句柄和相关进程不存在后重跑，最终以明确退出结果为准。

workspaceFiles、其余能力入口、完整兼容与错误覆盖、变更回执、后台和原生恢复、设备信任及后续阶段仍未完成。先前 GUI 聚合失败和跨平台缺口保持记录；没有提交、推送、迁移用户数据、更改自启动或更改 Session V3。

## Workspace 能力与连接替换

[历史来源记录](artifacts/upstream-first/workspace-capabilities-source.json)绑定 Workspace Controller 的跟随、注册表管理和 Session 组织三项独立能力。Host 通过既有 Typert 绑定声明支持，API Remotes 在派发前检查对应操作集；Session 管理能力不能代替 Workspace 的任何一项能力。

Client 在能力未知时等待，明确缺少跟随支持时进入 unavailable 且不发送跟随请求。连接替换清除旧行、归档集合、排序依据与删除标记；六类写操作的迟到响应返回 gateway/cancelled，不覆盖新投影。Gateway 独自负责流等待与恢复，移除了连接准入时重复的领域重启。

UI 按能力撤回注册表菜单、拖拽、归档与目录接纳入口，已有 Session 仍可浏览，没有操作的行不显示空菜单。Host 快照替换关闭管理弹窗、清空目录流程并忽略旧回调与旧结果；恢复不重新打开旧交互。不可用投影不会清除已保存的工作区展开偏好。已经派发的 Host 请求不因此取消或回滚。

318 项相关测试通过；清理误生成文件和修正测试后，4 个受影响文件的 63 项测试再次通过，计数与前述集合重叠。真实浏览器验证三项能力分别撤回、缺失时无跟随请求与旧行，以及恢复后一次真实重命名。既有 Workspace 管理 12 项回归全部通过。录制 Question 恢复比较完整 22 条 Session 记录和工作区，保持原 fixture 不变。

Host/Client 类型、范围限定 Lint、受影响构建和 doc-sync 34/34 通过。文档总检先于最后的测试专用 Chrome 路径调整，最终类型与该文件 Lint 覆盖此调整。初轮 4 项跟随流失败由重复重启导致，已通过后续完整集合验证修复；源码旁四个编译产物已留存诊断副本并清除。既有浏览器回归首次因默认 Chromium 未安装而全部跳过，改用项目已有的可选 Chrome 路径后 12 项通过。所有初次失败日志保留。

能力声明为受控过滤，业务调用使用隔离真实 Host；这些证据不等于真实模型提供方、原生目录选择、打包桌面、Device Trust 或多 Host 验收。DirectoryPicker、workspaceFiles、其余能力清单、兼容与错误覆盖、变更回执及后续阶段仍未完成。原有 GUI 聚合失败和跨平台缺口不被本轮结果替代。完整目标继续进行，没有提交、推送或更改 Session V3。

## Web-search 凭据与插件卡片保存

[历史来源记录](artifacts/upstream-first/web-search-capabilities-source.json)绑定 Web-search 凭据入口和共享卡片保存生命周期。卡片只在当前命名空间已接受且元数据能力存在时读取凭据；写入能力缺失时隐藏密钥字段，提供方只读时则保留禁用字段。普通配置不依赖凭据能力，可写凭据也独立于只读 Settings 文档。缺失或被拒绝的元数据不能推出可写，已有旧密钥不能把被拒绝的写入变为成功。

Connection 替换释放旧 Web-search 控制器和观察者并清空草稿，保留回调不能写入另一个 Host。同一引用只接受最新元数据响应。共享表单在命名空间失效或销毁后停止未发出的保存步骤，迟到结果不能替换新状态；保存成功只移除本次提交的编辑，保留等待期间的新输入。已经派发的请求不能据此声称被取消或回滚，变更回执语义仍待完成。

180 项相关单测通过。实际浏览器验证 Web-search 能力组合、普通设置持久化、未提交密钥丢弃和恢复后的显式合成密钥保存；密钥只进入隔离凭据存储，没有进入 Settings、DOM、ARIA、控制台或截图。既有插件配置 7 项回归通过，启动读取预算 1 项通过；录制 Question 恢复验证完整 22 条 Session 记录及工作区保持原 fixture。搜索端点没有被调用，这些证据不代表真实提供方或设备权限验收。

插件配置首轮 3 项失败源自写死的 60000ms 默认值及其连带预期；当前 Windows PowerShell 所有者声明的是 120000ms。用例改为从首次 Host 元数据读取默认值，再验证编辑、丢弃和恢复，完整 7 项通过，原界面 golden 未改。最后该测试的类型导入从 Client 装配改为 Settings 所有者的纯类型出口，Host/Client 类型与限定 lint 通过；检查范围内没有误生成的源码旁编译产物。

受影响 Client bundle、API 目录和 doc-sync 34/34 均通过。文档总检发生在最后的浏览器默认值与类型导入调整之前，该测试调整另经最终类型和 lint 复验，没有重复总检。初始测试、类型、lint 和浏览器失败日志保留。

剩余能力所有者与入口清单、完整兼容和错误词汇、Device Trust、后台与原生恢复、变更回执及后续阶段继续进行。原有 GUI 聚合失败与打包桌面、跨平台验收缺口不因本轮结果而消失。没有提交、推送或更改 Session V3 格式。

## Models 与凭据能力控制

[历史来源记录](artifacts/upstream-first/models-capabilities-source.json)绑定 LLM 提供方目录、端点模型发现、凭据元数据及凭据写入四组能力声明。实际 Host 绑定声明支持，Gateway 派发前检查对应所有者能力；Settings 写入不能替代凭据写入，任何声明都不提供密钥读取 API，也不代替提供方权限检查。

Models 入口要求提供方目录和 Settings 读取支持。缺失凭据元数据能力时停止补充读取；缺失凭据写入或模型发现能力时分别隐藏对应控件，普通配置仍可编辑。提供方只读与 API 缺失保持区分，前者继续显示禁用控件。没有密钥输入时，页面改用中英文配置说明。

Connection 替换清除旧目录与命名空间，关闭编辑器并丢弃未提交凭据草稿。编辑器回调绑定发起时的 Host，旧回调与迟到结果不能在新 Host 上继续第二步写入；同一代次的失效通知保持草稿。没有新增连接控制器或 UI 运行时值导出。

扩展单测集合 632 项通过，唯一失败来自新 LLM 所有者测试使用错误的清理方法。改为释放实际插件句柄后，该完整文件 88 项通过，计数有重叠。早期只读 UI 预期失败促使实现恢复了既有禁用控件行为。最终浏览器集合 3/3 通过，覆盖 Models、预设及单次启动读取；另外首次引导与录制 Question 恢复各通过 1 项。完整 22 条 Session 记录和工作区保持原 fixture。草稿只使用临时合成值，截图在其清空后保存，能力用例没有发送凭据变更或端点发现请求。

最终 Host/Client 类型、Host/Client 构建与 API 目录通过。最后限定 lint 仅要求新 JSON 预期值显式标注 unknown，修正后完整浏览器文件通过复验。doc-sync 为 33/34，唯一失败是事件关系图中 LLM 源码指针从 72 行变为 73 行；重新生成英文、同步中文并通过图表和全部 824 个双语配对检查，未重复总检。初始失败日志保留。

Web-search 设置中的凭据编辑器及其他能力消费者、完整兼容与错误覆盖、Device Trust、后台和原生平台恢复仍待完成。本轮证据不能替代真实模型、真实端点、设备权限或打包桌面验收。总目标继续进行，没有提交、推送或更改 Session V3 格式。

## Settings 共享读取与跨连接状态

[历史来源记录](artifacts/upstream-first/settings-mirror-source.json)绑定共享 Settings 镜像、命名空间写入队列与配置文件入口。尚未完成 Host 发现时保持加载状态；明确缺少读取能力时不发请求并标记不可用。启动只在能力准入后发起一次共享 describe。Connection 替换清除旧文档与修订号，有效可写性同时要求 Settings 写入能力与提供方可写。

写入必须基于当前连接已接受的命名空间。初始读取前的操作被跳过，用户需显式重试；排队操作绑定发起代次，旧队列与迟到结果不能写入或更新新连接，也不能带入旧修订号。配置文件入口同时要求当前元数据与文档打开能力，恢复能力不会自动打开系统文件。

相关单测 449 项通过，另有 1 项既有预期失败。两个真实 Web 用例通过，验证能力撤回与恢复以及单次启动读取；首次引导用例验证显式确认持久化、合成凭据只写入和配置后重载，没有模型调用。录制 Question 恢复用例验证完整 22 条 Session 记录和工作区与原 fixture 一致。能力组合由测试过滤实际 Host 发现响应，原生打开由既有测试覆盖层关闭，不能据此认定原生平台已验收。

最终 Host/Client 类型、限定 lint、受影响 Client bundle 和 API 目录通过。doc-sync 总检为 33/34；唯一失败是浏览器测试的可选 Chrome 路径显式传入 undefined，不符合精确可选字段类型。修正后完整 doc-typecheck 门禁通过，未重复总检。早期 fixture、旧行为预期及类型失败日志保留；测试计数不跨轮累加。

本地主题、语言选择与非 loopback 的内存设置保持既有行为。Models 直接编辑操作、凭据能力声明与 UI、其他能力所有者、Device Trust、兼容矩阵与跨平台恢复仍待完成；完整目标继续进行。没有提交、推送或更改 Session V3 格式。

## Settings 操作能力与预设偏好控制

[历史来源记录](artifacts/upstream-first/settings-capabilities-source.json)绑定 Settings Controller 所有的读取、写入、配置文档打开及预设目录四组能力。Gateway 在派发前检查对应操作集，预设目录或管理能力不能替代 Settings 能力。共享声明放在独立纯协议模块；UI 从应用外观获取其类型，没有新增 Client 运行时值导出。

预设页面在 Settings 写入不受支持时禁用选择器策略和默认项，并显示本地化说明。保留回调不写 Settings，也不触发空白 Session 的预设同步。目录能力缺失时不查询目录打开器、不显示位置操作；支持复制的 Host 仍可复制预设，完成后不会调用缺失的目录 API。恢复后，现有 hook 更新控件。

初始相关单测集合 270 项通过；新增覆盖后的集合 272 项通过、1 项因英文 locale 下使用中文内置名称的测试选择器失败。仅修正选择器后，完整界面测试文件 41 项通过，计数有重叠。两个真实 Web 用例验证了实际 Host 声明、缺失能力组合、私有目录中的真实预设复制，以及恢复后的路径显示和默认项持久化。原生打开由既有测试覆盖层关闭，未启动系统文件管理器。额外录制 Question 用例经过实际 Host 401 后恢复，完整 22 条 Session 记录及工作区与原 fixture 一致。

最终类型、限定 lint、Host/Client bundle 及 API/slot 生成目录通过。doc-sync 总检为 33/34；唯一失败是新增 import 使配置目录源码行号从 36 变成 37。已重新生成英文并同步中文，配置目录门禁与全部 824 个双语配对复验通过；未重复整个总检。初始失败日志保留。

能力声明只表示 API 支持，不保证提供方存在、可写、原生桌面可用或设备权限；Host 具体操作继续执行原有检查。Gateway 已覆盖 Settings 声明的方法，通用 Settings、Models、配置文档和凭据等入口的能力 UI 仍未完成。Device Trust、跨平台兼容与错误词汇、后台恢复及其他阶段继续进行；本轮不提供真实模型、打包 Desktop 或原生平台验收。

## Agent Preset 能力声明与入口准入

[历史来源记录](artifacts/upstream-first/preset-capabilities-source.json)绑定预设目录、选择与管理三个独立能力。Host 通过原有 Remote 绑定声明，Client Gateway 在派发前检查共享的方法集合。新增纯协议声明模块的精确允许项，没有新增 UI Client 运行时导出，也没有放宽跨插件实现导入限制。

目录能力缺失时，Settings 入口撤回，不发送名单或目录打开器探测。目录已声明但调用失败仍报告错误。选择能力缺失时丢弃暂存选择，管理能力缺失时隐藏复制、删除并关闭待确认草稿；只读目录继续可用。连接代次变化时关闭旧查看器与管理草稿，旧响应不能恢复它们，迟到的 Settings 写入不能把预设选择带到新连接代次。历史任务继续使用已记录的预设标签。

相关单测集 232 项通过，最终受影响的管理控制器与迟到操作用例 50 项通过；两组存在重叠，不相加为独立测试总数。最终两个真实 Web 用例通过，分别验证控制发现声明下的能力组合和实际 Host 声明。额外录制 Question 用例经过实际 Host 401 与重新发现后完成，完整 22 条 Session 记录及工作区与未修改 fixture 一致。最终类型、限定 lint、相关 bundle、生成目录及 doc-sync 34/34 通过。

初始验证暴露了旧 Client bundle、测试缺少可写目录、选择器不完整以及旧查看器未随连接代次关闭的问题，失败日志均保留。新增浏览器用例最初遗漏 Client 编译排除项，导致 548 个忽略产物生成于源码旁；已核对创建时间、路径、版本控制状态与哈希，仅将这些产物移入隔离目录，并将用例归属修正为 Host 编译。相邻测试还补齐了既有 Gateway 协议归属及 Session 取消、重命名能力的过时预期。录制子进程在沙箱内因 tsx ENOMEM 失败，按同参数宿主重试通过。

本轮能力组合测试控制的是发现声明，不证明设备权限。Settings 偏好、目录操作及其他入口仍需独立能力声明；跨平台错误词汇、Device Trust、后台恢复、打包 Desktop 和原生平台矩阵仍未完成。没有真实模型验收；既有 GUI 聚合失败不被本轮结果覆盖。Phase 3、Phase 4 与总目标保持进行中。

## HTTP 拒绝语义与取消优先级

[历史来源记录](artifacts/upstream-first/http-failure-semantics-source.json)绑定一元 HTTP 请求失败的统一表达。Connection 在实际非成功响应上保留数值状态，Gateway 将 401、403、503 及其他状态分别映射为 gateway/authentication-required、gateway/permission-denied、gateway/host-not-ready 和 gateway/transport-interrupted，均含 endpoint 与 httpStatus。不会从异常消息推断状态，未分类载体异常仍为 gateway/internal，Host 业务错误继续透传。

活动 401 自身触发代际取消时，失败请求保留认证代码；调用者或贡献项取消仍优先。请求派发前和响应到达后检查取消，因此已取消请求不发送，取消后的迟到响应不成为新的认证失败。403 不推断设备撤销，单次 503 不使已就绪连接整体失效，也不触发业务请求自动重放。

185 项 Connection、Gateway 和测试运行时消费者测试通过。403/503/502 使用真实模块组合中的受控 Response 验证；三个录制浏览器场景验证实际 Host 401 下的发现、Prompt 和已完成回答恢复，完整 22 条 Session 记录及工作区与 fixture 一致。最终类型、限定 lint、目录生成、相关 bundle 和文档门禁 34/34 通过。

首次 bundle 因跨 Client 插件运行时导入被纯度门禁拒绝，最终只共享类型与结构标记，识别函数归 Gateway 本包，无新增 Client 运行时导出或规则豁免。初始构建及 lint 失败日志保留。本轮没有证明真实 Host 403/503 故障、完整跨平台错误词汇、设备授权、自然过期、打包 Desktop 或真实模型；既有 GUI 聚合失败仍保留。Phase 3、Phase 4 与总目标继续 IN_PROGRESS。

## Connection 认证中状态

[历史来源记录](artifacts/upstream-first/authenticating-phase-source.json)绑定 authenticating 状态及真实 Host 检查。Host 发现通过 Connection generation source 的进度回调，在 host/describe 检查访问权限前显示认证中，响应成功后回到首次 connecting 或重试 reconnecting，再等待事件 ready 帧。没有增加认证请求、凭据展示或第二套控制器。就绪、取消、替换之后的进度被忽略，慢握手提示不会被后续进度提前清除。

Gateway 在调用发现回调前记录本次尝试是否从首次 connecting 开始，允许初始连接等待认证；重试显示 authenticating 时仍在发送前拒绝新业务操作，恢复后不重放。状态 listener 同步停止、重连或离线的路径有定向回归。展开侧栏和收起轨道都提供本地化认证提示、无障碍说明及重连操作。

官方 Web profile 暂停前两次真实 host/describe 请求，分别观察首次与重连认证中状态，并验证首次认证前没有业务请求；随后完成原 Question，22 条完整 Session 记录和工作区与 fixture 一致。最终构建还通过原连接阶段和真实 401 回答恢复两项场景。六个定向测试文件首次 277 通过、14 失败，原因是旧 Gateway 替身缺少必需的 Connection.state；修正后 Gateway 122 项通过。最终慢握手保护及相邻 TestClient、Settings 消费方 86 项通过。类型、限定 lint、相关 bundle、目录生成和文档门禁 34/34 通过。旧类型与 lint 失败日志保留。

第 18 节仍缺有 Device Trust 生产与执行支撑的 device-revoked；统一错误语义、完整兼容与平台矩阵、后台/休眠恢复仍待完成。本轮不代表设备授权、自然过期、真实模型、打包 Desktop 或跨平台验收，也不替代既有 GUI 聚合失败。Phase 3、Phase 4 和总目标继续 IN_PROGRESS。

## 认证暂停期间的回答完成、竞争与取消

[历史来源记录](artifacts/upstream-first/authentication-resolution-source.json)绑定四项新增浏览器场景。Question 回答被 Host 接受后丢失确认并移除 Cookie，重新发现得到真实 401；另一个场景让独立认证的 Client 在原页面暂停恢复期间提交不同答案。两者重新认证后都不重发原回答，Host 保持唯一结果；竞争场景额外拒绝迟到的旧答案。两项完整 22 条 Session 记录及工作区与原 fixture 一致。

Approval 与 Question 的取消场景在首次回答得到真实 401 后，由独立 Cookie context 中的 Client 通过公开 RPC 取消原回合。重新认证后没有重发旧答案，审批副作用文件不存在，持久化终结原因是 aborted。新回合拒绝旧答案与重复旧取消，仍可提交新决定并 completed。这两项采用本地模型 fixture、持久事件断言和文件检查，不冒充完整录制 Session 比较或真实模型验收。

新增 4 项、相邻 Question 3 项和原有取消 4 项共 11 项浏览器测试通过，类型、限定 lint 与文档门禁 34/34 通过。首次旧取消筛选全跳过，修正筛选后实际运行 4 项；两处回调括号 lint 失败已修正，原日志保留。未修改运行时源码和构建产物，既有 GUI 聚合失败没有被本轮覆盖。

这批证据不覆盖自然 Cookie 到期、设备角色与撤销、OS 休眠或移动后台；也不将浏览器内存回答保留升级为持久化回执。第 18 节仍缺 authenticating 与有实际授权执行支撑的 device-revoked，统一错误语义及完整平台矩阵仍待实施。Phase 3、Phase 4 与总目标继续 IN_PROGRESS。

## 认证失效期间保留的 Question 回答

[历史来源记录](artifacts/upstream-first/answer-authentication-source.json)绑定真实 Host HTTP401 后的已完成回答恢复证据。官方 Web profile 场景在回答送达前移除浏览器 Cookie，将请求转发给真实 Host 并取得 401。客户端显示未认证并暂停恢复；重新使用启动链接认证并手动重连后，Gateway 只为 Host 再次投递的匹配 pending id 和 revision 重发内存中保留的回答。

用户只提交一次回答，HTTP 回答请求共两次，Host 最终只记录一次工具调用和一次结果；完整 22 条 Session 记录及工作区与原 fixture 一致。原有 discovery 与 Prompt 认证场景同时回归通过，Prompt 仍需显式重新提交。本轮没有修改运行时代码，类型、限定 lint 和文档门禁 34/34 通过；既有 GUI 聚合失败保留，不以本轮测试替代。

本项覆盖 Host 接受回答之前的 Cookie 缺失。接受后丢失确认、认证暂停期间取消或其他 Client 竞争、自然过期、设备撤销仍无本项证据；内存保留不跨刷新，也不是持久化回执。authenticating、设备授权执行、HTTP503 与平台兼容性矩阵仍待完成，Phase 3、Phase 4 及总目标保持 IN_PROGRESS。

## 首次连接、就绪、离线与重连

[历史来源记录](artifacts/upstream-first/connection-phases-source.json)绑定同一个 Connection controller 的 connecting、ready、offline、reconnecting 状态。首次获取 source 前发布 connecting；状态回调同步停止、重连或离线时重新检查生命周期，停止后的微任务不会获取 source。Gateway 只允许首次 connecting 等待就绪，恢复期间的新业务调用在发送前拒绝，不排队等待未来连接。Settings 的展开侧栏与窄栏均显示本地化状态及操作；不同语义标签按自身内容确定宽度，同一按钮悬停时保持尺寸。

官方 Web profile 录制场景暂停真实 ready 帧，依次观察首次连接、就绪、真实浏览器离线、恢复重连。离线推进 60 秒没有新 socket；恢复后完成原 Question 与回答丢失恢复，完整 22 条 Session 记录及工作区与未修改 fixture 一致。四种状态截图已人工查看。

292 项定向测试首次运行有 1 项旧 assembly 预期失败，修正为首次 connecting 不提前发出 workspace/follow 后，该文件 12 项通过；另补强停止后不获取 source 的回归并通过。类型、限定 lint、相关 bundle、文档门禁 34/34 通过。旧浏览器的 launcher、首次 Prompt、连接恢复 3 项通过：首次 Prompt 的旧 ARIA 依赖前序编辑器清空操作，单独筛选时会出现 paragraph 差异；恢复测试现在等待 discovery 后真实事件订阅再关闭 socket，保持精确重试次数和原有 golden。

GUI 聚合为 5549 通过、1 跳过、3 失败：Windows 符号链接 EPERM，以及两个代码高亮用例超过 5 秒。代码高亮未改实现和超时，整文件独立复跑 19 项通过；聚合仍记失败。早期错误的包过滤名和测试 lint 路径保留在日志，已补运行正确包构建和真实文件检查。

authenticating、设备撤销及其授权执行、认证失效期间已完成交互回答恢复、HTTP503 分类及完整平台兼容性矩阵仍未完成。浏览器证据使用 Windows Chrome 和录制模型数据，不代表打包 Desktop、真实模型或跨平台验收。Phase 3、Phase 4 和总目标保持 IN_PROGRESS。

## Host 就绪等待与硬期限恢复

[历史来源记录](artifacts/upstream-first/host-readiness-source.json)绑定 host-not-ready 状态及等待提示。握手达到现有告警阈值或更早的硬期限仍未收到 ready 帧时发布此状态；它不推断延迟原因。告警不取消当前尝试，同一代次仍可就绪。硬期限取消 source 后等待清理，再复用唯一重试调度替换连接。已取消 source 的迟到 ready 被忽略，状态回调可重入停止、重连或离线。

官方 Web profile 的两项录制用例暂停第一个真实 ready 帧：慢握手用例在提示出现后释放，原 socket 就绪；超时用例保留该帧，自动替换后的第二个 socket 就绪。展开侧栏和窄栏提示均有截图，进入就绪前没有业务请求。随后完成 Question，每项 22 条持久化记录及工作区与未修改 fixture 一致。

117 项定向测试、两个浏览器场景、Host/Client 类型、限定 lint、相关 bundle 和文档门禁 34/34 通过。上轮文档及 GUI 运行被中断；原日志保留，通过只读进程查询确认停止后，仅重跑未完成项。GUI 聚合实际为 5545 通过、1 跳过、2 失败：未修改的文件打开测试创建 Windows 符号链接时报 EPERM，代码高亮懒加载测试超过 5 秒。后者未改源码或超时，独立复跑通过，但这不能证明聚合稳定性或整套通过；依赖与 lockfile 不同步告警保留。

本轮没有验证 HTTP503 分类、真实模型、打包 Desktop 或跨平台行为。首次连接、认证中、ready/offline/reconnecting 的完整区分，设备撤销，认证失效中的已完成交互回答恢复，以及完整兼容性矩阵仍待完成。Phase 3、Phase 4 和总目标保持 IN_PROGRESS。

## 认证恢复结论的范围

[历史来源记录](artifacts/upstream-first/authentication-scope-source.json)明确认证恢复的“不自动补发”证据针对 Prompt。Connection 自身不重新提交失败请求；Gateway 独立拥有已完成交互回答的保留与重试。认证失效期间交互回答的恢复仍需单独验证，不能从 Prompt 场景推导。该澄清只修改三组双语文档；运行时代码、构建产物、浏览器观测与比较文件均核对为未变，文档门禁 34/34 通过。下节运行时证据保持有效。

## HTTP 401 认证失效与显式恢复

[运行时来源记录](artifacts/upstream-first/authentication-source.json)绑定 auth-expired 状态及恢复提示。浏览器 HTTP 请求在发出前捕获连接代次；真实 401 仅撤回仍活动的原代次并暂停自动恢复。旧代次或已取消请求的迟到 401 不能中断替换连接。403 不被解释为认证过期或设备撤销。UI 提示通过 Host 当前启动链接重新认证，再显式重连，不展示凭据。

两个录制场景通过官方 Web profile 与真实 Host 运行。移除 Cookie 后，重新发现的 host/describe 和提交的 session/prompt 分别返回真实 401。初次提交场景先遇到预设查询 401，观测记录保留；最终场景把已拦截的 Prompt 经清空 Cookie 的同一浏览器请求上下文发给 Host，明确断言该修改端点拒绝。新标签页执行原有认证交换，原标签页手动重连。恢复后先等待并断言 Prompt 请求数量不增加，再显式重新提交，最终 22 条完整持久化记录和工作区与原 fixture 一致。

定向 112 项测试通过，最终设置文案组件测试 24 项通过；两个最终浏览器场景通过并复核截图。Host/Client 类型、限定 lint、相关 bundle、文档门禁 34/34 及最终等义文案的双语对应检查通过。GUI 聚合为 5542 通过、1 跳过、1 失败，仍是未修改的文件打开测试创建 Windows 符号链接时 EPERM；不能称整套通过。

Cookie 移除证明统一 401 路径，不代表等待凭据自然到期、设备撤销或原生登录验收。认证前阶段、Host 未就绪及其余连接状态区分、设备权限、完整跨版本与跨平台矩阵仍待完成。Phase 3、Phase 4 与总目标继续 IN_PROGRESS。

## Host 发现失败的状态与恢复提示

[历史来源记录](artifacts/upstream-first/connection-failure-source.json)绑定 Connection 的 incompatible、fatal 状态及其界面提示。Host/Gateway 协议或发现阶段必需能力不兼容会停止自动重试并提示更新；发现信息无效、发现服务撤回会停止自动重试并提示检查配置。显式重连重新执行发现与事件就绪，不能绕过业务准入。普通业务错误不改变连接状态。调度仍由唯一 Connection 控制器负责。

展开侧栏显示本地化文字，收起轨道显示 36px 提示图标，并保留修正说明、可访问名称与手动重连。两个官方 Web profile 的录制场景注入不兼容和畸形发现版本，验证没有自动重复发现请求或就绪事件；恢复后完成原 Question，22 条完整持久化记录和工作区与未修改 fixture 一致。既有 Question 与 Approval 恢复场景也进行回归，证据记录分别绑定执行日志及截图。

定向 105 项测试、Host/Client 类型、限定 lint、相关 bundle 与 Web 构建通过；文档门禁 34/34。GUI 聚合实际为 5535 通过、1 跳过、1 失败；失败位于未修改的 ui-deliverables 文件打开测试，Windows 创建符号链接报 EPERM，不能称整套通过。tsx 的沙箱 ENOMEM 及主机重试记录保留。

本轮只补齐两个发现失败状态，不代表方案第 18 节完成。HTTP 401 认证恢复的后续实现见上节；初始连接、认证阶段、离线、重连、Host 未就绪和设备撤销的完整区分与 UX、设备权限、跨版本与跨平台矩阵仍待完成。Phase 3、Phase 4 和总目标保持 IN_PROGRESS。

## 刷新后预设名称就绪与连接状态缺口

[历史来源记录](artifacts/upstream-first/preset-reload-source.json)绑定五项 Question 恢复场景的预设名称就绪检查。对话完成与预设目录加载分别等待；全部五项通过，未复现预设名称持续丢失。失败诊断仅保留目录请求状态及 standard 预设字段，本轮未发生目录失败。产品运行时代码未改变，Host 类型、限定 lint 和 doc-sync 34/34 通过。

方案第 18 节要求认证中、离线、重连、Host 未就绪、认证过期、设备撤销、协议不兼容及致命错误等状态。该轮检查时 ConnectionState 仅有 connected、disconnected、connecting；后续 incompatible、fatal 实现与验证见上节。该缺口、本轮以外的恢复矩阵以及整个方案仍未完成。

## 回答接受前后刷新页面

[历史来源记录](artifacts/upstream-first/interaction-reload-source.json)绑定四项页面刷新场景和既有断线、竞争回答回归。Question 与 Approval 均在首次结果 HTTP 请求被暂停时刷新页面，分别覆盖 Host 接受前、接受后。刷新前的 URL 已不含启动 token，刷新返回 200，并通过新连接代次恢复，未再次使用启动凭据。

Host 尚未接受时，同一待处理交互重新出现；再次点击前只有一次已拦截回答请求，回合尚未结束。用户显式再次提交后，两个请求只有连接代次不同，id、revision 和回答内容一致。Host 已接受后再刷新时，交互不再出现，结果从对话恢复，回答请求总数仍为一。它验证 Client 内存丢失后的恢复，没有增加或承诺持久化自动重发。

四项刷新场景初次通过后，加入认证断言并统一回归全部十项场景，十项通过。Question 每场景 22 条、Approval 每场景 85 条标准化持久化 Session 记录与原 fixture 精确一致，模型脚本全部消费，独立工作区预期通过。待处理与完成截图已目视复核；待处理截图可能早于历史加载完成，最终记录和工作区比较在回合完成后执行。

Host/Client 类型、限定 lint 与 doc-sync 34/34 通过。产品运行时代码、bundle 和历史 fixture 未改变。本轮仍限 Windows/Chrome 与录制模型，后台恢复、设备权限、跨平台及变更确认语义尚未完成。Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## 取消与待发送回答、自动重试交错

[历史来源记录](artifacts/upstream-first/interaction-cancel-source.json)覆盖 Approval、Question 两种交互各自的两个顺序：首次回答被暂停后取消，以及首次回答丢失、自动重试被暂停后取消。测试通过官方 dsh --profile web 加场景 patch 启动独立进程，两个浏览器 Client 共享本地认证上下文；取消使用公开 session/cancelTurn RPC，以持久化 turn/start 序号为目标，不新增测试专用取消接口。

四个场景均通过。取消清除交互，重连的 pendingInteractionIds 为空，原回答不会再次发送。取消后和下一轮新交互期间分别提交旧回答，均得到 interaction-closed；再次发送旧回合的取消请求也不会中断新回合。每个场景只有两个工具调用和两个结果，回合结局依次为 aborted、completed；模型 fixture 收到三次请求，审批标记文件始终不存在。持久化结果和最终界面均保留旧取消结果与新一轮完成，截图已目视复核。

Approval 的取消结果为 ABORTED，Question 保留服务定义的 ASK_ABORTED；首次测试误将 Question 也写成通用码，两项因此失败，核对服务契约后修正断言并重新通过四项，没有改变产品运行时。Host/Client 类型、限定 lint 与 doc-sync 34/34 通过，产品构建文件与上一记录的 hash 相同。

这组证据使用本地模型 fixture 和调用真实 Approval/Question 服务的测试工具，验证定向持久化事件及审批文件副作用，不是完整录制 Session 回放或真实模型服务验收。公开取消 RPC 使用两个标签页共享的认证上下文，没有验证 Stop 按钮操作或不同设备身份。页面刷新恢复的后续验证见上节；设备权限、跨平台及其他恢复场景仍待处理；Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## Question 录制恢复与不同答案竞争

[历史来源记录](artifacts/upstream-first/question-retry-source.json)补齐 Question 的真实进程恢复验证。用例直接只读复用 question-composer 的 V3 录制，官方 dsh --profile web 加场景 patch 启动独立 Host，固定临时设置、技能根和凭据；同一 JSONL 同时作为模型回放输入和完整持久化日志预期。

请求未送达、Host 接受后确认丢失、另一 Client 回答胜出三个场景均通过。每个场景只在第一 Client 提交一次，22 条标准化 Session 记录逐条一致，工作区仍为空，模型回放全部消费。竞争场景中第一 Client 提交 Green 与 Discard this losing answer，其 HTTP 请求被暂停；第二 Client 提交 Blue 与 Include accessibility notes 后胜出。第一 Client 重连时清除旧回答，显式迟到提交返回 interaction-closed；日志中仅有一个工具调用、一个结果，展开后的界面仅展示胜出答案，截图已目视检查。

共享 fixture 的终结回合改为显式配置，既有三项 Approval 回放也通过。组合命令中的六个浏览器场景全部通过，但整体退出码为 1，原因是新增 snapshot adapter 未按字母顺序登记；排序修正后的三项 corpus 检查独立通过。最终可见答案断言的 Question 三项再次通过。首次竞争用例因 Playwright 单页上下文不允许再建页面而失败，修正为显式共享 context；中文段落格式和 lint 分隔符问题已修复。保留全部失败日志。

Host/Client 类型、限定 lint 和最终 doc-sync 34/34 通过。产品运行时与已构建 bundle 的 hash 均与上一记录一致，没有改写历史 fixture。证据限 Windows/Chrome 与录制模型；待发送回答期间取消的后续验证见上节；页面刷新恢复的后续验证见上文；设备授权及跨平台仍未验证。变更确认语义仍待设计，不把 Client 内存重试描述成持久化回执。Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## 已填写交互回答的断线重试

[历史来源记录](artifacts/upstream-first/interaction-retry-source.json)绑定 Gateway 的 Client 内存回答保留与 Host 待处理快照。协议 2 的 ready 帧增加可选 pendingInteractionIds；HTTP 传输失败后，Client 仅对 Host 再次投递的同 id、同 revision 交互重发已复制的回答，不再次打开监听器。成功确认、关闭、取消、业务拒绝或下一次快照缺少该 id 均清除保留内容。旧协议 1 字段保持不变；未提供快照的 Host 禁用此能力。

Gateway 相关测试 247 项通过；补充结果对象隔离断言后，Client 122 项再次通过。官方 dsh --profile web 的 keyless snapshot 通道中，正常场景、请求送达前丢失、Host 接受后确认丢失及三项 corpus 检查共 6 项通过。两个丢包场景均只点击一次审批：前者在新连接代次发出内容相同的第二次回答，后者只发送一次回答并清除已关闭的旧交互。每个场景均精确比较 85 条持久化 Session 记录、完整独立工作区，并验证重复 Tool id 的两个轨迹和 Inspect 结果。截图已目视复核，历史 fixture 未修改。

Host/Client 类型、限定 lint、Gateway bundle 和 doc-sync 34/34 通过。首次单元测试错误地构造 pending revision 2，现有协议按设计拒绝；已去除该无效用例，未放宽解析器。沙箱 tsx 的 ENOMEM 启动失败与宿主成功结果分开保留；双语配对命令的多余 -- 参数已修正。

本轮仅提供 Client 内存重试，不提供持久化 mutation receipt；页面刷新会丢失保留内容，也不能区分已关闭交互究竟由自己还是其他 Client 结算。Question 的丢包与不同答案竞争验证见上节；完整恢复矩阵、设备授权、跨平台与安装包验证仍未完成。Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## 重复调用 id 的录制 Session 回放验收

[历史来源记录](artifacts/upstream-first/tool-replay-source.json)补齐重复调用 id 修复的 keyless 录制回归。新增 authored 场景从 permission-policy-context 的 V3 记录派生，只修改第二次 write 的 7 处结构化调用 id 引用；原快照、模型文本和独立文件预期不变。浏览器通过官方 dsh --profile web 与场景 patch 启动独立进程，fixture 同时作为模型流输入和完整持久化日志预期。

正式 snapshot 通道中，新场景与三项 corpus 检查共 4 项通过。85 条标准化记录精确一致，四个回合的模型脚本全部消费；独立工作区比对确认 policy-neutral.txt 只有 POLICY_NEUTRAL_OK。Turn 4 Step 1 的写入被只读策略拒绝，Step 2 的同 id 写入获批成功。浏览器分别核对两个结果行，并从 Chat Inspect 到对应 Step 的 Result 页签。截图已目视复核。

首次完整日志比较拒绝了来自宿主的额外技能目录输入，原因是 preset 内技能根使用环境 fallback，外层配置无法覆盖。新回放和既有重启测试均固定 DSH_AGENTS_HOME、DSH_BUNDLED_SKILL_DIR；后者新增无 skill-catalog 输入断言，两项 Approval/Question 重启与 Inspect 测试再次通过。第二次尝试发现测试读取了目录选择器的父目录，修正为持久化 Session 的 cwd 后，独立文件预期通过。失败日志保留，没有增加归一化例外或覆盖历史 fixture。

Host/Client 类型、限定 lint 与 doc-sync 34/34 通过，产品 bundle 与上一来源记录逐个 hash 一致。本轮审批结果由测试插件提供；真实浏览器回答审批和问题由独立重启场景验证。证据限 Windows/Chrome，嵌套 PTC 仍以组件测试覆盖；真实模型、跨平台、安装包及完整恢复矩阵未由此完成。重复调用 id 的本地专项验收已通过，Phase 3、Phase 4 与总目标保持 IN_PROGRESS。

## Inspect 按 Turn / Step 定位工具执行

[历史来源记录](artifacts/upstream-first/tool-inspect-source.json)绑定 Chat、Trajectory、生成目录及更新后的 bundle。Chat Seat 将 root 的 Location 传给 Inspect 回调；跨视图 focus 编码 Turn、Step 和原始 call id，嵌套调用保留 root 的执行坐标。Trajectory 按同一组坐标揭示已驻留的较早历史并打开记录，不匹配的请求保持待定。检查器的源内容块跳转和所属消息链接均限制在当前 Step。

三项相关测试文件共 169 项通过，包含两个初始失败的指定执行实例回归、同 Turn 跨 Step、跨 Turn、较早历史中的根/嵌套调用、消息块跳到工具再返回所属消息，以及未匹配请求不被错误确认。Host/Client 类型、限定 lint、相关包编译打包和 doc-sync 34/34 通过。

两项真实 dsh profile 进程重启测试在 Windows Chrome 中完成四次 Inspect：每个场景先打开重启后的新调用，再打开中断的旧调用，分别核对 Turn/Step、Result 和 Schema。Question 的首次断言读取了折叠摘要，最终驱动通过 Result 页签展开三层 JSON 后核对 Fresh answer；初次失败日志保留。旧调用仍显示 TOOL_OUTCOME_UNKNOWN，新调用仍显示本次结果。最终截图经目视复核，模型为本地脚本 HTTP 服务。

此阶段验证节点、账本和导航；后续录制 Session 验收见上节。嵌套 Inspect 与内部链接仍以组件测试覆盖，真实模型、跨平台、安装包与其余恢复矩阵不由这些结果证明。

## Trajectory 账本按执行区分结果、耗时和 schema

[历史来源记录](artifacts/upstream-first/tool-ledger-source.json)绑定 Trajectory 源码、更新后的 Client bundle 及回归结果。三项初始失败回归证明：虽然节点已经独立组装，表格仍会把两次调用放入同一 Turn。当前 Builder 保留 Tool 的 Step Location；结果、开始时间、已显示调用集合、schema 和记录标识均使用执行坐标，嵌套调用继承 root 的坐标。缺少 Step 的结果保持独立，不借用同 id 的其他结果。

五个相关测试文件共 100 项通过，覆盖相同 Turn 的不同 Step、不同 Turn、嵌套调用、不同 schema、运行中同 id 调用、未定位结果及现有 View 行为。Host/Client 类型、限定 lint、Trajectory 编译与打包、doc-sync 34/34 通过。两项真实 dsh profile 进程重启测试还通过浏览器打开 Trajectory：Turn 1 保留 TOOL_OUTCOME_UNKNOWN，Turn 2 分别显示拒绝审批或 Fresh answer 的新结果；两行键不同，错误状态分别核对，截图已经目视复核。

此阶段仅证明账本配对，后续导航、schema 页签与录制 Session 验证见上文。真实模型与跨平台验收仍未完成。

## Tool 节点按 Step 区分：组装阶段证据

[历史来源记录](artifacts/upstream-first/tool-scope-source.json)绑定 Chat、Conversation、Trajectory 的源码、更新后的三个 Client bundle 及验证结果。Tool Definition 选择 Step 范围的身份，Conversation 使用 turn、step 与原始 call id 关联节点；默认 Definition 仍按 Session 关联，匹配器仍不读取历史，provider id 与 Session 日志不改写。

嵌套 PTC 缺少执行坐标的分页前缀等待已记录坐标再归属，不能跨新的 Step/Turn 开始边界推断。先加载结果、后补调用保持同一节点键；同一 Step 的重复 start 和瞬态 start 继续拒绝。针对 Chat、Conversation、Trajectory 的五个测试文件共 123 项通过，覆盖跨 Step/Turn 复用、嵌套 PTC、replace、append、prepend 及不完整前缀。

最终重新构建 ui-conversation 后，两项真实 dsh profile 子进程与 Windows Chrome 测试通过：Approval 和 Question 都能恢复并回答新交互，复用调用 id 后旧 TOOL_OUTCOME_UNKNOWN 记录仍显示一次。磁盘、迟到回答、草稿、Cookie 与无副作用断言沿用。此处模型为本地脚本 HTTP 服务；浏览器截图已经人工目视复核。Host/Client 类型、限定 lint 和 doc-sync 34/34 通过。重复测试轮次不累加为独立用例。

此阶段仅验证节点组装；表格配对、schema、Inspect 导航与独立录制 Session 回归的后续证据见上文。

### 初始缺陷证据

[历史来源记录](artifacts/upstream-first/tool-occurrence-source.json)封存两个原始失败回归：同一 Turn 的不同 Step、不同 Turn 复用 provider ToolCallId 时，ConversationNodeAssembler 报 received more than one start Match。该记录通过封存输入校验，描述修复前的状态；当前组装回归已通过，不将历史失败计作当前失败，也不将本轮局部修复计作完整 Tool UI 通过。

## Approval / Question 重启后的新交互

[历史来源记录](artifacts/upstream-first/question-restart-source.json)将真实进程回归扩展为 Approval、Question 两个场景。两者均保留原 Cookie、未发送草稿和中断历史，旧工具结果按既有逻辑修复为 TOOL_OUTCOME_UNKNOWN。Question 没有独立的持久化待答事件，没有为测试新增日志类型或请求存储。

旧交互回答在重启后、新交互创建前被拒绝；用户显式发起新 Prompt 后，再向旧 id 提交一次回答也返回 interaction-closed，新卡片保持待答。新请求拥有不同 id：Question 通过实际浏览器选择 Fresh answer 并提交，Approval 通过浏览器拒绝，随后均在同一恢复后的 Connection 上完成新回合。每个场景共三次本地脚本模型请求，未产生测试标记副作用。

磁盘中保留一次中断结果及一次新工具结果，模型下一次请求收到新结果；迟到 Question 文本没有进入新结果。中断审批没有伪造决定，新审批仅记录真实的 rejected。最终两项浏览器用例、Host/Client 类型、限定 lint 与 doc-sync 34/34 通过；初轮两项与最终运行重叠，不相加为唯一用例数。沿用官方服务和恢复实现，产品运行时代码未变。

此证据仍限 Windows/Chrome、同一隔离 home 和端口、保持打开的页面及无排队输入的 Session。真实模型、OS 休眠唤醒、浏览器死亡、移动后台、其他执行队列、设备权限和持久化回执仍未由这些测试覆盖。Phase 4 与总目标保持 IN_PROGRESS。

截图复核发现脚本模型两次工具调用复用 mock-call-1；完成新回合后，旧工具行的展示与恢复截图不同。磁盘断言区分两次事件并通过，但重复调用 id 与 Client 展示的关系尚待专项检查，不将本轮结果视为完整 Tool UI 验收。

## 真实 Host 进程重启与中断 Session 修复

[历史来源记录](artifacts/upstream-first/host-restart-source.json)绑定新增的真实进程 Web 回归及既有恢复实现。测试通过正式 source dsh --profile 启动独立 Node Host，使用本地脚本 HTTP 模型进入真实工具与审批流程。先输入未发送草稿，再等待审批请求落盘，随后强制结束进程；读取持久化数据确认只有一次工具调用和审批请求，没有工具结果、审批决定或回合结束。

重启保留同一隔离 Harness home 和端口，浏览器保持打开并沿用原 Cookie，不再次交换启动 token。新连接清除旧审批卡、保留草稿，并向旧事件 id 的允许请求返回 interaction-closed。实际 Session follow 快照将工具标记为 TOOL_OUTCOME_UNKNOWN，并以 interrupted 结束原回合。重连未触发新的模型请求或测试标记写入。

用户显式提交下一条消息后，第二次模型请求携带既有的“不要盲目重试”修复文本并完成新回合。Agent 空闲后读取磁盘，确认两条用户来源消息、一次工具调用、一个结果未知的修复结果、两个结束回合，且没有伪造 approval/decided。最终浏览器场景、Host/Client 类型、限定 lint 与 doc-sync 34/34 通过；初始测试夹具及观察失败均保留。未修改产品运行时代码或新增 Session 事件。

这是中断 Session 的安全收敛，不是恢复待审批 JavaScript 续体。证据限于 Windows、已安装 Chrome、保持打开的浏览器和无排队输入的 Session；没有真实模型服务、外部工具副作用、Question 进程重启、浏览器死亡、OS 休眠唤醒、移动端或跨平台验收。依赖未同步警告及原 Windows symlink EPERM 未解决；Phase 3、Phase 4 与总目标继续执行。

## Host 持有的可选交互期限

[历史来源记录](artifacts/upstream-first/interaction-expiry-source.json)绑定 Gateway 的按类型过期配置、定时器、协议字段及浏览器验证。interactionTimeoutMs.approval 和 question 可分别配置期限，未配置的类型不自动过期。Gateway 创建待处理记录时设置 Host expiresAt 和可清理的经过时长定时器；Client 重连沿用同一时间戳，无人连接时仍计时。

Host 在重放和接受回答前也检查截止时间，避免休眠后的迟到回答赶在定时回调前获得授权；时钟回拨不延长已经启动的计时。结算或取消清理定时器。过期以 interaction-expired 拒绝事件源，协议 2 下发 expired / revision 2 终结记录，协议 1 保持原取消字段；迟到回答返回 interaction-closed。Approval 沿用 unavailable 的失败关闭结果，Question 传播过期错误。本地回答方不受该转发期限限制。

Gateway/Remotes 回归 429 项通过，补充到期后不得向新连接重放的回归后，流测试 42 项通过（含重复场景，不相加为唯一测试数）。真实 Web Loader 与两个 Chrome Client 通过测试专用的 10 秒配置验证审批、问答到期、实际连接代次更换后原期限不变、两端卡片关闭及迟到允许请求被拒绝。原有默认无期限的竞争回答与版本恢复场景也通过。初始 Playwright close 事件计数失败已改为检查新的 Host clientId 与同一记录重放，失败日志保留。

Host/Client 类型、限定 lint、Gateway 双端构建及 doc-sync 34/34 通过。通用 Typert 生成探针因 Gateway 不导出 ./typert 被拒绝，未写入文件，不作为构建证据。时钟测试使用受控时钟，不代表实际 OS 休眠唤醒验证；浏览器不调用模型或执行真实 Tool。过期状态仍只在内存中，未新增 Session 事件、专用 UI 过期提示、设备授权、持久化回执或重启恢复。无新增完整 GUI、安装、原生、跨平台或发布验收，整体目标继续执行。

## 交互回答版本与协议一致性

[历史来源记录](artifacts/upstream-first/interaction-revision-source.json)通过封存输入绑定 Gateway 的 Host/Client 回答链路、校验及真实浏览器恢复验证。协议 2 的应用交互结果、委托和拒绝均回传 interactionRevision。Host 在移除投递或结算调用方前同步检查待处理记录版本与活动投递协议：缺少版本或降级协议返回 gateway/input-invalid，版本不匹配返回 revision-conflict。失败保留待处理交互；已关闭投递仍优先返回 interaction-closed。

Gateway/Remotes 回归 407 项通过，补充 Client 回归 111 项通过（含重复场景，不相加为唯一测试数）。真实 Web Loader 与两个已安装 Chrome Client 验证错误版本、缺失版本和协议降级均不产生决定；第一端实际收到 revision-conflict 后重连一次，重现相同 requestId、创建时间和 revision，再正确回答只记录一次。第二端的迟到回答返回 interaction-closed，随后仍在原连接回答下一条请求。用户决定与交互帧序列匹配更新的预期文件。

Host/Client 类型、限定 lint、Gateway 双端构建及 doc-sync 34/34 通过。初始混用连接与回答协议的夹具、缩进及 Mock 异步类型错误日志保留。业务监听器不接收协议元数据。浏览器使用真实 Approval/Agent/Session 服务和受控 HTTP/取消帧，不调用模型，也不执行真实 Tool 副作用。

待处理记录仍为 revision 1，终结记录为 revision 2，没有修改待处理内容的路径。协议 1 保留原有字段且不做版本比较；该机制也不授予设备权限、不实现过期、持久化变更回执或重启恢复。无新增完整 GUI、安装、原生、跨平台或发布验收；已知 Windows symlink EPERM 未重跑或解决。总目标与 Phase 4 继续执行。

## 条件重命名与编辑版本

[历史来源记录](artifacts/upstream-first/rename-revision-source.json)通过封存输入绑定标题服务、Session Controller、新能力及工作区编辑流程。session.rename-at.v1 使用 titleRevision 中的持久化标题事件序号；Host 在标题服务内按配置规范化并同步比较、追加。版本变化返回 session/revision-conflict；相同的用户固定标题返回原事件，不重复写入。旧 checkpoint 缺少该投影时从日志重建，不把全局流游标当成标题版本。

Client 在打开重命名对话框时捕获版本，重复保存保留同一基线；缺少版本时不发送。冲突保留草稿并显示中英文提示，重新打开才捕获当前版本。旧 Host 和直接 rename 调用（包括分叉后的程序命名）保留无条件语义。本增量没有新增 Session 事件、独立存储或通用 clientMutationId 回执账本。

定向回归 283 项通过，后续中文冲突与旧 checkpoint 补充回归 11 项通过（含重复场景，不相加为唯一测试数）。真实 Web Loader 与两个已安装 Chrome Client 验证旧编辑冲突、草稿保留、重新打开保存、重复 HTTP 请求不追加事件以及后续标题变化后旧请求失败；用户标题事实与界面文案匹配新增预期文件。另两项浏览器回归通过：原有规范化 Prompt Session 比较，以及能力撤回后恢复真实重命名。重命名夹具不调用模型，Prompt 使用 keyless replay。

Host/Client 类型、Remote 声明、限定 lint 和受影响包构建通过；目录生成器回归 40 项通过。doc-sync 初次 33 项通过、1 项 Cordis inspect 目录过期；重建后对应新鲜度检查及九组双语配对通过。初始测试清理、自动标题夹具、Client 替身、行宽及浏览器工作区选择失败均保留。未重跑或解决上一增量的 Windows symlink EPERM；无新增崩溃、完整 GUI、安装、跨平台、原生或发布验收。整体目标继续执行。

## 按回合目标取消

[历史来源记录](artifacts/upstream-first/cancel-target-source.json)通过封存输入绑定 Session Controller 的 activeTurnStart 投影、新 cancelTurn Remote、Client 调用及验证。session.cancel-turn.v1 声明支持按持久化 turn/start 序号取消。Host 只在目标仍是当前开放回合时同步请求取消；已结束、已更换或显式 null 的目标不影响后续工作。Client 每次点击捕获一次目标，投影未就绪时返回失败。旧 Host 使用原 cancel 调用，子代理仍走父级中断路径。

定向回归 81 项通过。真实 Web Loader 与两个已安装 Chrome Client 验证：第一端停止回合 1 后延迟接收回执，第二端启动回合 2；重放旧取消请求时回合 2 仍运行，第二端可用新目标独立停止它。另一个浏览器回归比较原有规范化 Prompt Session，最终两项通过。模型采用 keyless replay/hang，不代表真实模型服务验收。

Host/Client 类型、限定 lint、显式生成的 Remote 声明、Controller/Remotes/tool-cordis 构建及目录预期输出 3 项通过。扩展回归在宿主为 811 项通过、1 项失败、1 项跳过；失败是 media-references 的 Windows symlink EPERM，在 sandbox 与宿主均存在，整组不能记为全绿。初始夹具、生成声明和文档类型归属错误均保留日志。

doc-sync 初次 32 项通过、2 项生成引用过期；更新事件关系图和持久化目录后，两项新鲜度检查及六组双语配对通过，未重跑其余门禁。本增量复用 Session 日志与现有投影，不新增 Session 事件或回执注册表；原 cancel 与子代理中断不具备本次目标语义，answer、rename 等操作的通用去重仍未完成。无新增完整安装、跨平台、原生或发布验收。

## Prompt 重试与持久化 inbox 接受记录

[历史来源记录](artifacts/upstream-first/prompt-idempotency-source.json)通过封存输入绑定 Session Controller 修复、测试、浏览器场景及复用的录制 Session。沿用 requestId/rpcId，异步附件准入结束后，在同步插入 inbox 前重新检查；持久化 agent/inbox/spliced 的插入记录在消息被领取或移除后仍能证明已接受，避免正文尚未记录时重复入队或恢复已删除输入。未发生插入的失败仍允许沿用同一身份重试。

修复前 4 个新增回归场景失败；修复后的 Session Controller 定向回归 109 项通过。真实 Web Loader 与已安装 Chrome 场景通过：两次并发请求和领取后的一次请求均获接受回执，但只插入一条 Prompt。录制模型响应被消费一次，规范化后的完整 Session 与原有 live-interactions 记录一致，未更新 golden。该场景未独立固定系统提示词或工具 schema 内容。

Host/Client 类型、Session Controller 构建、限定 lint 及 doc-sync 34/34 通过。浏览器初始运行受到宿主 sandbox 的用户目录 realpath EPERM 阻挡，宿主重跑后通过；产品 sandbox 保持原有行为。测试类型、Lint 和把框架上下文误计为用户输入的失败证据均保留。

本增量没有新增变更注册表或协议字段，不代表 answer、cancel、rename 或设备变更已经具备通用 clientMutationId 语义。已接受身份代表原始插入，不能提交替换内容；并发附件准备可能留下无引用对象。无崩溃注入、真实模型服务、完整 GUI、原生、跨平台或发布验收，整体目标继续执行。

## Host 交互记录与协议兼容

[历史来源记录](artifacts/upstream-first/interaction-record-source.json)通过封存输入绑定 Host 交互记录、协议投递、目录产物及验证。API Remotes 明确声明 Approval/Question 类型、Session 和所需回答权限；Gateway 复用现有 pending 记录分配 requestId、createdAt、status 和 revision。协议 2 下发记录，协议 1 保持原有帧字段。断线重连保持同一待处理身份、创建时间和 revision 1；其余投递收到 revision 2 的终结记录。

Gateway/API Remotes 回归 387 项通过，覆盖严格字段校验、混合协议客户端、重连重放、完成及取消。真实 Web Loader 与两个已安装 Chrome Client 的场景通过：两端收到相同记录，竞争回答只记一次决定，另一端收到 interaction-closed 与关闭记录，随后仍在原连接处理下一次请求。浏览器预期输出已更新；测试控制 HTTP 回答与取消帧时序，不调用模型或执行真实 Tool 副作用。

Host/Client 类型、Gateway/Remotes 构建及限定 lint 通过。doc-sync 初次 32 项通过、2 项生成目录过期；重新生成 Cordis API 与配置目录后，两项新鲜度检查及四组双语配对通过，未重跑其余门禁。目录预期输出测试 3 项通过，tool-cordis 产物已重建。初始夹具、Lint、命令参数及工作目录错误记录保留，不作为通过证据。

requiredPermission 目前是描述字段，不执行设备授权；记录只由内存中的 Host 待处理调用持有，尚无过期、重启恢复、回答 revision 比较、设备撤销或 clientMutationId。Client 校验元数据，不向业务请求添加字段。无新增完整 GUI、原生、发布、跨平台或干净依赖安装验收，Phase 4 与整体目标均未完成。

## Interaction 竞争回答与显式关闭结果

[历史来源记录](artifacts/upstream-first/interaction-closed-source.json)通过封存输入绑定 Gateway 的 Host/Client 关闭结果及两客户端验收。复用上游 Host 持有的 pending waterfall，已完成、已取消、已委托或已撤回 Client 连接代次的回答返回 interaction-closed，不再次结算。Client 把关闭结果视为该交互已完成，不因此重连整个 Connection；其他失败行为保留。

Gateway/API Remotes 回归 360 项通过，含协议 1/2 的多客户端竞争、Host 取消和断线后的迟到回答。真实 Web Loader 与两个已安装 Chrome Client 的场景通过：同一 Approval 只接受一个回答，另一端收到 interaction-closed，随后在原连接完成下一条拒绝请求。测试控制迟到 HTTP 请求与取消帧的时序，业务回答由真实 Gateway/Approval 处理；未调用模型或执行真实 Tool 副作用。

该历史增量的 Host/Client 双编译面、Gateway 构建、限定 lint 及 doc-sync 34/34 通过。初始把新增浏览器测试放入 Client 程序的失败记录保留，最终已归入 Host 测试清单。该增量未包含交互记录、过期、设备授权、重启恢复或变更去重；后续记录实现与仍缺少的验收见上节。

## Workspace 到 Session 的组合准入

[历史来源记录](artifacts/upstream-first/workspace-admission-source.json)通过封存输入绑定组合导航、共享流及验证。Workspace 选择（含空会话复用）、创建与分叉在建立导航意图前检查 session.manage.v1，异步完成后再次检查，能力撤回时不搬移草稿或切换到返回的 Session。Host 已完成的变更保留；已有 Session 仍可直接打开。首次自动选择等待管理能力，工作区选择器随撤回关闭，恢复后不自动重开。

真实浏览器暴露 Workspace 流在初始 Connection 就绪前终止为 gateway/connection-unavailable。共享 RemoteStream 已统一在每次 opener 前等待已准入 Host 与可选能力谓词，继续使用 Connection 的就绪来源。本轮没有添加 Workspace 专属重连循环。

Workspace/Conversation 回归 599 项通过；共享修复后的 Gateway、Workspace Controller、Session 传输回归 604 项通过；最终真实 Web Loader 与已安装 Chrome 全组 9 项通过。首次能力缺失不创建，恢复后只创建一次；撤回关闭选择器并保留草稿，恢复后复用原空会话。能力缺失通过真实 Host 发现响应的受控投影构造，不调用模型。

Client/Web 类型、相关包构建与限定 lint 通过。doc-sync 初次 33 项通过、1 项 Cordis API 目录过期；重新生成后对应新鲜度检查及目录测试 3 项通过，未重复其余门禁。599 项 UI 回归在共享就绪修复前，604 项 API 与 9 项浏览器验证在其后。失败诊断日志和截图保留，但不是通过证据。无新增完整 GUI、原生、发布及跨平台验收。

## Session 历史可用性与视图分页

[历史来源记录](artifacts/upstream-first/session-follow-ui-source.json)通过封存输入绑定 Conversation 外壳、Chat/Trajectory、生成的 Client 目录和浏览器预期输出。外壳向选中 View 传入 historyAvailable；缺少 session.follow.v1 时显示本地化提示，保留历史和草稿。Chat 隐藏远端分页及未加载轮次导航；Trajectory 保留本地缓存分页。空会话仍不挂载 View。

定向组件回归 930 项通过，最终空会话修正另通过 24 项；真实 Web Loader 与已安装 Chrome 的完整 Host 能力回归 8 项通过。实际断连后，能力缺失期间没有 follow/page 请求；Host 期间追加的记录在恢复后显示，原历史和草稿保留。能力撤回通过真实 Host 发现响应的受控投影构造，不调用模型。

Client/Web 类型、受影响包构建及限定 lint 通过。doc-sync 初次 33 项通过、1 项 Client 目录过期；重新生成后目录新鲜度检查和生成器 18 项测试通过，未重复其余已通过门禁。空会话修正在浏览器全组之后，由最终组件回归和类型检查覆盖。无新增完整 GUI、原生、发布或跨平台验收，依赖未做干净安装验证。

## Session 历史流能力等待

[历史来源记录](artifacts/upstream-first/session-follow-source.json)通过封存输入绑定传输层源码和验证。Session journal 在首次打开及重连时等待 session.follow.v1；缺失期间不自动发起 follow，保留已有历史窗口，恢复后追赶新事件。销毁取消等待并释放订阅，继续由既有 Connection 管理连接生命周期。

定向回归 334 项通过；Client runtime 测试 98 项通过、1 项预期失败。Client 类型检查、Gateway/Session 打包、限定 lint 和 doc-sync 34/34 通过。较大 Session 测试执行保留 Windows 文件符号链接 EPERM 失败；两处旧请求夹具的未处理拒绝已修正等待时序，并纳入最终定向回归。

该历史增量仅确认传输层。界面与浏览器证据见上节；整体目标仍在执行。

## 工作区行与预设会话管理入口

[历史来源记录](artifacts/upstream-first/workspace-management-source.json)通过封存输入绑定该阶段源码、产物、日志、预期输出和截图。Workspace 行的创建按钮、分组与单列表的 Session 重命名/分叉，以及预设 Settings 的 Creator 会话入口要求 session.manage.v1。撤回能力会关闭已打开的 Session 菜单和重命名对话框，恢复后不自动重开旧对话框。保留的创建、分叉和预设创作回调重新检查当前能力，避免导航或预置模板；归档及普通预设管理仍由独立功能负责。

定向源码测试 323 项通过，真实 Web Loader 与已安装 Chrome 的 7 项测试通过。浏览器验证能力撤回、对话框关闭、菜单与预设入口隐藏、实际断连恢复，并在恢复后通过真实 Remote 完成一次重命名；能力缺失期间没有发出创建、重命名或分叉请求。会话夹具在 Client 准入前准备为已结束状态，不调用模型。失败的夹具尝试与诊断截图保留，不作为产品通过证据。

Client/Web 类型检查、受影响插件打包、lint 及 doc-sync 34/34 通过，锁文件未变。能力缺失仍通过真实 Host 发现响应的受控投影构造。工作区选择到新会话的组合流程、Session 读取能力及其余业务准入、兼容诊断、幂等和平台验证仍待完成；没有新增全 GUI、原生或发布通过结论。Phase 3 与总目标保持 IN_PROGRESS。

## 侧栏会话创建入口（历史验证）

[历史来源记录](artifacts/upstream-first/sidebar-management-source.json)通过封存输入绑定该阶段源码、产物、预期输出、截图与日志。侧栏的新建按钮及展开态品牌快捷入口要求 session.manage.v1；能力缺失时保留非交互品牌、普通光标和导航控件，折叠轨道隐藏创建按钮。保留的创建回调也检查当前能力，恢复后重新显示入口。

侧栏定向测试 43 项通过，真实 Web Loader 与已安装 Chrome 的 6 项测试通过，覆盖同一页面实际断连、能力撤回、折叠切换与恢复，且未发出创建、重命名或分叉请求。缺少能力通过发现响应投影构造，不等同于卸载 Host 方法。Client 类型检查、插件打包、lint 和 doc-sync 34/34 通过。锁文件相对上一增量仅新增三行工作区依赖；没有外部依赖升级。pnpm 检查保留依赖状态警告并禁止隐式安装，未验证全新依赖安装。

本轮只补齐全局侧栏入口；Workspace 行、预设菜单、会话读取入口及兼容诊断仍未完成。未新增完整 GUI 通过结论，上一轮失败记录继续保留。Phase 3 和总目标保持 IN_PROGRESS。

## Session 操作能力与控制流恢复（历史验证）

[历史来源记录](artifacts/upstream-first/session-capability-source.json)通过封存输入绑定该阶段源码、构建产物、日志、预期输出及截图。Session 所有者共享声明跟随、控制、管理和模型选择能力；Gateway 在传输前拒绝缺少能力的操作，单次拒绝不影响其他允许的操作。策略尚未覆盖所有命名空间。

控制流在 session.control.v1 缺失时等待，不发送打开帧；恢复后重新打开。连接代次结束归类为载体中断，调用方主动取消仍保留原语义。输入栏保留草稿、禁止 Enter 提交并隐藏发送、停止及队列操作；恢复能力后重新启用。该逻辑复用现有 Connection、RemoteStream 和 renderer hook。

最终定向回归 475 项通过，真实 Web Loader 与已安装 Chrome 的 5 项测试通过，包含实际 WebSocket 断连、受控能力撤回与恢复、控制流帧和草稿检查。能力缺失通过发现响应投影构造，不等同于卸载 Host 方法。类型检查、打包及定向 lint 通过。

完整 GUI 重跑 5486 通过、2 失败、1 跳过；未改动的 Windows 文件符号链接测试仍报 EPERM，高亮超时隔离重跑 19 项通过。完整 GUI 在最后的代次取消分类修复前执行，该修复由最终定向回归和浏览器测试覆盖。doc-sync 为 31/34，三份过期目录重新生成后分别复核通过；失败记录保留，不宣称完整 GUI 或最终 doc-sync 全绿。Phase 3 和总目标保持 IN_PROGRESS。

## 模型选择能力准入（历史验证）

[历史来源记录](artifacts/upstream-first/model-capability-source.json)通过封存输入绑定该阶段源码、UI 产物、用户可见预期输出与截图。输入栏模型选择和 /model 入口只在已准入 Host 公布 model.select.v1 时显示；发现前或能力缺失时不读取模型目录，保留的选择回调与目录执行方法也拒绝发送请求。现有 renderer hook 订阅 Host 代际，不维护第二份能力存储。

连接代际丢失会清除旧目录与路由阻塞，关闭旧命令弹窗且不移动键盘焦点。恢复能力后只加载一次当前目录。定向模型/命令测试 89 项通过；真实 Web Loader 与已安装 Chrome 的 4 项测试通过，包含普通 Host、受控缩减能力声明、同一页面的实际 WebSocket 断连与恢复。缺少能力的场景通过受控发现响应构造，不能称作所有后端均实测支持该状态。截图分别记录[能力存在](.artifacts/model-capability-browser/supported.png)与[能力缺失](.artifacts/model-capability-browser/absent.png)。

类型构建、插件打包与最终定向 lint 通过。完整 GUI 回归 5482 通过、3 失败、1 跳过；隔离复查 47 通过、1 失败，两项高亮超时不再复现，未改动的文件符号链接测试仍报 Windows EPERM。doc-sync 首次 33/34，唯一过期 slot 目录已重新生成并单独校验通过。不得将这些结果表述为完整 GUI 或完整固定浏览器矩阵通过。

本轮完成模型选择这一业务入口的能力准入；其他功能入口、诊断/升级 UI、幂等、数据转换、原生客户端与发布仍未完成，Phase 3 和总目标保持 IN_PROGRESS。

## 应用协议协商（历史验证）

[历史来源记录](artifacts/upstream-first/application-negotiation-source.json)通过封存输入绑定该阶段源码、公开声明、构建产物和日志；当前源码由工作区管理入口来源记录直接校验。host.describe 保持协议 1 发现表示并公布可用版本；Client 通过同一 Remote namespace 的 host.negotiate 选择最高共同版本 2 或 1，验证 Host 身份和结果。缺少协商元数据的旧 Host 显式选择协议 1；元数据矛盾、无共同版本、身份变化或协商失败均拒绝准入，不静默降级。

已选编解码器由 Connection 代际持有，统一编码业务一元调用、业务流、事件流与事件回复。Gateway 是协议版本及请求语法的所有者；Host-description 的旧协议入口及其四个生成文件已归档移除。协议编号不授予权限，不新增重试或连接状态所有者。

源码协商与 Client 回归 142 项通过，补充代际/事件回复定向测试 9 项通过。公开声明检查与三组真实 HTTP API 互通共 4 项通过：新 Client / 新 Host 选择 2，新 Client / 封存 Host 及封存 Client / 新 Host 选择 1。封存清单和产物摘要逐项核验；共享 workspace 依赖未冻结为整套历史安装包。真实 Web Loader 与已安装 Chrome 的 2 项测试确认协商响应未放行时无事件流或业务请求，之后事件流携带协议 2。

正式 Host/Client 构建和最终定向 lint 通过。doc-sync 首次 32/34，失败的文档类型检查和 Cordis 目录检查修复后单独通过，六组配对通过；失败日志保留，不宣称完整门禁重新执行通过。N-2 Diagnostics、能力 UI、专用升级界面、原生消费方、幂等操作、迁移与平台发布仍待实施；Phase 3 和总目标保持 IN_PROGRESS。

## Remote 请求协议入口（历史验证）

[历史来源记录](artifacts/upstream-first/protocol-envelope-source.json)通过封存输入校验该阶段源码与产物；当前应用协商另行直接校验。Gateway 支持不带版本字段的协议 1 请求，以及显式协议 1/2 请求。未知或格式错误的显式版本在业务方法、业务流、事件 Client 注册和事件结果处理前被拒绝，额外参数仍严格校验。

本轮 77 项源码/真实 HTTP 路由测试、Gateway 两个编译面、定向 lint、打包和普通 Node 公共导出检查通过。doc-sync 首次 30/34：配置目录过期与 CRLF 引发四项失败；修复后 test:docs 15/16，唯一剩余配置目录配对已修复并通过三组具名配对检查，配置目录检查也通过。保留所有失败日志，不将补验表述为一次完整 doc-sync PASS。

该阶段仅提供 API 1 应用准入与请求编解码器；应用协商和封存 v1 互通由上节补齐。Phase 3 和总目标保持 IN_PROGRESS。

## Client 强制发现与同代准入（历史验证）

[历史来源记录](artifacts/upstream-first/client-admission-source.json)通过封存输入校验该阶段源码、公开声明、浏览器产物与验证日志。API Remotes 在暴露业务 namespace 前安装发现回调；每次 Connection 尝试先经现有认证载体请求 host.describe，检查 API 代际并用生成编解码器校验结果，再打开事件流。事件就绪后才放行业务调用，HostDescriptor 随现有连接代际发布和清除。

初次等待的调用可以独立取消；连接失效取消已放行调用。断连和重连期间的新业务调用立即返回 gateway/connection-unavailable，不会排队后自动执行写操作。未知 API 代际、损坏响应、缺少发现能力和发现失败均拒绝准入。公开 facade 同时导出描述字段及错误码的声明合并；独立 NodeNext 消费程序先复现缺失，再验证修复。Gateway 的通用独立组合仍不承担应用策略，官方应用通过 API Remotes 强制接入。

最终源码测试 145/145、公开类型与打包 HTTP smoke 2/2、真实 Web Loader 和已安装 Chrome 的认证/调用顺序检查 2/2 通过。官方 Host/Client 构建通过，最终声明与三个受影响 Client 包另行重建；最终 lint 和 doc-sync 34/34 通过，浏览器测试清理调整后再次通过定向检查。失败编译产生的四个已确认生成文件及首次类型测试留下的三个临时目录均已核验归档。仓库固定 Chromium 下载失败，因此不宣称完整固定浏览器矩阵通过。

该阶段仅支持初始 API 同代准入，尚未完成 N/N-1 协商、能力驱动 UI、专用升级界面、原生 DTO 消费方、幂等操作或旧数据转换。未重新打包 Desktop、执行系统安装/登录、迁移用户数据、调用真实模型、提交或发布。Host 发现与 Client 准入输入已封存，不能替代当前直接源码校验；Phase 3 与总目标保持 IN_PROGRESS。

## Host 发现与能力声明（历史验证）

[本轮来源记录](artifacts/upstream-first/host-description-source.json)直接绑定 Host 发现源码、组合配置、生成产物、文档与验证日志。host.describe 通过现有认证 Typert Remote 返回持久 Host 身份、独立的产品/API/Session 版本、Host 进程信息、声明的载体和显式能力。首次并发启动共用一个持久身份；损坏或不可访问的文件拒绝启动。Gateway 从现有活跃 Remote 绑定读取能力，必需方法撤回后不再广告对应能力。Web 使用 HTTP/WebSocket，Desktop 声明 desktop-pipe。

owner 定向测试 79/79、生成器测试 40/40、正式 Host/Client 构建后的真实 Web Loader 测试 3/3 通过；匿名发现返回 401，认证发现与隔离目录内的持久身份一致。三项行为故障对照均被拒绝。完整 lint:contracts-ready 与 doc-sync 34/34 通过；Windows NodeNext 消费检查覆盖 278 个包，完整公共导出损坏也被拒绝，临时 junction 清理保留目标目录。

完整 hygiene 的历史执行为 14 通过、2 失败；其中 NodeNext 已修复并单独验证，ACP 文件符号链接在当前 Windows 检出为目标文本的问题仍未修复，因此不宣称完整 hygiene 通过。失败的 Client 编译产生的 1048 个已确认生成文件已归档并移除；依赖恢复仅保留新增包及两个 workspace 引用，没有无关版本升级。

该阶段只完成发现接口基础；Client 强制发现和同代准入由上节补齐。N/N-1、能力 UI、原生 DTO、完整统一错误、幂等操作及数据转换继续待实施。此前的 unsigned Desktop 安装包不包含后续 Storage/Host/Client 修改。没有新安装包、签名、安装/更新、系统登录、macOS/真机或真实模型验收，Phase 3 保持 IN_PROGRESS。

## Storage owner 关闭顺序

[该阶段来源记录](artifacts/upstream-first/storage-owner-source.json)绑定验收时的 Storage 源码、文档、构建库及验证日志；后续改变的共享输入由封存副本保存。JSON/SQLite 通过 KvFacet.open 的 owner 回调先停止并排空领域工作，再关闭单元和介质；初始化与关闭并发时，有效的初始化以 closed 拒绝，不能返回迟到句柄。独立 owner 全部结束后才报告清理失败，初始化清理错误同时传给正在等待的关闭调用方。未增加另一套生命周期 registry、Session 事件或存储代际。

四个 Storage owner 的定向测试 109/109 通过；最终标量断言调整后，领域测试 38/38 与定向 lint 再次通过。正式 Host 构建后的 Web Loader 录制会话通过 2/2，覆盖等待日志 flush 时关闭真实 JSON 后端，并核对最终标题、序号、身份及完整 Session 日志。三项行为故障对照均被拒绝；返回句柄对照最初遇到对象格式化错误，改成标量结果后确认两个场景均因断言失败而被拒绝。完整 lint:contracts-ready、doc-sync 34/34 和 git diff --check 通过。

历史 checkpoint 及 Storage 输入保留在有摘要校验的归档中；归档不能满足本轮 Host 发现的当前源码校验。Storage 变更未进入此前的 Desktop 安装包，也未验证真实模型或其他平台。Host 发现基础由上节补齐，Client 协商、幂等操作、旧数据转换及其余 Phase 继续待完成，Phase 3 保持 IN_PROGRESS。

## Checkpoint 写入顺序

[本轮来源记录](artifacts/upstream-first/checkpoint-order-source.json)绑定两个存储 owner 的修复与 Web 录制会话。原实现中，较早的 checkpoint 可在较晚的 flush 完成后才入队，最终用旧值覆盖较新的持久化记录；回归已直接复现该旧值落盘。现在 KvTable.put 先占据队列位置，再执行该位置的日志持久化前置操作；失败时不写入、不发事件，后续写入仍可继续，Domain.close 等待已接受的操作完成。

保留上游的投影深复制、formatVersion、isSeeded、inheritedEventCount、旧缓存读取和 Session 日志格式。两套 owner 测试 71/71，真实 Web Loader 组合的 [authored Session 回放](snapshots/web/checkpoint-order/session.v3.jsonl)通过 1/1，逐项比较了标题和恢复产生的权限/sandbox/审批事件。语料门禁 3/3；恢复队列外等待、跳过前置操作两项对照均被拒绝。扫描排除无关的 Python 临时缓存后，新增未登记源码快照也仍被拒绝。Host 构建、完整 lint:contracts-ready 与 doc-sync 34/34 通过。

该阶段来源记录中的后端直接卸载缺口由上节 Storage owner 修复补齐。HostDescriptor、Capability/Version/Error、幂等操作和旧数据转换没有因此完成；当前没有调用真实模型或重建 Desktop/SEA/wheel，之前的产物保持各自来源与验收范围。Phase 3 尚不能据此晋级 Architecture/Contract Gate。

## Windows Desktop 原生运行时与打包应用

[Desktop 打包来源记录](artifacts/upstream-first/desktop-package-source.json)绑定打包前 163 个候选文件及补丁。移除已不属于生产依赖的 fs-ext 检查、安装许可和复制特例；保留当前 Koffi、Sharp、HTML、PTY 原生执行，并通过实际外部插件验证 JSONL 同会话的并发写入拒绝、持有期间读取和释放后接管。Session 实现及存储格式未改变。定向测试 29/29、两项行为拒绝对照、doc-sync 34/34 与完整 lint 通过。

官方 Windows x64 unsigned 命令已生成 0.1.5-rc.2 NSIS 安装包，包含 Node 24.17.0 和 pnpm 11.7.0；包内原生操作、真实 Host 与 Session lease smoke 通过。[产物核验](artifacts/upstream-first/desktop-packaged-output.json)确认候选源码与打包前快照一致、ASAR 的 10 个 Shell/renderer 文件匹配及官方 runtime-tree 完整性。应用 EXE 和安装包的 Authenticode 状态均为 NotSigned；没有执行安装或发布。

[实际打包应用回执](artifacts/upstream-first/desktop-packaged-final.json)记录从 app.asar 和包内独立 Node 启动，加载 51 个 Client 入口，并完成真实页面设置、[浅色](artifacts/upstream-first/desktop-packaged-settings-light.png)/[深色](artifacts/upstream-first/desktop-packaged-settings-dark.png)、托盘隐藏、第二实例恢复、关闭偏好还原及[插件管理页](artifacts/upstream-first/desktop-packaged-plugins.png)只读检查。Shell 退出码为零，已观察的 Host 和子进程均退出。私有数据目录没有模型密钥，未安装 registry 插件、迁移用户数据或注册系统登录。

沙箱启动曾因 GPU 子进程崩溃退出，相同 EXE/参数在主机完成验证。两个 UI 探针分别错用插件页路径、在窗口异步关闭完成前计数；按实际路径和关闭状态补验，原始失败回执保持不变。构建内生成插件的 Loader 验证不等同于公开插件安装；旧 SEA/wheel 的 pnpm junction 拒绝仍未解决。安装、签名、更新、系统登录、macOS、真实模型及完整视觉矩阵仍待验收，Phase 2 保持 IN_PROGRESS。

## HTML 注入查找

共享 Web/Desktop index 渲染器已迁入已审查的线性查找修复：重复且未闭合的 head/body 前缀不再导致反复扫描。保留大小写、空白、带引号属性、注释、缺失标签的文本匹配行为，以及逐字节输出和注入顺序。修复前两项大输入回归触发子进程超时；修复后源码/Loader 组合 34/34、构建后公共导出 30/30、doc-sync 34/34 和 lint:contracts-ready 通过。

[源码记录](artifacts/upstream-first/web-injection-source.json)绑定源码、库产物、回执和检查日志；[构建后验证](artifacts/upstream-first/web-injection-built-smoke.json)使用普通 Node 加载公共导出。后续已在同一源码上运行 Windows Desktop 命令验收，见下节；exe/wheel 尚未重新构建，打包及原生界面结果仍限定于各自记录。

## Desktop Node Host 工具执行

通过官方开发启动器和新建数据目录运行真实 Windows Desktop；标准 Session 使用真实 loop、受限 PowerShell、文件操作和进程管理，仅模型返回由脚本提供。[验收回执](artifacts/upstream-first/desktop-execution-smoke.json)记录正确工作目录、中文文件字节、stdout/stderr、敏感变量过滤、受管 DSH 变量及退出码 37。用户取消后，PowerShell、Node 和孙进程均已退出，日志记录 ABORTED；原生退出后 Shell、Host 与启动器正常结束。

受限孙进程的 Node 管道式 stdio 返回 EPERM，与上游已记录的限制一致；继承 stdio 的进程树取消通过，不表示管道捕获可用。[该次源码与产物记录](artifacts/upstream-first/desktop-execution-source.json)绑定实际模块入口、模型请求和执行回执；缺少 Desktop 场景说明的观察保留为历史，后续补齐见下节。没有调用真实模型、验证 macOS/Bash、安装包或系统登录注册。

## Desktop 模型上下文

官方私有 Desktop Host 通过现有 SystemPrompt 注册说明：当前窗口与 Session 位于同一机器，命令和文件工具使用 Session 工作区及其声明的执行环境，窗口不会隐式提供 DOM、路由或截图，另启 Web server 不会更新当前窗口。完整 persona 会抑制这段说明，移除后恢复；沿用现有 system/message 日志，无新增协议或旧 Desktop bundle。

[Desktop 上下文源码记录](artifacts/upstream-first/desktop-context-source.json)绑定 4/4 行为测试、源码与构建模式各一次 keyless 会话回放、doc-sync 34/34、lint 与实际 Host 构建。[Windows 开发应用验收](artifacts/upstream-first/desktop-context-smoke.json)的默认、完整 persona、恢复三次模型请求均与组装提示和最新日志一致；退出后的磁盘日志含三条匹配提示，Shell、Host 和启动器正常退出。快照为现有 PONG 记录的 authored 派生，应用使用脚本模型；未验证真实模型、macOS/Bash、安装包或系统登录，exe/wheel 未重建。后续工具包修复有独立记录，未重跑完整 Desktop 应用。

## 原子写锁与路径处理

已迁入锁释放检查竞态与路径末尾分隔符线性扫描：EPERM 后检查得到 ENOENT 时立即重试一次独占创建，持续错误仍抛出；长串内部斜杠不再被后缀正则反复扫描。保留上游 Windows rename 重试、路径分隔符和文件地址 API。当前消费者均写字符串，原始字节 API 留待诊断导出存在实际消费者时再审。

[工具包源码记录](artifacts/upstream-first/helper-fixes-source.json)保留修复前的竞态失败与路径子进程超时，以及修复后 81/82 项目标测试结果；剩余符号链接用例在 Windows 主机创建 fixture 时被 EPERM 拒绝，未运行到产品代码。最终锁用例 6/6、doc-sync 34/34 与完整 lint 通过。[普通 Node 构建后验证](artifacts/upstream-first/helper-built-smoke.json)通过 7 个路径用例和 4 个真实文件写入者的并发更新、锁清理。未改变地址语法或模型文本；这些库验证不构成完整应用、安装包或其他平台验收。

## 官方 Windows 进程管理

采用当前 upstream 的 WindowsJobRunner、WindowsJobOwner 与共享 Win32 process 实现，没有迁入旧 bootstrap 或第二个 Job wrapper。[源码与场景记录](artifacts/upstream-first/windows-runtime-review-source.json)映射挂起创建、加入 Job 后恢复线程、失败清理、stdio、直接退出与整个 Job 清空的区别，以及取消和 Host 退出回收。真实 Windows Job 用例 4/4、测试 Host 退出用例 4/4、共享失败路径 26/26 通过。另一个契约套件通过 53 项，两个原有 fixture 符号链接创建受 Windows 权限限制，两个 POSIX 场景在各自套件按原规则跳过；不把这些限制记为完整套件通过。

该记录还收窄了旧 CLI 参数版 wheel 的插件安装故障：[六条入口对照](artifacts/upstream-first/installed-chain-probe.json)证明绕过 Python 入口仍可复现；[同字节独立目录副本](artifacts/upstream-first/runtime-location-current.json)也无法让其 Node 子进程创建 junction。已检查的环境字段、token 组、受限组、权限、完整性级别和默认 DACL 在对照中一致，两个原 exe 没有额外 NTFS 数据流。原生 Python junction 探针在安装入口链中超时，安全属性读取则能完成。根因仍未确认，没有修改 ACL、token、兼容层或系统策略，也没有重新宣布真实 pnpm 安装通过。

安装入口的[原生 junction 分步记录](artifacts/upstream-first/junction-steps-source.json)进一步确认：直接 Python 和仓库 runtime 能创建并读回链接；安装后的同字节 runtime 可以打开私有目录，但 DeviceIoControl 的 FSCTL_SET_REPARSE_POINT 返回 Win32 错误 5（拒绝访问），随后关闭 handle。该次 wrapper 也超过 20 秒观察期限，taskkill 返回 128；这些结果分别保留，不把最终退出码当作未超时。该探针针对已有 CLI 参数版产物，未重建当前源码，也未验证真实插件安装成功；拒绝来源仍未确认。

## Windows 原生目录选择

采用上游 Koffi 指针地址 buffer 与 str16 解码，保留 NUL 终止、Unicode 和长字符串读取；没有恢复旧的固定外部 buffer 或 Win32 字节复制。补齐解码抛错时的 COM 路径释放，既有 item、dialog 和 apartment 清理保持有效。修复前释放回归失败；修复后包测试 53 项通过、1 项按平台跳过，doc-sync 34/34 与完整 lint 通过，见[源码记录](artifacts/upstream-first/picker-source.json)。

[实际 Windows Desktop 验收](artifacts/upstream-first/picker-desktop-smoke.json)通过官方开发启动器、新建数据目录和当前构建 Node worker，经 live Host capability 打开真实 COM 对话框。中文及 emoji 目录精确返回，用户取消返回 null，Abort 在对话框可见后触发并拒绝；三个 worker 均退出，Shell、Host 和启动器正常结束。此证据未覆盖 renderer 的完整工作区选择流程、安装包或其他平台；解码异常时的释放来自单元回归，未进行原生分配器的泄漏测量。此前 exe/wheel 与其他 Desktop 场景保留各自来源记录。

## 测试观察与入口审查

[当前测试记录](artifacts/upstream-first/fixture-observation-source.json)绑定三处测试修改：React 计时器刷新等待 act，文件搜索通过 rename 发布已填充的恢复目录，凭据重载同时核对不同的保留值和已删除项，避免把空文档或旧值当成替换完成。最终三个文件通过 95 项、2 项按原规则跳过；另一个 3 项定向测试进程与其重叠运行通过，doc-sync 34/34 与完整 lint 通过。修改前的三个目标用例也通过，本机没有复现原间歇失败；相关产品源码、运行时超时、CI 路由与会话预期未变。

保留上游显式 Linux/WSL 内核 fixture 及新版 PowerShell held-command/scrollback 观察，不迁入旧超时增大；Linux /dev/tty 输出和初始提示保留仍待平台审查。HMR 入口维持官方 vendor：source/built dsh 和 Desktop Host 以文件启动，锁定的 pkg SEA bootstrap 在载入应用前设置 argv[1]。源码审查没有增加安装包、外部 CLI 或其他平台的运行验收。

## 内置 profile 组合检查

[组合检查记录](artifacts/upstream-first/profile-composition-source.json)绑定实际 CLI profile 清单、Desktop core bundle 顺序与私有 patch，并复用官方解析和组合函数。检查会拒绝最终 Loader 树中的重复 id，以及最终 Host 配置与内置 preset 的重复活跃条目；合法覆盖、独立 profile 复用 id、禁用祖先及未执行的表达式有对应测试。目标测试 34/34、doc-sync 34/34 与完整 lint 通过；没有加入旧 Desktop bundle 或另一套 patch 合并器。

正式命令的前后对照分别证明：重复 headless-runner 和 Desktop 重新启用 command-goal 由接受变为拒绝。最终回执记录实际脚本 SHA；正确配置 fixture 的 155 份配置通过。原 Windows 工作区的完整命令仍失败，因为 ACP 的 Git mode 120000 配置被检出为链接路径文本。验收只临时物化已核实的仓库内目标并恢复原始字节，不改变检出设置、ACL 或源文件；不能将 fixture 通过记为原工作区或安装包通过。来源记录保留该失败日志，平台与插件安装任务仍未完成。

## LSP 请求取消与传输错误

[LSP 源码记录](artifacts/upstream-first/lsp-observation-source.json)绑定请求到达 marker、请求与取消 id 核对、取消后同一实例再次查询，以及真实子进程 stdin 错误在进程关闭前拒绝当前和后续请求。忽略取消的场景先观察子进程结束，再接受查询拒绝。保留上游 LSP 产品源码、生产超时和协议，仅迁入测试观察。

最终两套测试 46/46 通过，同时运行的 6 项定向测试通过；恢复固定等待和移除 stdin 错误传播的两项对照均触发预期失败，原字节已恢复。doc-sync 34/34 与完整 lint 通过。沙箱运行曾在 stdin 用例和退出清理超时，核实并清理本次进程树后，相同测试在主机通过；超时根因未单独确认，失败日志保留。此记录不构成已安装语言服务器、真实外部 CLI、安装包或其他平台验收，相关测试迁移仍有剩余工作。

## Codex 命令完成观察

[Codex fixture 记录](artifacts/upstream-first/codex-fixture-source.json)绑定独立 call id、最新命令结果归属和 yielded session 轮询。只有工具元数据明确给出退出码零才完成；无关或重复结果、非零退出、缺少轮询工具及命令自身打印的成功文本均不能冒充完成。重复 call id 在修复前已复现失败，两项受控漏检也被最终测试拒绝。

本地 HTTP fixture 17 项和真实 Codex 0.153.4 的 Windows 用例 8 项全部通过，另一个进程的 2 项命令测试重叠运行通过。yielded 命令由私有文件屏障保持运行，观察到轮询后才释放；最终核对文件内容及受管进程退出。doc-sync 34/34 与完整 lint 通过，provider 源码、固定依赖、权限模式和生产超时不变。实际 CLI 使用脚本模型，此证据不代表真实模型、安装包或其他平台验收；临时目录别名、PowerShell snapshot 和 featured-plugin 预热警告保留在日志中。

## SDK 与 Claude 等待策略

[当前源码审查](artifacts/upstream-first/sdk-claude-review-source.json)保留上游 SDK 请求观察和 Claude 清理预算。旧 SDK 补丁将轮询放宽至 5 秒，旧 Claude 补丁为 afterEach 固定 60 秒；本机的 SDK 对应测试通过 1 项，Claude Agent SDK 0.3.263 / CLI 2.1.263 的实际 Windows 进程场景通过 8 项，没有迁入两项超时增大。版本、Session projection 和其他上游架构保持不变。

Claude 测试通过本地 Messages fixture 验证设置继承、并发实例、进程失败、拒绝写入、显式 bypass、plan 与取消后进程退出。此记录为源码审查和本机运行证据，不证明 CI 负载下的时序，也不提供真实模型、安装包或 macOS 资格；未修改测试、产品源码或主机设置。

## Windows 产物验证

[Python 入口历史记录](artifacts/upstream-first/windows-wheel-source.json)保留该次源码、exe、sidecar、wheel 与执行回执；最新 CLI/运行时见下节。Windows Python entry 的等待、继承 stdio、复杂 argv 和 DWORD exit 验证完成：21/21 定向测试及四个真实 native ExitProcess 状态通过。smoke 的显式 UTF-8 修复通过 47/47；profile 安装的 pnpm 工作区根目录许可通过 2/2，许可仅作用于本次调用。

保留的 exe 已在 CLI 参数修复后按官方流程完整构建并重新打包，尚未包含本次 HTML 查找修复。[该产物的仓库外 Web 验收](artifacts/upstream-first/packaged-argv-web-smoke.json)验证认证、53 个插件入口、Session RPC、真实 Chrome 设置/明暗切换及退出清理。Windows shutdown 使用测试标记在进程内发出 SIGTERM，没有验证原生系统信号。

[当前已安装 wheel 验收](artifacts/upstream-first/installed-wheel-argv-temp-smoke.json)在 checkout 外安装非 editable SDK/runtime，未设置 PYTHONPATH 或 DSH_RUNTIME_MODE：11/12 通过，sdk-profile-plugin 失败。[非 Temp 对照](artifacts/upstream-first/installed-wheel-argv-normal-smoke.json)只执行该插件场景，同样在 pnpm junction 创建处失败。两者均选择 pnpm 11.7.0 和独立 store；pnpm 10.2.1 忽略 profile 工作区设置属于另一个已发现限制。所检查的进程权限标志一致，但不证明完整 token/ACL 等价，根因尚未确认。未修改全局 ACL、Developer Mode、注册表或 pnpm 配置。

## Windows 插件参数

`dsh plugin` 通过已有的 execa 运行依赖保留字面 argv，避免 Windows shell 拼接导致路径拆分和元字符执行。普通全局 shim 和 node_modules/.bin shim 的真实回归在修复前均失败；修复后 CLI 8/8、源码启动 2/2 和 Python smoke 47/47 通过。官方插件 smoke 的目录现在包含空格、中文和 &，现有预期输出保持不变。

[已安装入口验证](artifacts/upstream-first/installed-wheel-literal-argv.json)证明新 wheel 的公共 dsh.exe 在两种 shim 下均完整传递参数，且没有执行命令标记副作用。该验证使用记录参数的 fixture shim，不代表真实 pnpm 安装成功。新 exe 与两个 wheel 已由官方流程构建并校验；[源码/产物绑定](artifacts/upstream-first/cli-argv-source.json)记录完整构建、安装、Web、参数和失败证据。

## Desktop 旧设置导入

官方 Shell 的原生菜单支持选择旧 JSON/YAML 文件并预览，默认取消；确认后只迁入关闭行为。解析拒绝未知版本、错误字段、重复字段、无效 UTF-8 和超过 1 MiB 的文件；确认时重新验证源摘要。登录偏好仅作提示，系统登录仍由原生菜单与 OS 管理。原文件及其他 namespace 保留，现有托盘和原子写入 owner 保证失败时不覆盖偏好。

[本轮源码/产物记录](artifacts/upstream-first/desktop-import-source.json)绑定 Shell 构建、73/73 定向测试、最终 main 25/25 和双语文档检查。[真实 Windows 回执](artifacts/upstream-first/desktop-import-smoke.json)与[原生预览截图](artifacts/upstream-first/desktop-import-preview.png)记录生成文件的选择、确认、取消、关闭隐藏、恢复、撤销以及 Shell/Host 退出。控件通过 UI Automation 操作；激活恢复通过原生事件回调验证。没有读取旧用户文件、调用模型或注册系统登录。退出时 renderer 记录一条 control-stream network error，两进程均正常退出。

Desktop 导入的源码、Shell 构建与原生回执保持原摘要；后续 CLI 参数修复有独立的新 runtime/wheel 记录。两者都不构成 Desktop 安装包或系统登录验收。

## 历史证据与未完成范围

官方 Desktop 的真实开发页面、设置/主题、独立 Node Host 和退出验证见[初始回执](artifacts/upstream-first/desktop-smoke.json)；真实托盘隐藏、第二实例恢复和退出见[托盘回执](artifacts/upstream-first/desktop-tray-smoke.json)。早期 packaged 和 profile recovery 记录保持原摘要，分别对应当时源码与产物；不以当前文件替换历史证据。具体定向测试保留在[机器回执](artifacts/upstream-first/evidence.json)。

旧 Desktop settings 的关闭偏好已通过原生选择与确认显式导入；Host settings 的完整格式转换及真实用户数据迁移未实施。完整视觉矩阵、真实模型、原生系统信号、Desktop 安装/更新/系统自启动、macOS/Linux 产物及移动真机均未验收。

## 执行入口

继续在 `agents/upstream-first` 和 `.worktrees/upstream-first` 执行[实施计划](docs/plans/2026-09-14-upstream-first.md)。未 commit、push、发布、修改其他工作树或迁移用户数据。

## 文档与审计校验

审计一致性校验通过，准入和任务状态回归 13/13；各次源码/记录/回执篡改拒绝检查与 Desktop 历史绑定拒绝检查通过。其来源文件和命令见机器回执。HTML 修复后的 doc-sync 34/34 与 lint:contracts-ready 已通过；上一轮 CLI 的 test:docs 16/16 保留为该次记录。初次 Windows 文件符号链接权限失败已通过等价 junction fixture 修复，仍断言 realpath 指向仓库外并拒绝复制；定向重跑 69/69 通过。审计源码校验将这项尚未提交的测试改动记录为独立 SHA-256，不把带工作区改动的测试等同于纯 upstream 提交。初次中英目录锚点问题也已修复。

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
