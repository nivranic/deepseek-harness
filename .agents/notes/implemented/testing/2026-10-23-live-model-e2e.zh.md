# Agent Note: Lite 多轮请求形状有了真 API e2e 车道

Status: implemented

[English](2026-10-23-live-model-e2e.md) | 中文

- 日期：2026-10-23
- 类别：testing
- 范围：`apps/web/tests`（`android-lite-live-round.e2e.ts`、`android-gateway-driver.ts`）、`apps/android/core`（`NativeGatewayDriver.kt`）

## 问题

Lite 多轮请求的 keyless wire 形状已在内嵌服务器上钉死（`LiteHTTPProviderTest` 逐字节断言 assistant tool_calls 行、按 id 的 `role:"tool"` 结果行、以及 loop 的续跑请求），但没有证据表明真 DeepSeek API 接受这个形状。gen-63 的 note 把活 API 轮留给了 e2e 面，§31 也一直挂着真模型多轮轮这一项。这个缺口是去险问题：gen-76A/B 的工具行 journal 持久化在重启后重放的正是这些行，若真 API 拒收该形状，那套设计就要返工。

## 决策

以一条双门控 owner 本地场景收口：`apps/web/tests/android-lite-live-round.e2e.ts`，`it.skipIf` 同时检查 `DEEPSEEK_API_KEY`（repo e2e 惯例，无 key 自跳过）与 `DSH_ANDROID_JAVA`（`android-tool-catalog.e2e.ts` 的编译 Kotlin driver 门）。场景驱动 `NativeGatewayDriver.kt` 里新增的 `liteRound` op（test 源集，`toolDescriptors` 先例）：op 从驱动器自身 classpath 上的 APK bundled 文档组装回合（`copyLitePresets`/`copyToolDescriptors`/`copyLiteToolSchemas` 测试资源）——默认 preset 的已组装 system prompt、APK 冻结的宿主+设备 schema 并集、APK 冻结的声明并集——随后经真实 `LiteHTTPProvider` 之上的 `LiteLoopDriver` 提交一条强制走 calculator 的提示词，挂载设备端 calculator 执行器，应答只携带折叠后的状态（凭证走私有 stdin 管道，绝不进入输出）。断言：bundled preset 保真（preset id、system prompt、schema 并集顺序对照 repo 投影文档）；多轮闭环证明（loop 对每个完成的请求恰好落一行 assistant 行，且只在 `tool_calls` finish 后发起下一个请求，所以完成回合上出现两行及以上 assistant 行即证明续跑请求——重放 assistant tool_calls 行及其 role:tool 结果行的那一个——被真实服务而非当作格式错拒收）；至少一个完成的 calculator 调用；取值容差（calculator 结果恰为 `391` 或终轮文本含它——不对模型文本做逐字断言）；`lastTurnEnd` completed；`errors` 为零（timeout/unreachable/dropped/HTTP 拒绝全部折叠进该列表）；无 handoff 标记。共享的 `android-gateway-driver.ts` helper 增加可选的按请求 `timeoutMs`（默认 15 s 不变），因为真模型轮超出固定等待。

## 考虑过的替代方案

- `:core:test` 内 `assumeTrue(key)` 门控的 JUnit 轮：会让 e2e 车道刻意避开的 85/609 JVM 计数增长，也背离真 API 轮住在自跳过 e2e 车道的 repo 惯例；driver 形态还顺带锻炼相邻 Android 车道共用的编译生产客户端形态。
- 在 provider 外包一层计数 wrapper 来断言请求数：loop 的 assistant 行不变量已经数清完成的请求，无需触碰 provider 缝，wrapper 只会引入生产路径上不存在的面。
- 逐字终轮文本断言：容差设计所拒——模型文本非确定；只断算术答案值与结构性轮次事实。

## 后果

- 实施机无 key（无根 `.env`、无环境变量），真模型轮记 owner-local-pending：场景在该机自跳过（已实证：设 `DSH_ANDROID_JAVA` 而缺 key 时一枚 skipped）。op 的管道在不冒充真模型的前提下验证——本地 SSE stub 经裸驱动器与 TypeScript helper 两条路径复现两请求回合、重放的 assistant/tool 行、calculator 结果与干净折叠——新文件通过 `tsc -b tsconfig.host.json`。
- `:core:test` 保持 85 套件 / 609 测试，`:contract:test` 保持 4 / 37：op 是 driver 管道而非 JUnit 测试，与 `toolDescriptors` 先例一致。scanner env gradle 验收轮（`:app:assembleDebug :app:assembleDebugAndroidTest :core:test :contract:test -PdshNativeAcceptance`）BUILD SUCCESSFUL（38 秒，82 actionable，3 executed），双 APK 面与 gen-73 封存摘要逐字节复现（debug `995eeb31…`、androidTest `2c73cbb2…`）——零生产与零 androidTest 输入变更。复现采用封存构建自身的 unstamped acceptance 形态（经 `.artifacts/native-scanner-candidate-output` 的 scanner source `8ca9f6eb…`，不带 `DSH_ANDROID_APPLICATION_SOURCE`/`DSH_ANDROID_APPLICATION_TREE`），该形态由直接解码封存 APK 的 manifest 占位符钉定。
- CI 永不运行该场景（两道门都不设置）；owner 双门齐备的一次绿灯运行，就是 gen-76A/B 重启重放设计所等待的活 API 接受性证据。
