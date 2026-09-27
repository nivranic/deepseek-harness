# Agent Note: Android 查看位置链接将单次导航绑定到当前可信 Host

Status: implemented

[English](2026-09-28-android-view-deep-links.md) | 中文

## 问题

复制的查看位置载荷标识已有 Host 日志，却不是 Android URI。外部启动还可能在凭据恢复、其他来源活动或 Host 观察变化时到达。重放旧 Activity Intent，或把保留的能力事实当作新查询已完成，可能在没有新用户操作时导航，或使用错误的模型所有者。

## 决策

Android 接受 `ACTION_VIEW`，外层精确前缀为 `dsh-companion://session-view/`，后接既有 `dsh-session-view.v1.` 载荷。前缀长度为 29 个字符；完整内层载荷最多 4096 个字符，完整 URI 最多 4125 个字符。`NativeViewLocations.encodeDeepLink()` 和 `decodeDeepLink()` 复用既有兼容 Web v1 的编解码实现，不裁剪、规范化或百分号解码。不同大小写、authority、端口、用户信息、额外路径段、查询串、片段及百分号转义均被拒绝。内层字段和安全整数规则保持不变。

manifest 通过 `DEFAULT` 和 `BROWSABLE` 声明该 scheme；获准处理的 VIEW 投递仍须通过解析校验。只有 `ACTION_VIEW` 授予导航意图。selector、嵌套 Intent extra 和 ClipData 均被拒绝。既有原始载荷复制和粘贴入口保留，**复制查看位置链接** 为第一条可见持久记录复制 URI。通过 `ACTION_SEND` 投递的 URL 仍是普通分享文本。

真正新到达的有效 VIEW 投递直接打开已有 Session 并显示目标锚点，不增加第二次确认、Session 创建、prompt、上传、配对或运行时转移。查看遵循 Host 的既有观察与激活策略。Host 允许读取时，viewer 可以导航；该操作不要求 `SESSION_CONTROL`，能力观察也不替代 Host 授权。

## 准入与查询归属

入口要求当前所选可信 Host 为 `READY`、其 id 匹配位置载荷、当前 `CompanionViewModel` 匹配该 Host 代次，且成功观察到 `SESSION_FOLLOW`。入口捕获准确的 `SessionModel`、Host key 及代次，不依据 URI 选择 Host 或信任端点。替换该所有者会取消旧导航，并拒绝其迟到完成。外层所有者不包含 Session 选择代次，因为打开目标 Session 本就会改变该代次。

待处理分享、选择器、附件读取/上传/清理或消息发送会使外部导航以繁忙状态被拒绝。活动中的链接拒绝另一链接或分享，不覆盖自身载荷，也不采用其他来源的工作。繁忙操作结束后不会自动重试被拒投递。[分享决定](2026-09-28-android-share-intake.zh.md)继续拥有草稿采用与来源授权。

新冷启动 VIEW 可以等待本次启动的 Host 恢复及首次描述查询。尝试失败或取消后，只有 **重试打开** 或新投递才能开始另一次尝试。显式重试增加 `refreshEpoch`，即使 wire 保留较早的 `AVAILABLE` 描述，也要等待本次查询。observer 状态归属于 wire、配对状态、Host 代次及刷新代次；旧的不可取消完成处理不能发布到替换后的观察中。

每份观察分别记录查询进度、完成与失败。最初尚无 snapshot 时等待；查询已完成但没有 snapshot，或仅有 `NOT_REQUESTED`/`CHECKING` 时，明确失败而非无限等待。取消或普通异常会使本次观察失败，即使共享 wire snapshot 仍是 `AVAILABLE`，包括尚未取得查询锁就被取消的情形。已关闭、已退役的描述及缺失 follow 支持均不能允许导航。

## 导航与恢复

入口完成 Host 检查后调用既有 `SessionModel.openViewLocation()`。输入恢复状态不是 `RESTORE_FAILED` 时，Core 导航在等待目标 snapshot 或锚点前修改 `lastSessionId`，并安排正常的异步输入保存，不等待 `flush()`。只读导航不会改写不可读取的输入存储。锚点不存在或取消不会回滚选择。完成因此只证明已经显示锚点，不证明最后选择已持久保存；应用也不持久化锚点供自动重放。

取消链接会等待自身导航任务终结。所选 Session 可以保持打开，共享历史分页的 HTTP 工作仍由其 journal 持有。Session 或 Host 退役负责停止并等待该 journal 的工作。迟到页面不能发布已取消尝试的锚点，也不能将该尝试标为 `OPENED`。

导航本身保留各 Session 的完整草稿文本、附件顺序、请求 id 及待确认 prompt。观察到的 Host 回执仍按既有规则清理已接受意图：匹配 Session/请求会移除其 pending prompt，只有当前完整草稿仍等于已接受草稿时才清除草稿。新编辑及其他 Session 保留。已有发送的 Core 调用方继续使用捕获目标；选择代次变化会拒绝迟到附件采用。这些输入规则继续由[输入检查点决定](2026-09-26-android-encrypted-input-checkpoints.zh.md)拥有。

旋转保留内存导航所有者。等待中的尝试可以用同一尝试身份连接到重建 composition 的能力查询；旧 composition 查询被取消，但结果未送达入口所有者时，不会单独使该尝试失败。已经标为失败或取消的尝试保持停止；正在打开的尝试保留原任务，不再次导航。

保存状态只记录 pending/done，不保存可复用位置或导航授权。进程恢复及 `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` 均不重放 Activity 原始 VIEW Intent；已中断尝试显示固定提示。真正新到达的冷启动投递可以在当前恢复完成后执行，之后显式投递相同 URI 也属于新尝试。[查看位置决定](2026-09-26-android-native-view-location.zh.md)继续拥有有界历史、取消及锚点代次语义；[已保存 Host 目录](2026-09-26-android-saved-host-catalog.zh.md)继续拥有主体选择与退役。

## 考虑过的替代方案

**把每段分享字符串解释为位置。** 分享文本可以包含 URL，却没有请求导航。精确 VIEW URI 区分打开位置与把原始内容加入草稿。

**根据链接选择或配对 Host。** 位置载荷携带身份，不携带信任或授权。当前可信 Host 必须匹配；切换及重试仍是用户显式操作。

**每次导航前再加一次确认。** 打开 VIEW 链接本就请求只读导航。应用校验目标，并提供进度、取消及失败提示，同时保留直接操作。

**在重试或取消后复用保留的成功描述。** 已保存能力事实不能证明当前查询的结果。每个刷新代次独立持有进度和完成状态，避免旧 `AVAILABLE` snapshot 或迟到完成处理准许新尝试。

**持久保存位置，在恢复或就绪状态变化后重试。** 这些变化不代表新的导航请求。仅内存尝试和仅保存处理状态的恢复规则，避免旧 Intent 意外重新打开位置。

## 后果

完整 Core 运行通过 67 个套件、417 个测试，无失败、错误或跳过。[编解码测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeViewLocationTest.kt)、[导航测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeViewLocationModelTest.kt)及[输入组合测试](../../../../apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/NativeViewLocationInputTest.kt)共 19 个用例，覆盖严格 URI 解析、大小限制、错误 Host 拒绝、完整输入保留、已接受回执、进行中的发送/上传，以及取消后不回滚选择。

应用与 instrumentation APK 构建通过，两个 APK 均成功安装。[Intent/入口所有权](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeViewLinkIntakeTest.kt)、[Activity 投递](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/NativeViewLinkActivityTest.kt)及 [observer 回归](../../../../apps/android/app/src/androidTest/kotlin/ai/deepseek/dsh/companion/HostDescriptionViewLinkNativeTest.kt)的 17 个安装态用例全部通过，覆盖直接导航、所有者替换、恢复标记、新查询准入及迟到或取消的查询结果。

[真实 Host 深链接场景](../../../../apps/web/tests/android-view-deep-links.e2e.ts)的单个用例通过，已安装 APK 哈希匹配当前产物。公开 VIEW/BROWSABLE 投递允许 viewer 通过当前所选可信 Host 直接打开位置。错误 Host 和格式错误的链接不增加 Session follow 或历史请求，并保留双方草稿。场景覆盖分享/链接互斥、分页被拒后的显式重试、88 轮 Session 的较早锚点、URI 复制及相同 URI 的再次新投递；导航不提交 prompt、上传、新建 Session、转移运行时或追加配对。

进程恢复证据使用 force-stop 后以 MAIN 启动：恢复草稿，但不重复已中断的锚点请求。之后真正新的冷启动 VIEW 等待恢复，再打开请求锚点一次。安装态测试覆盖 history flag 拒绝；真实 Android Recents 重入仍未验证。错误 Host 拒绝、较早锚点、不重放的恢复及冷启动 VIEW 导航四张整屏截图均已审阅，所测模拟器上未观察到布局阻断。

独立安装态回归通过 18 个用例：12 个 Share 入口、1 个 Share Activity、2 个既有描述 observer 及 3 个能力详情用例。这些结果与 17 个深链接用例分别记录。浏览器分发、HTTPS App Links、其他平台外壳及物理设备仍需独立验收。
