---
description: "应用 Remote 装配：为 Client 消费方选择带类型的 Host 能力与转发事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-api-remotes

[English](README.md) | 中文

## 概述

为本应用选定的 Host Remote 能力提供双侧 BFF。Host 入口拥有转发事件名单并向 API Gateway 注册应用事件 source；Client 入口以运行时值形式导入生成的 `/remote` 产物，通过 `ctx.remote.$mount()` 挂载每项贡献，并重新导出对应的声明合并。Client 业务包依赖该外观，而不依赖 Gateway 实现或单独的 Remote 运行时入口。

## 目录

- [使用本包](#use-this-package)
- [转发的 Host 事件](#forwarded-host-events)
- [构建边界](#build-boundary)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

文件引用、会话候选和技能目录使用各自所有者声明的独立操作集。准入检查在发送前拒绝缺少对应发现能力的调用；Client 功能通过相同声明类型使用能力标识，无需导入 Host 实现。

选入的 `presentedFiles` contribution 提供桌面元数据及持久交付声明的已验证原生操作。Gateway 分别检查所有者声明的三项能力；原生 Host 和文件系统继续执行可用性与路径策略。

-----

<a id="use-this-package"></a>
## 使用本包

Settings 准入使用 Settings Controller 共享的读取、写入、文档打开和预设目录声明。缺少对应操作集的调用在派发前返回 `host/capability-unavailable`；预设能力不能替代这些 Settings 操作集，也不能授予其权限。此外观向 Client 消费方暴露声明类型，不增加跨插件运行时导出。预设消费者以外的配置界面仍需补齐依据能力控制入口的行为。

Agent Preset 准入使用其拥有包共享的目录、选择和管理声明。每个操作在单次调用派发前要求对应能力，其他操作集不能替代。Settings 所有的操作不在这些声明范围内。

Session 调用需要当前连接代次声明对应操作能力。Client 在单次调用或流派发前检查 Session 所有者的共享声明；能力缺失时返回 `host/capability-unavailable`，不发送该操作。这些声明覆盖 Session 跟随、控制、管理和模型选择，并未覆盖所有已挂载命名空间。能力准入不能替代 Host 授权。

[`@deepseek-ai/dsh-api-session-controller`](../session-controller/README.zh.md) 拥有 agent（智能体）与会话身份策略，包括供其他 namespace 使用的 Typert lookup 解析器。本包只选择并挂载生成的会话 contribution，不复制激活策略。

生成的 `host` contribution 暴露 `ctx.remote.host.describe()`。其[拥有方](../host-description/README.zh.md)提供持久身份、独立版本与当前声明的能力；此外观以 Client 安全类型重新导出 `HostDescriptor`、`HostId` 和 `HostTransport`。

Client 组合挂载 Commands、凭据、settings、Goal、动态 Cordis、文件与会话引用、只读 Host 插件清单、消息反馈、会话控制器和 Workspace 控制器 contribution。该组合卸载时，Cordis effect 的所有权机制会撤回所有贡献；`@deepseek-ai/dsh-api-gateway/client` 负责描述符校验、可追踪的 namespace 服务、直接与作用域方法、调用、流与取消。Client 入口通过 Cordis 消费共享的 `TypertClientRemote` 接口，不导入具体 Gateway；它只以 type-only 形式重新导出 Gateway Client face 的声明合并，因此消费端经由本外观取到转发事件词汇时，运行时不会多出一条通往 Gateway 实现的边。

本 facade 同时是 Client 包指称 wire 类型词汇的正门。它以 type-only 方式转出 Remote 失败词汇（`RemoteResult`、`RemoteFailure`、`RemoteErrorCode`、`RemoteErrorDetailsMap`）、Host 事实（`RemoteHostFacts`），以及各已选领域对 Client 安全的载荷类型，因此 Client 功能包只 import 一个 specifier，不必伸手进 `dsh-typert-protocol`、Gateway 或某个拥有方的 Host 入口。有两类包刻意不走这道门：本装配自己选中的 API 层包——反向 import 会形成依赖环——以及它们的测试，后者直接从 `dsh-typert-protocol` 取失败词汇。UI 包的测试则从 [`dsh-client-test-runtime`](../../test-support/client-runtime/README.zh.md) 取 `RemoteError` 构造器。

Client 组合负责发现与协议准入。它使用生成的编解码器校验协议 1 的 `host.describe` 表示，并要求 `host.describe.v1`。公布 `host.negotiate.v1` 的 Host 必须提供有效版本列表；Client 选择最高共同协议，调用 `host.negotiate`，并核验已选版本和未变的 Host 身份。两个协商字段都不存在的 Host 使用协议 1，不探测缺失的方法。矛盾元数据、协商失败和身份变化均拒绝准入，不自动降级。已校验的 `HostId` 为 Gateway 提供交互回答 scope，不依赖显示名称、home 路径或版本；它标识保留回答的归属，不授予回答权限。

准入后的 `HostDescriptor` 可通过 `ctx.remote.$host.descriptor` 读取，归属现有 Connection 代际。在 Host 事件流就绪前该值不可用，代际失效时清除，每次替换均重新发现。初次等待准入的调用可以独立取消，不会取消共享发现。断连或重连期间，新业务调用返回 `gateway/connection-unavailable`，不会排队等待之后执行写操作；因代际失效而取消的已放行调用也不会重放。本包不拥有第二份连接存储或重试循环。Web 或未来的 TUI 只要提供同一份不依赖 React 的 `ctx.remote` API，均可复用其 Client face。已选协议归属该代际，用于编码一元调用、流与事件回复。已接入的 UI 所有者消费准入后的能力与连接代际；完整跨平台 UI 验收仍未完成。

Host 发现会在首次 `host/describe` 请求检查 Host 访问权限前报告 `authenticating`。载体响应成功后恢复连接建立，再校验和协商协议；代际就绪仍须等待事件 ready 帧。任一进度通知触发取消后都不会继续工作。该回调不暴露凭据，也不增加认证请求。

-----

<a id="forwarded-host-events"></a>
## 转发的 Host 事件

`src/remote-events.ts` 持有 `API_REMOTE_FORWARDED_EVENTS`，即本应用不改名转发给消费端的 Host Cordis 事件名单；每个条目还会选择普通发送或 agent-scoped waterfall（瀑布式事件）投递。该名单同时就是 `ctx.remote.$on` 的合法键集，只含类型的 `src/types.ts` 派生其选择面。多转发一个事件只需在该数组里加一项：类型投影、消费端键面与 Host 转发循环全部由它派生。

监听器签名不在此处重写。名单内每条事件的 Cordis `Events` 声明都住在其 owner 包 client-safe 的 `./types` 导出，本包两个 face 都把那些声明纳入编译面。Host face 还会把每个条目断言给 `TypertForwardableEventEntry`：`emit` 条目必须是已声明的单向事件，`waterfall` 条目则必须是已声明的 agent-scoped waterfall，且其最后一个参数是返回相同结果类型的 `next()` 回调。

Host entry 为每条 Client 流独立注册一组 allowlist listener 和一个队列，并在普通事件入队前拒绝非 JSON 参数。对于 waterfall，它只投影顶层 agent 身份与 JSON 请求字段；Client 结果也必须能无损表示为 JSON，而 `next()` 会委托给后续 Host listener。每个作用域 waterfall 请求都必须以 `request.agent` 直接携带路由所用的 agent；Host 会在转发前拒绝缺失或不匹配的身份。该 source 在 `ctx.typertGateway.registerRemoteEvents()` 暴露 Gateway 内部的 `$events` 逻辑流前同步挂好所有 listener，因此首个 `ready` 项既能证明增量投递已就绪，也会携带供 Client 显示路径的 Host home 与 Node.js platform。撤回注册会中止活动流。

Approval 和 Question 条目显式声明交互类型及所需回答权限。Host 事件源附带路由所用 Agent 的 Session 身份；Gateway 持有待处理记录并按协议版本投递。共享名单从 Gateway 中立的 `/protocol` 入口导入这些类型，避免将 Host Context 声明引入 Client 程序。该元数据不实现设备信任或回答授权。

<a id="build-boundary"></a>
## 构建边界

仓库中的多数包只属于一个 TypeScript face：Host 包登记在根 `tsconfig.host.json`，Client 包登记在根 `tsconfig.client.json`。本包需要拆分，因为 Host 入口要参与 Host Typert 图，而 `src/client/index.ts` 必须等 Host tsdown 生成业务包的 `/remote` 声明后才能编译。

本包根 `tsconfig.json` 只是引用 `tsconfig.host.json` 与 `tsconfig.client.json` 的 solution。Host aggregate 和 Host 直接消费方引用前者，Client aggregate 和 Client 直接消费方引用后者；禁止把包根 solution 放进任一 aggregate 的依赖图。两个 project 拥有互不重叠的源码和 `.tsbuildinfo`，但共享 `lib/types` 输出目录——只有一处刻意的例外：`src/remote-events.ts` 与 `src/types.ts` **同时**列进两个 face 的 `files`，因为转发事件名单是「消费端能收到什么」的唯一控制点，Host 转发循环与 Client 的 `ctx.remote.$on` 键面必须读同一份声明，而不是两份可能彼此漂移的声明。

这条例外不止是一行 `files`。根 `tsconfig.base.json` 把 `@deepseek-ai/dsh-api-remotes/types` 映射到 `src/types.ts`——**源平面**，与其余所有 workspace 子路径一致，也与生成的 `/remote` 产物相反（后者没有 `paths` 条目，靠 `exports` 命中构建产物）。于是两个 face 都把同一份名单与类型投影收进各自的 program，并向 `lib/types` 发射逐字相同的 `remote-events` 与 `types` 输出；`.tsbuildinfo` 仍各自独立。没有任何门禁强制两个 face 的源文件互不重叠——`scripts/project-reference-faces.ts` 只校验「引用一个 split project 必须指到对应 face」——因此本段记录这次双列为何是有意的。

包内 `clientBundle(..., { hostPhase: true })` 让 Host tsdown 打包 Host 入口，让后续 Client tsdown 只打包 browser 入口。普通 Client 插件仍使用单一 Client project，并在 Client tsdown 阶段一起生成 Node loader 入口和 browser bundle；只有两组源码需要不同 compiler face 时才拆分。

<a id="model-experience"></a>
## 模型体验

无，因为该 BFF 只选择 Remote 应用方法和转发事件，不注册任何模型接口。

#### KV Cache 影响

无直接影响；其触发的任何模型可见行为均由已挂载的 Host 能力负责。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- 已安装的 Remote stub 由构建时导入选择。声明的能力限制已选操作集，不会动态安装 namespace。
- 若要增加能力，必须显式导入相应的 `/remote` 值并在此组合中挂载。
- 只有仍在等待的作用域 waterfall 会在重连后回放；单向通知仍是相互隔离的 best-effort 投递，不会回放。需要可靠恢复的状态必须由拥有方提供查询、游标或初始基线。


<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。被观察的关系由 Typert、agent 注册表和会话注册表负责。

准入还使用 LLM 与凭据所有者的声明。目录读取、模型发现、凭据元数据和凭据写入分别要求对应的能力，Settings 写入支持不能替代凭据写入支持。

Workspace 准入使用 [Workspace Controller 声明](../workspace-controller/README.zh.md#use-this-package)中的跟随、注册表管理和 Session 组织操作集。每类操作要求自身的操作集，Session 管理不能替代其中任何一项。

Directory Picker 准入分别使用同一所有者的原生选择、浏览与创建声明。Workspace 能力或其他目录操作集均不能授权不受支持的选择器请求。

Workspace Files 准入使用所有者独立声明的元数据、列目录、文本、字节窗口、完整文件、关联文件和变更观察能力；支持一项不能允许另一项请求。
