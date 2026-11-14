# Agent Note：Lite 会话公开自身事实，app 壳挂载 Lite 入口

Status: implemented

[English](2026-10-16-lite-session-facts-ui-entry.md) | 中文

## Problem

§31 四件套清单（runtimeMode、capabilities、tool catalog、permission policy）在装配面一代之后只剩一件：`runtimeMode = lite` 没有承载。native gateway 协商钉住的是宿主的 `runtimeMode = "full"`——那是宿主自述不是 Lite 的；journal 事件则会为一个静态构造事实向闭集三折叠词汇收税。与此同时 `LiteChatScreen` 仍是零调用点的死 UI，而配对壳的七 tab 只在配对后存在——独立 Lite 运行时恰恰在未配对时最有价值。

## Decision

公开物是一个构造时事实对象 `LiteSessionFacts`：模式字面 `"lite"`，加上每个 catalog 的来源——复用 catalog 已携带的选择枚举（派发 `BUNDLED_FALLBACK`、schema 与 preset `BUNDLED`），以及 bundled 本地工具名单（fallback capability 为空的全部 bundled 名）。它只陈述当下为真的事实——不镜像宿主 capability 集、不造枚举。`LiteChatViewModel` 以只读构造参数携带它（默认值等于 bundled 装配），`LiteSessionAssembler` 从实际加载的 catalog 填充。UI 入口挂在壳的未配对分支：「Lite 模式」按钮打开整面 `LiteEntry`——顶部一行披露运行模式的说明，然后是聊天面。调用方未注入 endpoint 时，显式空态保持发送禁用并给出一行说明；绝不假设任何 endpoint。刻意不做：endpoint 配置面、preset 选择面、捆绑工具声明、journal 续读、配对面 tab。

## Alternatives considered

journal `session/mode` 事件被拒：折叠词汇是闭集且三方（TS、Kotlin、Swift fixtures）互验，模式是静态装配事实而非回合历史，chapter 64 要求 journal 只落 fold 可见的回合结果。纯 UI 标签被拒：§6 的「必须公开」是运行时事实，没有事实源的标签只是文案。扩展 `NativeSupportDiagnostics` 被拒：那个面重发布的是观察到的宿主 describe 结果，把 Lite 自述混进去会模糊「宿主事实」与「设备事实」两个平面。第 8 tab 被拒：tab 栏只在配对后存在，与独立运行时的主场景正好相反。

## Consequences

§31 清单收官：catalog、persona、权限策略，以及现在公开的模式——各自拥有可观测的来源而非叙述。未配对壳获得一个可用的 Lite 面，其发送路径安全禁用直到后续代提供真实 provider 设置。实现还揭开并最小修复了一个既有缺陷：`LiteHTTPProvider` 此前急切构造 Android 运行时不携带的 `java.net.http.HttpClient`，任何真机装配都会以 `NoClassDefFoundError` 失败；改为惰性获取后构造平台安全、JVM 语义不变。流式路径仍用 JDK client，因此已配置 endpoint 的真机路径在后续代换用 Android 可用 HTTP 栈之前仍不可用。

## Open follow-ups

endpoint 配置面（随之而来的真机真实发送路径——需要 Android 可用的 HTTP client）、preset 选择面、为 Host 声明名域捆绑工具声明、装配会话的 journal 续读、事实向支持导出的诊断投影，均仍开放。
