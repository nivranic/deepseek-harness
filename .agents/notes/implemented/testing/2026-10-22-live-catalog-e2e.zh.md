# Agent Note: 目录拉取有了真宿主 e2e 车道

Status: implemented

[English](2026-10-22-live-catalog-e2e.md) | 中文

- 日期：2026-10-22
- 类别：testing
- 范围：`apps/web/tests`（`android-tool-catalog.e2e.ts`）、`apps/android/core`（`NativeGatewayDriver.kt`、`LiteHostCatalogWatchTest.kt`）

## 问题

tools 插件自落地起就在服务 §32 活目录——base bundle 挂载注册表、`packages/core/tools/src/index.ts` 注册 `tool.catalog.v1` 能力、`@Remote list()` 投影全局视图——但既有 e2e 全部止步于配对与协商，从未调用 `tools/list`。Kotlin 客户端的严格解析、按协商代次的缓存、retain-last-success watch 都只有受控 JVM TLS fixture 的证据，宿主侧广播 → Kotlin 解析 → 缓存 → 断言的闭环没有端到端证明。

## 决策

用一条 owner 本地场景闭环。`apps/web/tests/android-tool-catalog.e2e.ts` 照 `android-gateway.e2e.ts` 模板——native-remote overlay 上的真实 web scaffold、编译后的生产 Kotlin driver、`deviceTrust.issuePairing('viewer')`，然后是新的 `toolDescriptors` driver op。一个组合事实决定了场景形态：shipped Web 组合把全部模型面工具放进 preset 域，全局目录服务的是空列表；场景传入 scaffold 既有的 `cordisTools: true` 插入，让全局视图持有已发的 `cordis_*` 工具 id 可供服务。断言：拉到的描述子与 `ctx.tools.list()` 深相等；每个出现在生成投影 `packages/core/tools/tool-descriptors.json` 里的拉取 id 声明字段逐一相同；并照 `android-capability-presentation.e2e.ts` 的 `vi.spyOn` 手法拦 `typertGateway.invoke`——恰好一次 `tools/list` 请求上宿主，重复 op 由 Kotlin 客户端缓存应答。driver op 落在 `NativeGatewayDriver.kt`（test 源集，约 15 行）：重新序列化解析后的描述子，null 与列表保持可区分。`LiteHostCatalogWatchTest.kt` 补齐 gen-64 的三枚 watch 语义缺口：来自 wire 的 `CancellationException` 原样传播而不是变成一次观察、`WireDriving.toolDescriptors()` 默认返回 null（bundled 回退路径）、`SwitchableWireDriving` 在 `replace` 之后只经当前委托拉取。

## 考虑过的替代方案

- 对着普通 Web 组合的全局目录断言：诚实但为空（工具都在 preset 域里），只证管道不证真实描述子的严格解析；既有的 Cordis 插入通过同一 shipped 操作服务已发 id。
- 会话级目录读取：`tools/list` 只服务全局视图，没有任何 Remote 参数能读到 preset 域的工具。

## 后果

- 场景需要 `DSH_ANDROID_JAVA` 指向 Java 17 可执行文件，缺省自跳过；CI 不跑（无此 runner 环境），与相邻 Android e2e 车道的 owner 本地诚实形态一致。全程无 key：零模型回合、零 API key。
- `:core:test` 随三枚 watch 测从 605 增至 608（85 套件）；生产源集零改动。
- shipped Web 组合全局目录为空这一事实由此记录；未来若有组合全局挂载工具，可去掉 `cordisTools` 插入而保留其余全部断言。
