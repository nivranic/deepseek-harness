# Agent Note: Lite 面内刷新共享目录观察

Status: implemented

[English](2026-10-22-catalog-refresh-ui.md) | 中文

## 问题

gen-64 的拉取通道落下时带着 gen-69 台账承接的三处 UI 缺口。`CompanionApp` 的 `descriptionRefresh` 纪元只有两个递增方——viewLink 重试与连接能力对话框的 `native-capabilities-refresh`——而两者都长在 Lite 面提前 `return` 够不着的分支上，配对目录只能退出 Lite 才能重问。`lite_catalog_bad_wire` 诊断行的文案指的恰是这条退路（「可在连接能力中刷新后重试」）。且 `LiteSessionFacts.toolCatalogSource`——命名会话由哪个目录装配的事实——在任何地方都没有渲染；披露行只有 runtimeMode 一个词。

## 决策

把纪元递增接进来、披露来源、让 bad-wire 的补救面内可达。`LiteEntry` 增加 `onCatalogRefresh: (() -> Unit)?`；调用方传入时，披露行变为披露文本加一个 `lite-catalog-refresh` TextButton（`native-capabilities-refresh` 体例），标签走新 locale 键 `lite_catalog_refresh`。MainActivity 的 lite-open 装配传入 `{ descriptionRefresh++ }`——两个观察者共同键控的同一共享纪元——一次点击重跑既有目录观察，变更后的声明再走既有装配身份判定：`LiteChatFace` 的 `remember` 键族不动，因为刷新是对身份的重判定，不是对活会话目录的替换。`lite_catalog_bad_wire` 文案把退出指引改为面内（「可在本页刷新后重试」）。`LiteChatFace` 以三个 locale 键渲染 `chat.facts.toolCatalogSource` 为 `lite-catalog-source` 行——`LiteToolSource` 每值一键——构造期事实，故该行命名的是当前会话身份装配所据的来源，绝非运行中的重读。四条字符串都入 `native_companion.xml`（应用唯一的 locale 文件）；双语覆盖由本 note 对承担。

## 备选方案

刷新时热替换活会话目录被拒——gen-64 的裁定不变：目录是装配身份的一部分，目录变更即新会话，刷新入口只重跑观察、交由既有身份判定起作用。bad-wire 行内自带刷新动作被拒——披露行旁的一个入口覆盖每种面状态（空态、配置表单、已装配会话），且行文案已点名它。来源行放在 `LiteEntry` 披露层被拒——事实只存在于每个已装配会话上，该行渲染在装配发生的 `LiteChatFace`；无端点空态没有任何可诚实命名的事实。刷新入口按配对状态显隐被拒——入口在 shell 装配了回调时就渲染；未配对时递增只是重跑一次无 wire 可问的观察、什么也不改变，而隐藏它会让 connected 的未配对面根本无法展示该入口。

## 后果

配对用户不必退出 Lite 面即可重问宿主实时工具声明，bad-wire 诊断的补救就在行旁，每个已装配 Lite 会话都点名其 dispatch 目录来源。`LiteEntryNativeTest` 增至七测，新增 bad-wire 测试——`lite-catalog-badwire` 的首个渲染断言（照配对面入口先例直接渲染该 composable，脚本置起标志、由递增清除）——外加真实未配对面上 `lite-catalog-refresh` 的存在断言与已配置面装配上 `lite-catalog-source` 行的 BUNDLED 词断言。七测在 emulator-5554 全绿。core JVM 测试维持 85 套件 608 测（纯 app 源集改动），contract 维持 4 套件 / 37 测；debug APK 基线随生产 UI 变更漂移。

## 开放跟进

真实配对设备轮——真宿主先服务后违反 descriptor schema、面内刷新在真机上清除 `badWire`——仍属 e2e 领域，与 gen-64/69 的开放项共担。runtimeMode 披露文本仍是硬编码字面量（既有面，本代未动）。
