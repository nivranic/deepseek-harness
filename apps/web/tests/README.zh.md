# apps/web 浏览器 e2e

[English](README.md) | 中文

浏览器测试用真实 Chromium 通过 HTTP 驱动应用。进程内测试通道的运行机制——模式、fixture（测试前置数据）、golden，以及与 `dsh web` 的组合差异——记录在 [`scaffold.ts`](scaffold.ts) 和 [浏览器 e2e Agent Note](../../../.agents/notes/implemented/testing/2026-07-24-web-gui-browser-e2e-lane.zh.md) 中。

[传输失败用例](transport-failure.e2e.ts) 在请求送达 Host 前从浏览器中断 Prompt。真实 Client 显示 `gateway/transport-interrupted`，并在重连时不重发该变更。预期观察固定可见诊断、保留的草稿、重连前后仅一次请求，以及显式重试后才发送第二次请求；已接受用户消息为零。该场景不调用模型，也不验证原生设备。

[清单错误用例](plugin-inventory-capabilities.e2e.ts) 通过受控 HTTP Remote envelope 提供未知错误码。英文和中文页面均保留本地化通用失败状态，仅在显式重试后恢复真实 Loader 清单。[命令拒绝用例](commands-capabilities.e2e.ts) 还固定未经包装的 Host 诊断以及零次 handler 执行。这些注入响应代表较新 Host 的错误，不是新旧应用二进制兼容性测试。

[Approval](tool-reused-id.snapshot.ts) 和 [Question](question-retry.snapshot.ts) 传输恢复用例通过 `dsh --profile web` 与场景 patch 启动独立进程。录制 Session JSONL 同时充当模型输入与完整持久化日志预期。HTTP 故障注入覆盖 Host 接受前丢失和接受后确认丢失；Question 用例还暂停一个 Client 的回答，让另一个 Client 提交不同回答。主 fixture 保持只读，每个进程使用隔离的设置、凭据和技能根。其 snapshot 通道通过 `DSH_EXAMPLE_MODE=lib` 使用已构建 Client bundle；这些检查证明录制数据下的传输行为，不证明真实模型服务行为。

[交互回答协议用例](interaction-closed.e2e.ts) 将一次浏览器回答改为不支持的协议 3，并接收真实 Host 拒绝。Client 显示升级状态，在浏览器虚拟时钟推进 60 秒期间不重新协商，且要求手动重连后重新回答同一待处理审批。该用例不模拟二进制升级、Host 休眠或设备切换。

[流失败用例](transport-failure.e2e.ts) 向真实隔离 Host 连接注入无效 JSON、二进制帧和无效交互记录。中英文控件在浏览器虚拟时钟推进 60 秒期间暂停自动重试，保留输入草稿，仅在显式点击后恢复。既有 Prompt 传输中断用例保持普通自动重连和显式变更重试。这些受控 wire 失败不代表物理网络、已发布版本或原生设备验收。

[命令能力用例](commands-capabilities.e2e.ts) 使用真实隔离 Host 及其命令注册表。受控发现声明区分目录访问与执行，受控延迟把真实处理器回执保留到重连之后。预期输出检查本地「文件」可用性、Host 行撤销与恢复、提交文本保留，以及处理器仅调用一次且不自动重放；不验证回滚或真实提供方行为。

[Goal 能力用例](goal-capabilities.e2e.ts) 在真实隔离 Host 中播种未激活 Goal。受控声明分别选择无访问、只读、仅编辑和完整支持。真实编辑先提交，暂留的响应随后因替换连接而取消；新编辑器草稿与消息输入框在旧响应释放后保持。预期输出检查仅一次编辑事件且不重放。Commands 用例还会等待连接变更提示出现，再断言提交文本保留。

[Subagent 能力用例](subagent-capabilities.e2e.ts) 在隔离 Host 中启动真实可继续子级，并用脚本化回放保持其模型调用。受控发现声明分别撤回目录与提示词支持，同时保留 Stop、已选子级及草稿。实际点击 Stop 产生一次持久化 aborted 轮次；恢复支持不发送提示词，也不启动替换轮次。缺少父级目录提示时，驻留输入框保持可见且只读，不隐藏受支持的中断动作。这证明产品运行时与浏览器在受控模型输出下的集成，不证明真实提供方或原生设备行为。

[Feedback 能力用例](feedback-capabilities.e2e.ts) 在真实隔离 Host 中播种已完成助手消息，不执行模型调用。受控声明验证缺失入口、只读展示及独立的 put、delete 和 Session record 支持。真实 put 先提交，暂留回执随后因重连取消；独立打开的替换草稿在旧回执释放后仍保留且没有旧 toast。随后执行一次真实 delete 和一次 Session 备注，检查精确日志事件及无重放。本用例不证明真实提供方、原生设备或变更回滚行为。

[上传能力用例](file-upload-capabilities.e2e.ts) 使用真实原生选择器动作和隔离 Host。受控发现与原始上传响应送达验证独立图片接收、旧选择器拒绝、活动与排队上传取消、已完成回执失效、草稿保留和显式重试，不自动重新暂存。Host 在延迟响应释放前实际存储字节。本用例不执行模型，也不验证真实提供方或原生设备行为。

[插件清单能力用例](plugin-inventory-capabilities.e2e.ts) 在隔离 Host 中读取真实 Loader 条目。受控发现撤回标签页，首次读取的暂留响应跨越能力相同的重连。替换页面读取已经变化的 Loader 行，旧响应释放后仍保留新页面的搜索与展开状态。随后撤回能力会移除标签页，恢复时页面状态清空，独立输入框草稿保持。本用例不调用模型。

[动态 Cordis 能力用例](dynamic-cordis-capabilities.e2e.ts)在隔离 Host 中定义真实的纯 Host 包与双半部包。受控发现区分只读清单、激活、拒绝、Stop 和 Remove。待拒绝请求可以由清单重建；重连卸载 Client 代码且不重放激活。真实 Stop 在 Host 完成后，其受控延迟回复被取消，释放旧回复后新面板仍保留自己的版本选择。用例核对精确变更调用和保留的输入草稿，不发起模型请求，也不验证真实提供商行为。

## 完成状态观察

[Home 路径 fixture 适配器](fixture-home-paths.ts)仅在路径字段、工具参数的路径属性和 read 结果的 `<path>` 标记中，将场景所属的精确路径保存为 `{{harnessHome}}`。完整 Session 比较前，它按当前隔离 home 和原生分隔符展开这些显式预期 token；JSON 工具参数保留正确转义与原有空白。捕获支持 Windows 原生路径和斜杠路径。相邻目录、路径后缀、文件内容、无关参数与普通文本仍可检测差异。共享 Session 归一化器不变，[上传录制](../../../snapshots/web/file-upload-round/snapshot.yml)保留完整预期 Session。

[Cordis 录制生命周期](cordis-tool-round.e2e.ts)按真实 Host 平台选择请求头归属：[Windows](../../../snapshots/web/cordis-tool-round-windows/snapshot.yml)固定正式 PowerShell 提示词与工具 schema，[POSIX](../../../snapshots/web/cordis-tool-round/snapshot.yml)保留 Bash。两者通过真实工具与审批回放相同的模型轮次，并比较完整持久化 Session、完整提示词/schema 文件与 UI。平台选择不修改产品配置、不删除断言。refresh 只更新所选平台的归属文件，replay 不写入任何一组 fixture。Windows 证据不代表 POSIX 实测或真实提供商行为。

Question 恢复驱动在对话完成后等待本地化预设名称。预设元数据可能晚于答案和历史记录到达，较早截图显示预设 id 属于合法的加载中状态。失败时，驱动仅保存预设列表响应状态、错误码和内置预设显示信息，以区分列表缺失与渲染延迟，不记录认证输入。

Question 驱动还注入不受支持和畸形的 Host 发现版本。它检查本地化失败操作、发现不自动重试且事件未就绪，恢复发现后显式重连，再完成原有录制 Session。

认证恢复场景清空隔离浏览器 context 的 cookie，然后在重新发现、输入框提交或已完成的 Question 回答提交时触发真实 Host 拒绝。第二个标签页执行既有启动令牌交换，原标签页显式重连。被拒绝的 Prompt 需要显式提交。保留的回答仅在 Host 再次投递匹配的待处理交互时重试。认证失效前已被接受的回答，或恢复暂停期间已由独立认证的 Client 完成的交互，都不再发送旧回答。每项场景都把完整 Session 与未修改的 fixture 比较。这些场景不等待 cookie 自然过期，也不模拟设备撤销。

Question 的 Host 身份用例在回答于接受前丢失后，仅改写发现与协商响应中的身份。替换连接必须重新打开 Question，不能自动发送保留回答；第二次显式回答完成未改动录制的完整 Session 与工作区比较。该用例使用一个真实隔离 Host 和受控发现响应，不代表两个物理 Host 或 Device Trust 验收。

Host 就绪场景暂停第一个真实事件 ready 帧。一项在等待提示出现后释放，验证同一 socket 就绪；另一项将其保留到配置的硬期限之后，验证自动替换的 socket 就绪。两者均完成原 Question 录制流程，比较完整 Session 和工作区。

认证阶段场景暂停前两次真实 `host/describe` 请求，观察首次握手及 socket 丢失后的 `authenticating` 状态，检查收起轨道的指示器和初始认证前没有业务请求，再分别放行请求。恢复后的页面完成原 Question 录制流程，比较完整 Session 和工作区。

连接阶段用例保留前两个真实 ready 帧，分别观察首次连接与重连。它记录就绪确认，将真实浏览器 context 切为离线并推进时钟，证明离线期间没有 socket 尝试，再恢复网络并释放替换帧。随后用原 Question 录制验证对话与持久化 Session。

Approval 和 Question 录制驱动还会在首次回答 HTTP 请求被暂停时刷新页面。Host 尚未接受回答时，同一个待处理交互重新出现，测试会显式再次回答；新 Client 不保留前一页面已填写的回答。Host 已接受后再刷新时，结果保留在对话中，不再打开问题或审批。刷新使用不含启动 token 的应用 URL 和已有认证 Cookie。两种情况均比较完整 Session 和工作区结果。

[交互取消用例](interaction-cancel.e2e.ts)使用官方 Web profile 与本地模型 fixture。它们在首次投递前、自动重试后或真实 HTTP401 后暂停 Approval 或 Question 回答。第二个 Client 通过公开取消 RPC 取消已记录的回合；认证失效时，该 Client 使用独立 Cookie context。持久化错误、终结记录和审批标记文件未生成共同证明取消结果。重新认证不重发已取消的回答；后续回合拒绝迟到回答及重复的旧取消请求，不影响新交互。这些是真实进程下的定向持久化事件断言，不是完整录制 Session 比较或真实模型服务测试。

依赖状态的用例使用 Workspace、接纳、附件和模型流屏障，区分可见中间状态与已完成操作。详情关闭等待框架过渡结束；归档验证为 seed Session 设置显式标题，并跨重载跟踪该身份。参见 [CI fixture 同步决策](../../../.agents/notes/implemented/testing/2026-09-08-ci-completion-observations.zh.md)。

## 这些是 Host 面的测试

它们在根 `tsconfig.host.json` 中做类型检查，而不在 Client aggregate 中，因为它们直接读取 Host 服务：`ctx.connection`、Host 侧 `SessionStore` 与 `ctx.sessionProjectionCache`。运行时驱动浏览器并不使一个文件成为 Client 程序的一部分——两个 face 在相同的键上以不同服务合并 Cordis `Context`，因此单个程序无法同时看见两者。把这些文件挪进 Client aggregate 会让每一处 Host 服务访问都无法编译。

## 不要在此 import `@deepseek-ai/dsh-client-*`

import 一个 Client 包——无论值还是类型——都会把它整个 TypeScript 工程、以及它引用的每个工程拉进 **Host 构建图**。这已经坑过本 lane 一次：四个 Client 消费方包引用了 `api/remotes` 的 Client face，而该 face 必须等 Host tsdown 生成 `@deepseek-ai/dsh-goal/remote` 之后才能编译，于是 Host 构建阶段变成在等一个由它自己产出的产物。

当某个场景需要 Client 持有的常量或纯函数时，改为在此处镜像一份，并紧挨着一条注释掉的 import 点明源模块。这样漂移会表现为选择器未命中或镜像值陈旧——是响亮的失败，绝不会是静默通过。`scaffold.ts` 按此规则镜像 welcome-notice 的 namespace、确认字段、版本和被断言的中文文案。

有一类 Client import 是长期成立的。`assembled-boot.ts` 驱动 shell 本身，因此它从 `@deepseek-ai/dsh-client-web` import `AppWebEntry`、从 `@deepseek-ai/dsh-client-modules/client` import boot manifest（元数据清单）类型：启动真实 shell 正是该 harness 的用途，且这两个包本来就在 Host 图中。chat 场景则在 `support.ts` 中镜像 `conversationContextKey`，而不 import 其 Client owner。

没有任何机制强制这条规则；靠 review 守住它。

[预设能力浏览器用例](preset-capabilities.e2e.ts) 仅控制真实 Host 的发现声明，并替换实际连接。它验证目录能力缺失时不探测预设或目录打开器、仅目录可用时仍可查看、管理能力恢复，以及撤回时关闭已打开的复制弹窗。它还在仅缺失对应 Settings 能力时禁用预设偏好并停止目录探测，将真实预设复制到私有临时根目录而不打开目录，随后恢复支持并验证路径显示和默认项持久化。既有创作测试覆盖层关闭原生打开。拥有方本地预期记录精确的修改调用；该用例不执行模型轮次，也不证明设备授权。

同一能力用例分别撤回 Settings 读取与文档打开支持，检查缺失的读取及原生打开请求均未发送，再验证文档入口恢复。冷启动 RPC 预算用例以元数据派生的文档入口为完成标志，要求只发生一次共享 describe，不通过睡眠推断完成。

Models 能力用例过滤实际 Host 发现结果，验证缺失的目录和凭据请求没有发出，检查凭据写入与模型发现控件独立变化，并在凭据草稿打开时替换连接。用例断言草稿被丢弃，且没有发送凭据变更或端点发现请求。生成的草稿不会被截图保存。

[Host 发现](host-description.e2e.ts)中的 Workspace 操作用例通过实际连接替换分别撤回注册表、Session 组织与跟随能力。它检查独立控件、未发送的跟随请求、已清除的旧行、关闭的弹窗，以及恢复后一次真实重命名。Session 内容由用例写入，不调用模型；该用例不证明真实提供方或设备授权验收。

目录操作用例检查选择器请求未发送、只读浏览接纳、草稿释放，以及连接替换取消待响应请求之前已提交的真实目录创建。Host 已创建的目录保留在磁盘上；已放弃的交互不能继续列目录或注册工作区。能力恢复后通过新交互显式接纳该目录。所有者测试另行交付迟到的已解码结果。测试组合使用浏览后端，原生 OS 对话框与设备权限不属于这份证据。

Web-search 能力用例使用隔离的搜索凭据引用，不调用搜索端点。它验证缺少凭据 API 支持时普通 Settings 仍可持久化、元数据与写入能力组合、重连后的草稿丢弃，以及恢复后显式保存合成密钥。凭据只通过布尔包含断言核对，原值不写日志、设置文档、观察记录或截图。既有插件配置用例通过实际 Host 写入覆盖共享暂存表单。

文件资源能力用例在缺少元数据与观察能力时打开真实工作区文件，然后仅恢复元数据，并在 Host 写入文件后替换连接。新元数据与替换后的预览注册会重新读取保留的 tab，无需观察流。恢复观察能力后会收到后续受观测写入；撤回期间不发送元数据或变更流请求，恢复后重新打开仍被持有的资源。[文件 UI 能力矩阵](file-capabilities.e2e.ts)另经真实连接替换验证：缺少列目录时没有入口、仅列目录时文件名称不可点击、文本/代码回退、完整字节图片预览、HTML 依赖读取，以及无需列目录的文件预览。

[Subagent 对话录制](subagent-conversation.e2e.ts)通过真实 HTTP 重复提交浏览器已接受的 Prompt，覆盖并发重试与子级结束后的重试。所有回复必须返回原消息 id，日志只能保留一次入队，冷状态重试必须保持完整持久化子级日志不变且不恢复子级。既有组合 UI golden 保持只读。模型响应使用录制回放，不属于真实提供方证据。

[Subagent Stop 录制](subagent-interrupt-ui.e2e.ts)使用按目标中断 RPC，并在第二个子级轮次保持打开时重发首次已接受的 HTTP 请求。旧目标必须得到确认且不能停止该轮次；新的浏览器点击停止已观察的第二轮。既有暂停 inbox、FIFO、转录和输入框 golden 保持只读。父级可用状态通过目录响应控制；该测试不证明物理断开的父级、设备授权或真实提供方行为。
