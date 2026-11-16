# Agent Note: 配对 shell 拉取宿主活工具目录

Status: implemented

[English](2026-10-19-paired-host-tool-catalog-pull.md) | 中文

## 问题

gen-62 装配 Lite 派发目录时只用 APK 冻结文档：设备工具声明并上捆绑的宿主投影。与此同时 `NativeGatewayClient.toolDescriptors()`——一个完整的、带 per-negotiation 缓存与 schema 校验的拉取实现——零调用者挂在那里：一个真在服务工具目录的配对宿主对 Lite 面完全不可见，后者继续用构建时冻结的投影应答。配对 shell 也根本没有 Lite 入口；未配对分支带着唯一的按钮，且标签硬编码（一触即发的 `verify-client-ui-i18n` 违规）。

## 决策

经 wire seam 打开拉取通道。`WireDriving` 增加接口 default `suspend fun toolDescriptors(): List<ToolDescriptor>? = null`——无状态与未配对 wire 没有宿主可问、答 null 即捆绑回退路径；`SwitchableWireDriving` 委托，`NativeGatewayClient` 只给既有实现补 `override`、缓存不动。`HostToolCatalogObserver` 照 `HostDescriptionObserver` 模板（同样的 `LaunchedEffect(paired, wire, lifecycleOwner, generation, refreshEpoch)` 套 `repeatOnLifecycle(STARTED)`，与描述刷新共享纪元）；其后的 `LiteHostCatalogWatch` 是 retain-last-success 并按一个 wire/宿主 generation 键控：null 答案保留上次成功声明，传输失败静默保留，`BadWire` 保留并升起可观测的 `badWire` 标志（渲染为 locale 所属的 `lite-catalog-badwire` 诊断行），`CancellationException` 自然传播。watch 键刻意不含 `refreshEpoch`，失败的重试不能把会话抖回捆绑 union。目录侧，`LiteToolCatalog.fromDeviceAndLiveHostDeclarations` 在既有 `HOST_DECLARED` 源值下并合设备声明与活服务声明——不加第四枚举值——宿主一旦服务目录即整体替换捆绑投影；跨文档碰撞守卫抽入共享 `unionCatalog`，`fromBundledDocuments` 保持薄委托、报错文案不变。`LiteSessionAssembler.assemble` 以显式 resolve 步骤收 `liveHostToolDescriptors`（null 保持冻结 union），`LiteChatFace` 把活声明加进 `remember` 装配身份与 preset 并列——真正的新目录装配新会话。配对 shell 的 Scaffold 获得 Lite 入口：按钮提取为 `LiteEntryButton`，两分支经同一 `lite_entry` locale 键与 `lite-entry` test tag 渲染。

## 备选方案

为活 union 加第四个 `LiteToolSource` 值被拒：`HOST_DECLARED` 已经精确命名「由宿主声明」，它能补充的区别（宿主侧来自哪份文档）已由哪个构造器装配了目录观察到。按会话或按回合重拉被拒——每次配对前台进入一拉、外加显式刷新纪元，与描述观察者的成本和新鲜度契约一致。新拉热替换活会话目录被拒，理由同 preset 切换重装配：目录是会话身份的一部分（其 facts 命名源），目录变了就是新会话，retain-last-success 让该身份在重试间稳定。schema 违规静默回退 BUNDLED 被拒——失败保持可观测、保留目录继续生效，符合 fail-loud 立场。

## 后果

服务工具声明的配对宿主现在拥有 Lite 派发 union 的整个宿主侧，§31 权限门在其上走同样的声明门；活 union 装配的会话 facts 披露 `HOST_DECLARED`。真实目录变化仍意味着新会话（装配身份含声明），这是诚实的：facts 与提示面随目录走。真宿主端到端 `tools/list` 验证仍开放——拉取在 JVM 测试中对 scripted wire 验证、instrumented 入口断言随 `assembleDebugAndroidTest` 编译，真宿主往返属 e2e 域。core JVM 测试：564 -> 572。

## 开放跟进

目录拉取的真宿主 e2e（`NativeGatewayDriver` 手测通道）；超出共享描述刷新纪元的目录热刷新 UI；新增 androidTest 对的 instrumented 执行；余三执行器（`url_fetch`、`image_inspect`、`attachment_read`）与回合内多步续跑仍自 gen-62/63 台账开放。
