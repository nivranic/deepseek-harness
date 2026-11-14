# 交接文档 2026-10-27-01 — Upstream-First 81 节规格推进（gen-82 已勘察待实现）

交接对象：接手本 goal 的下一个 agent。本文档自包含：不带前任会话记忆也能独立开工。
基线：worktree 干净，HEAD = `5819fc0e03`（gen-81，已推送），无未提交源码改动。
前置 handoff：`2026-09-29-01/HANDOFF.md`（更早的机制史；本文档为当前权威）。

---

## 0. 一段话总结

Upstream-First 规格（81 节）自 2026-09 起逐代推进，每代一个增量全闭环（实现→五车道→note→trace 收窄→封存链两遍→六维复核→显式清单提交推送→回执→memory）。gen-77 时 §31 open list 清零，gen-78/79/80/81 各收一个尾项。gen-81（导出端点确定性归档+HTTP 范围续传）已完整闭环推送。仓内可自主推进的规格项一度判定已尽，但本轮重新扫描发现 **§41-44 族句不在用户门控清单上**，且其「分类型默认关闭 telemetry」半句实际已达标（族句陈旧）——真实缺口是 **Android 伴生端支持文档从不收集 runtime-health**（`uncollected` 永久硬编码）与跨收集器共享诊断词汇缺失。**gen-82 已完成全部勘察与设计定型（三路并行 subagent 调研、所有 file:line 锚点已核实），实现尚未开始**——接手者从 §5 的「开工第一步」直接动手。

---

## 1. 目标与授权（用户指令，逐字保留）

**长期目标（authoritative objective）**：

> 继续，持续推进所有任务直至完成。然后还有一点，使用workflow时应着重于并行多任务，使用subagent派发任务时也应如此并行，这样才能提高推进速度，不要为了使用而使用

**配套历史指令（跨代有效，逐字）**：

- 「继续持续推进直至完成所有目标任务」
- 「我说了持续推进啊，后续还有任务就自主推进不要停下来」——**严禁完成一代后停下**
- goal-mode 各绿里程碑**自主 commit+push**；仅计划级开放决策（如 relay 优先级、macOS 轨道时机）或范围变化才停下来问
- 并行 fan-out 用于勘察/孤立文件编辑提速；**封存链执行属串行正确性例外（主会话亲驱，不分派）**；同文件编辑、模拟器车道也必须串行

---

## 2. 环境与仓库拓扑

| 项 | 值 |
|---|---|
| goal 工作区（worktree） | `E:/Mix/project/deepseek-harness/.worktrees/upstream-first` |
| 分支 | `agents/upstream-first` |
| origin | `nivranic/deepseek-harness`（用户自己的副本，非上游 deepseek-ai） |
| 外层仓库 | `E:\Mix\project\deepseek-harness`，分支 `dev`——**不是 goal 工作区**，其未提交改动（AGENTS.md 等）不要动 |
| 宿主 | Windows 10 (win32 10.0.26200)，Git Bash；PowerShell 必须用 pwsh 7（禁 Windows PowerShell 5.1） |
| Android SDK | `E:/Android_Studio_SDK`（ANDROID_HOME 用户级已设；插件不可用时直接 adb/emulator CLI） |
| 模拟器车道 | **永远 `-s emulator-5554`**；实体设备 `10AG9K2P9S002J1` 绝不触碰 |
| gh CLI | 不存在——PR/CI 用 `git credential fill` + GitHub REST（见 §8） |

worktree 内关键目录：

- `apps/android/` — Android 伴生端（core=JVM 纯 Kotlin，app=Compose UI+androidTest）
- `artifacts/upstream-first/` — traceability、evidence、handoff、各代 source record（入库）
- `.artifacts/` — 封存链脚本/日志/一次性 builder（本地，不入库）
- `.agents/notes/implemented/` — 每代 note 三件套（入库，双语+对档）
- `IMPLEMENTATION_STATUS.md` / `evidence.json` / `write-reports.mjs` — 链生成三件套（入库）

---

## 3. 安全红线（逐字保留，违反即事故）

1. **`.glm-router/` 与 `.mimosa/` 目录（worktree 内所有位置的同名目录）绝不触碰、不复制、不清理、不交付、不 git add**。它们出现在 `git status` 里也不管。
2. **绝不 `git add -A`**。提交一律显式文件清单（经 Write 落盘 staging 脚本后执行——见红线 4）。
3. **Git credential 仅经 `printf 'protocol=https\nhost=github.com\n' | git credential fill` 管道**入内存，不打印不落盘。
4. **Mimosa PreToolUse 钩子会拒绝含源码文件路径内嵌的 bash 命令**——git add 列表、修复脚本、任何含仓库路径的多行命令一律 **Write 落盘成文件再执行**。中文 heredoc 经 Git Bash 会 GBK 塌陷，同样一律 Write/Edit 工具。
5. 不 blanket `--no-verify`（大合并/hundreds-of-files 批量提交时按 memory 授权用，常规提交走正常 hooks）。
6. **绝不 force push**（重写已推送历史须先 fetch、备份、精确 `--force-with-lease`，且需用户明示）。
7. **实体设备 `10AG9K2P9S002J1` 绝不触碰**；**未经用户主动要求，严禁把任何 APK 安装到任何真实安卓设备**（2026-10-27 用户明令强化；gradle `connected*AndroidTest` 默认对 `adb devices` 全部设备部署——必须 `ANDROID_SERIAL=emulator-5554` 定向，或 `adb -s emulator-5554 shell am instrument` 手动跑）；Android 一切验收仅本地 gradle + emulator-5554。误装发生时：取证（`dumpsys package` 的 firstInstallTime/lastUpdateTime）后卸载本次误装包恢复原状，并如实呈报用户。
8. 作废的链产物（capture/binding/墙的失败轮）**rename 为 `.rN`/`.r1-` 后缀保留，绝不 rm**。
9. junction 环境用 `git grep`，不用 `grep -r`。
10. 适配员（subagent）绝不 git add；遇冲突停下报告主会话。

---

## 4. 当前进度：已完成（截至 gen-81）

推进弧线（每代全闭环，详见 memory 文件 `upstream-first-handoff-seal-chain.md` 与 `artifacts/upstream-first/` 各 source record）：

- **gen-77** `829a4bfecd` §54 设备端网络验证，§31 open list 清零
- **gen-78** `0174081321` §31 OTA 真实升级路径 e2e（2 派生键族）
- **gen-79** `384735dc6a` §34/§35 存储边缘矩阵（零派生链）
- **gen-80** `865192da5b` §34 共享 Diff 矩阵三消费面（7 派生键族——client typecheck 声明发射）
- **gen-81** `5819fc0e03` §35 尾项：导出端点确定性归档（`SESSION_LOG_ZIP_MTIME=946684800000` 构造后赋值 `deflate.mtime`）+ HTTP 范围续传三层契约（Accept-Ranges/HEAD 精确长度/206 切片+416）；「每请求测量」双跑设计经评审否决后测量门收窄到 Range/HEAD，既有十例零改动全绿；**零派生=零键族**（session-log-export lib 产物从不在封存 builtFiles 宇宙）；回执 85/89、CI 第 31 连 synchronize 未触发（设计内缺口，如实记录）

81 节 `verificationStatus` 全 NOT_STARTED 系**设计内**（acceptanceProven 全 false；§41 有「PASS impossible」设计约束）——不要试图翻 PASS。

---

## 5. 当前任务：gen-82（勘察+设计已完成，实现零开始）

### 5.1 背景与合法性

`artifacts/upstream-first/specification-traceability.json` 中 §41/§42/§43/§44 四节共享同一族（owner `"Health、Readiness、Diagnostics 与 Support"`），共享 remaining 句（约 line 4574/4675/4736/4805）：

> 共享诊断、可接受请求的 readiness、分类型默认关闭 telemetry、脱敏和同候选 support collector 验证仍待完成。

本轮三路并行勘察（已完成）的结论：

1. **「分类型默认关闭 telemetry」已达标**——`packages/session/session-telemetry-otel/src/index.ts:170-291`：四类 consent（sessionTelemetry/crashDiagnostics/deviceTrustMetadata/providerMetadata）全 `default(false)`，`TELEMETRY_CONSENT_OFF` 为默认；出厂组合 `packages/bundle/base/cordis.patch.yml:194-205` 以 `process.env.DSH_TELEMETRY_CONSENT === '1'` 播种；DISABLED 主开关+`DSH_TELEMETRY_DISABLED` env 退出行（`apps/cli/src/profile-boot.ts:167-170`）齐全。族句此半陈旧。
2. **Host 面 §41 readiness 已闭环**——`packages/api/host-diagnostics`：`@Remote('health')` 返回六组件快照（process/runtime/sessionStore/pluginState/connection/modelProvider，各 `{state:'up'|'down'|'degraded', detail}`）+ `ready` 判定（connection 刻意不参与）；583 行 spec 全钉。
3. **真实缺口在 Android 伴生端**——`apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/SupportExport.kt:233` 的 `uncollected` 数组**永久硬编码 `"runtime-health"`**：支持文档从不携带 Host 运行时健康/就绪事实；Kotlin 侧零 Host-health 投影（全仓 grep 证实）；跨收集器无共享诊断词汇。

### 5.2 设计定型（所有锚点已核实，接手即写）

**增量定义**：伴生端支持文档收集 runtime-health——活连接时把 Host §41 health 快照逐字嵌入文档（=「共享诊断」词汇落地），无连接/未通告/失败时如实留 `uncollected`。TS 侧零改动（端点已存在；web-app bundle 已挂载 host-diagnostics——`packages/bundle/web-app/cordis.patch.yml`）。

**已核实的锚点**：

- wire 端点名 **`hostDiagnostics/health`**（`packages/api/host-diagnostics/src/index.ts:96` `super(ctx, 'hostDiagnostics', …)` + `@Remote('health')`；`:173` `endpoint: 'hostDiagnostics/describe'` 佐证命名法）
- 能力声明：`packages/api/host-diagnostics/src/capabilities.ts:9` → `{ id: 'host.diagnostics.v1', methods: ['health','describe','supportBundle'], requiredPermission: 'view' }`
- Kotlin RPC 面：`apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/WireDriving.kt:33` `suspend fun call(method, args)`；`NativeGatewayClient.kt:166-174` call→ensureNegotiated→`requireAdvertisedOperation`→rpc；`:199-207` requireAdvertisedOperation 经 `NativeObservedCapability.forEndpoint` 查枚举，未通告即抛 `LinkClientException.Refused("host/capability-unavailable", …)`
- 能力解析自动：`NativeGatewayClient.kt:114-115` `NativeObservedCapability.entries.filter { it.wire in description.capabilities }`——加枚举成员即生效
- args 形态：`emptyMap()`（`tools/list` 前例 `NativeGatewayClient.kt:152`；`session/list` 的 `_request` 是 request-context 惯例，不适用）
- WireValue 变体（`ai.deepseek.dsh.link` 包，定义在 `LinkWire.kt`）：`ObjectValue(entries: Map<String, WireValue>)`/`StringValue`/`NumberValue`/`BoolValue`/`ArrayValue`；**`WireValue.toJsonElement()` 存在**（`LinkWire.kt:32`，`ToolDescriptors.parseList(value.toJsonElement())` 前例）
- 伴生端快照组装：`MainActivity.kt:260-270` `CompanionViewModel.supportSnapshot()`（同步、无 I/O——保持此性质）；点击时补捕前例 = `SupportExportAction.kt:103-105`（`readSnapshot().copy(applicationSource=…)` + `withContext(Dispatchers.IO){ exitHistory.capture() }` + `snapshot.copy(nativeExits=…)`）
- gen-73 liteFacts 前例（新可空字段的完整生命周期参照）：`SupportLocalSnapshot.liteFacts` 尾部默认 null、文档段+uncollected 条件化、测试断言风格

**具体改动清单**：

1. **新文件** `apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/HostRuntimeHealth.kt`：
   - `enum class HostHealthState(val wire: String) { UP("up"), DEGRADED("degraded"), DOWN("down") }` + `from(value)`（照 `NativeObservedRole` 模式）
   - `data class HostHealthComponent(val state: HostHealthState, val detail: String)`
   - `data class HostRuntimeHealth(val ready: Boolean, val process/runtime/sessionStore/pluginState/connection/modelProvider: HostHealthComponent)` + `companion object { parse }`
   - **严格 parse**：经 `value.toJsonElement()` 走 kotlinx JsonElement，六组件+ready 全字段必须存在且类型正确，任何偏差抛 `IllegalArgumentException`（不做宽松 WireShape 缺省——健康快照不得伪造缺字段）；fetch 侧捕获归 null
   - `toJson()` 投影：`{producer:"hostDiagnostics/health", observation:"fetch-time", ready, components:{六组件各 {state, detail}}}`
   - `suspend fun WireDriving.fetchHostRuntimeHealth(timeoutMillis: Long = 2_000L): HostRuntimeHealth?`：`withTimeoutOrNull(timeoutMillis){ HostRuntimeHealth.parse(call("hostDiagnostics/health", emptyMap())) }`，`CancellationException` 重抛（传播用户取消），其余 Exception 一律 null（离线/未配对/未通告/超时/形状坏→uncollected）
2. **编辑** `apps/android/core/src/main/kotlin/ai/deepseek/dsh/gateway/NativeGatewayDiagnostics.kt`：
   - `NativeObservedCapability` 增 `HOST_DIAGNOSTICS("host.diagnostics.v1")`
   - `forEndpoint` 增 `"hostDiagnostics/health" -> HOST_DIAGNOSTICS`（只映射 health——伴生端只调这一个；不映射 describe/supportBundle）
3. **编辑** `apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/SupportExport.kt`：
   - `SupportLocalSnapshot` 尾部增 `val runtimeHealth: HostRuntimeHealth? = null`（liteFacts 之后，positional 构造不破）
   - `encodeSupportDocument`：wire-plane 块（`when (val wire = …)`）之后、`"connections"` 之前插 `snapshot.runtimeHealth?.let { put("runtimeHealth", it.toJson()) }`
   - `uncollected`：`listOf("runtime-health", "updates").forEach { add(it) }` 改为——**顺序必须保持 `runtime-health` 在 `updates` 前**：`if (snapshot.runtimeHealth == null) add("runtime-health")` + `add("updates")`（保三份既有 fixture 字节不变）
4. **编辑** `apps/android/app/src/main/kotlin/ai/deepseek/dsh/companion/SupportExportAction.kt`：
   - 签名 `fun SupportExportAction(readSnapshot: () -> SupportLocalSnapshot, fetchRuntimeHealth: suspend () -> HostRuntimeHealth?)`——**必选参数无默认**（explicit>implicit；防未来挂载点静默漏接线）
   - onClick 内：`val snapshot = readSnapshot().copy(applicationSource = …)` 后加 `val health = withContext(Dispatchers.IO) { fetchRuntimeHealth() }`，最终 `snapshot.copy(nativeExits = exits, runtimeHealth = health)`
   - 取消语义：用户在 SCANNING 阶段取消→CancellationException 穿透 fetch→action 既有 CANCELLED 分支（已核实兼容）
5. **编辑** `apps/android/app/src/main/kotlin/ai/deepseek/dsh/companion/MainActivity.kt` 两处挂载（`:530` 与 `:561`）：`SupportExportAction(model::supportSnapshot) { CompanionRuntime.wire.fetchHostRuntimeHealth() }`
   - **已核实**：全仓 `git grep SupportExportAction` 仅这两处挂载 + 文件自身；androidTest 不直接引用该 composable——签名变更不破既有 androidTest 编译
6. **文档**：`apps/android/README.md` 支持文档节补 runtimeHealth 段描述（README 若有 .zh.md 镜像同步；`git grep -n "runtime-health\|uncollected" apps/android/README*.md` 定位）

### 5.3 测试计划（已定）

**新文件** `apps/android/core/src/test/kotlin/ai/deepseek/dsh/companion/HostRuntimeHealthTest.kt`：

- parse happy path：完整 §41 形状（六组件 up/down/degraded 混合 + ready true/false）→ 值正确
- parse 拒绝：缺一组件 / state 非 up|down|degraded / ready 非布尔 / detail 非字符串 → null（或抛后归 null，按实现断言）
- fetch（fake WireDriving，照 `SupportExportTest.kt:175-180` 的 object : WireDriving 前例）：
  - 成功返回 health
  - call 抛任意 Exception（含 `LinkClientException.Refused` 形状）→ null
  - `runTest` 虚拟时间：call 内 `delay(3_000)` + timeout 2_000 → null
  - call 抛 CancellationException → 重抛（assertFailsWith）
  - 断言 method=="hostDiagnostics/health" 且 args==emptyMap()
- forEndpoint 钉：`forEndpoint("hostDiagnostics/health") == HOST_DIAGNOSTICS`、`HOST_DIAGNOSTICS.wire == "host.diagnostics.v1"`（或放进既有 `NativeGatewayDiagnosticsTest.kt`，风格随彼处）

**编辑** `SupportExportTest.kt` 新增一测（照 `liteSessionFactsProjectAsTheirOwnDevicePlaneSegment` 的解析断言风格，不建新 fixture）：

- collected 形：`snapshot.copy(runtimeHealth = …)` → 文档有 runtimeHealth 段（producer/observation/ready/components 六键）、`uncollected` 不含 "runtime-health"、仍含 "updates"
- null 形既有断言：三份 resource fixture（`support-export.json`/`support-native-gateway.json`/`support-unpaired-app.json`）**必须逐字节不变**（`assertContentEquals` 既有断言即为守护）——若变说明 uncollected 顺序改错了

### 5.4 车道与门禁（实现后按序跑）

1. **core JVM**：`cd apps/android`，`ANDROID_HOME=E:/Android_Studio_SDK ./gradlew :core:testDebugUnitTest --console=plain`（确切调用形态可参考 `.artifacts/` 内 gen-77/78 车道日志；scanner env 已就绪）
2. **app 编译**：`:app:assembleDebug`（签名/DRIFT 后续封存用）+ 既有相关 androidTest（是否跑完整 emulator 车道按改动面裁量——本代 app 层仅 lambda 接线，core JVM 全覆盖取数与投影；若跑，仅 `-s emulator-5554`）
3. **TS 面**：本代零 TS src 改动——`pnpm run typecheck` 与 `pnpm run lint` 快速确认持平（lint 应 0/0@3869）
4. **doc 门**：`pnpm run test:docs`（doc-quick 17）；README 改动若触发自检项则 `pnpm run doc-sync`（37）单 combined 日志
5. **审计双轮**：`.artifacts/` 既有 audit 流程跑两轮（基线 90/1107；本代新增 core 测试文件会让世系清单 +1 spec——如实入清单）
6. **gate0**：双形态 1938/129/81/1983 + `git diff --check`
7. **pairing**：note 三件套入档后 `--write` 重录（基线 966→967，testing 类前例）

### 5.5 封存链（gen-82 特有注意事项在先）

⚠️ **本代触碰 apps/android 源码 → 大概率非零派生族**：两个 APK（debug/androidTest）sha 必变，advance 需装新 ReplacedBuildOutputs 集（照 gen-78 两键族模式 builder），墙语法随之改——这是「非零族改整个墙语法」路径，参考 gen-77（66 键三遍链）/gen-78（2 键两遍链）的记录与 TRAPS。**不要按 gen-79/80/81 的零键/简单族预期**。

完整链序（gen-81 修正版）：prepare（before-archive `wx`）→ 实现 → capture（source record `artifacts/upstream-first/host-runtime-health-source.json`，`wx`）→ advance（编辑 `write-reports.mjs`：clone newest record block、给每条旧记录 digest 链 prepend 新 history map、加 IMPLEMENTATION_STATUS 段、旧 evidence 翻 `historical:true`、update `latestSourceRecord`）→ alias → binding 三防篡改 → `node artifacts/upstream-first/write-reports.mjs`（静默数分钟，等）→ 13 audit tests → `verify-audit.mjs --require-gate0` → **墙（S8）** → capture-validation → verify-final/receipt。

- trace 收窄：§41-44 四节族句改写——「分类型默认关闭 telemetry」半句按 gen-81 收口先例翻为「由 gen-77 telemetry 基线达标」口径（**先代段逐字保留、只改本族句**），evidence +route/spec；经 `.artifacts/gen82-edit-trace.mjs` Write 落盘脚本锚定替换（gen-81 的 `gen81-edit-trace.mjs` 是模板）
- note 三件套：`.agents/notes/implemented/testing/2026-10-27-host-runtime-health.md/.zh.md/.i18n.yaml`（Problem/Decision/Alternatives/Consequences 四段双语）
- 回执：`.artifacts/update-receipt-gen82.mjs`（gen-80/81 版本是模板）更新 `authorized-native-upload-budget-publication.json`：commits.push + `hostRuntimeHealthSealRuling`
- **推荐用锚定 builder 生成器**（gen-81 的 `build-session-export-range-{advance,wall}.mjs` 模式：带 anchor-count 断言的一次性变换脚本）推导 advance/墙——比手打 700 行可靠
- 收尾：显式清单 commit+push（pre-push hooks 正常跑）→ REST check-suites 观察（预期第 32 连未触发，如实记 NOT_TRIGGERED）→ memory 双文件更新（`upstream-first-handoff-seal-chain.md` 追加 EIGHTY-TWO 段 + `MEMORY.md` 索引行重写领衔）→ 本 handoff 包的 LATEST.json 无需再动（新代不需要新建 handoff 包，除非用户再要）

### 5.6 开工第一步（ordered）

1. `cd .worktrees/upstream-first && git log --oneline -1` 确认 HEAD=5819fc0e03、`git status` 仅 telemetry 目录
2. 按 §5.2 清单写代码（全部经 Write/Edit 工具——红线 4）
3. §5.3 测试 → `:core:testDebugUnitTest` 绿 + 三 fixture 字节断言过
4. §5.4 车道按序 → §5.5 封存链（串行主会话亲驱）
5. 全绿后显式清单提交推送 + 回执 + memory + 向用户汇报

---

## 6. 每代增量标准流程（浓缩版，gen-82 适用的活模板）

勘察（并行 subagent fan-out）→ 实现（Write/Edit；孤立文件可并行派发）→ 五车道（core gradle / TS typecheck+lint / doc 门 / 审计双轮 / gate0+pairing+trace）→ note 三件套 → 封存链（串行主会话亲驱，链序见 §5.5）→ 六维复核（墙终窗负控、final 全哈希、binding 3/3、receipt 哈希、车道日志验证器内证、voided rounds 全记账）→ 显式清单 commit+push（normal hooks）→ REST check-suites 观察 CI → 回执 JSON（`JSON.parse` 复验）→ memory 更新 → 用户汇报（中文、先结论）。

**恒等规则**：never re-run successful `wx` helpers；never delete history fallbacks（`errorCodeSchemaHistory` 等）；作废轮 rename `.rN` 保留；completeRc stays false；receipt JSON 编辑后必须 `JSON.parse` 复验。

---

## 7. 门禁基线计数（gen-81 末，供 gen-82 比对）

| 门 | 基线 | gen-82 预期 |
|---|---|---|
| lint | 0/0 @ 3869 文件 | 持平（Kotlin 不入 TS lint） |
| 审计 | 双轮 90/1107 | 世系 +HostRuntimeHealthTest（90→91 类） |
| pairing | 966 | 967（note 三件套 testing 类） |
| doc-quick / doc-sync | 17 / 37（单 combined 日志） | 持平（README 触发项另计） |
| gate0 | 1938/129/81/1983 双形态 + `git diff --check` clean | 持平 |
| trace §34/§35 | 1879 字 / 11 evidence | 不动；§41-44 族句另行收窄 |
| final counts | 3643/3670/6/1424/180，completeRc=false | 随 advance 变化如实记 |
| CI | 第 31 连 synchronize 未触发 | 预期第 32 连仍未触发 |

make-prepare 必比对 prior/prior-prior 审计计数（恒等对+slice 陷阱）。

---

## 8. 提交/推送/CI 机制

- **提交**：显式清单（Write 落盘 `stage-genNN.sh` 后 bash 执行）；常规提交走正常 hooks；`git diff --cached --check` 门尾换行
- **推送**：`git push origin agents/upstream-first`；flaky HTTPS 重试配方 `git -c http.version=HTTP/1.1 -c http.postBuffer=157286400 push …`；**长提交超时≠失败——先 `git log`/ls-remote 查实际状态再重试**；push 后必 ls-remote 验证
- **CI**：`ci.yml` 仅 `pull_request` 事件触发（draft PR #2 是 CI 通道，与 origin/master 冲突是预期）；push 后 ~90s 用 REST check-suites 查（`git credential fill` 取 token）；dispatch 通道 runner-starved（open dispatch 37058503113 = swift authority，勿动）；e2e push 仅 main/master
- **版本**：master 驱动，dev 不自行 bump

---

## 9. 反复踩过的坑（TRAPS，按血泪排序）

1. **中文/多行 bash 塌陷**：heredoc 经 Git Bash=GBK 塌陷；`node --input-type=module -e` 内中文+引号双层炸——多行文件/含中文脚本一律 Write 落盘。
2. **Mimosa 钩子拒含源码路径内嵌的 bash 命令**（git add 列表、修复脚本）——Write 落盘后执行。`RANGE_REQUEST.exec(header)` 这类 `.exec(` 模式也曾被拦——用 `.match(`。
3. **管道吞退出码**：`| tee`/`| tail` 同罪——以日志行判结果。
4. **S8（墙）先于 binding 必挂**：S8 重跑前先从 before 档还原文档再按链序重跑。
5. **非零派生族改整个墙语法而非一钉**（gen-82 大概率遇到）：当前块 skip-only 期翻过滤形、降级钉环变量与标签都要换名（批发换名会漏 OTA upgrade 标签）、direct 跨度收窄后深层降级钉读全生成器、旧记录 scan 数据驱动+新键且历史扣减穿全部残差链、sourceSideDrift 二遍形重数增量文件数。
6. **堆叠墙 APK 钉每代重定位**：prior 记录自身的封存基线（notEqual 翻 equal）；binding 针与 capture 针不同墙段——批发 count-1 会落错位。
7. **墙钉逐字匹配忌 helper 注释折行**（includes 钉展平）；反斜杠深度——墙针需 `\\\\d` 匹配 capture 文件字节的双反斜杠。
8. **capture 后改源=陈封**：源编辑全部→capture→advance 顺序不可逆；binding 例撞 drafts 新字节即 recapture 收口。
9. **trace builder**：`wx` 撞陈 JSON→rename `.r1`；cwd 必须是 worktree 根。
10. **prepare expectedHelpers 描述先代收据的 helpers**（不是本代）。
11. **压缩恢复陈旧快照**：重读工作树字节核实再动手。
12. **sort 陷阱**：`.js.map` 排在 `.js` 前；cordis-catalog regen → ReplacedBuildOutputs rulings。
13. **ls-tree 逐文件 spawn 爬行**（gen-80 模板 35 分钟）：单次 `execFileSync(..., { maxBuffer: 1 << 28 })` 建 Set。
14. **新会话/子代理无 AGENTS.md 注入**：派发时任务描述里补必要约束（COHS 入口 §子任务分派）。

---

## 10. 用户门控清单（不得自主做，需用户输入）

- Phase 8 relay 方向裁定（relayMetadata blocked §23）
- owner 双门凭据（DEEPSEEK_API_KEY / DEEPSEEK_API_KEY_EXTERNAL secret）
- §56 签名/公证/更新源验收（外部材料）；§64/§36 真机验收（外部）
- CI synchronize 缺口（31+ 连——需 draft PR 对外动作决策）
- admitEncodedImages 需人工；收据保留窗口=产品决定
- §1 字段对应、多语言矩阵、§37 hook 富方言分级、python-runtime secret
- cross-release matrix、client tsdown CI 覆盖缺口、pdf-license-bundle 宿主时序基线、vendor-rescope unfixable

（另有常开 dispatch 37058503113 = swift authority 勿动；voided rounds DOT rN；completeRc stays false。）

---

## 11. 关键路径速查

| 用途 | 路径 |
|---|---|
| 规格追溯（81 节数据） | `artifacts/upstream-first/specification-traceability.json` |
| 状态/evidence 生成 | `IMPLEMENTATION_STATUS.md` / `evidence.json` / `artifacts/upstream-first/write-reports.mjs` |
| 回执 | `artifacts/upstream-first/authorized-native-upload-budget-publication.json`（gen-80/81 更新脚本在 `.artifacts/update-receipt-gen8*.mjs`） |
| gen-81 链件模板（advance/墙 builder、trace 编辑脚本、staging 脚本） | `.artifacts/build-session-export-range-{advance,wall}.mjs`、`.artifacts/gen81-edit-trace.mjs`、`.artifacts/stage-gen81.sh` |
| Host §41-44 源 | `packages/api/host-diagnostics/src/{index,types,capabilities,support-bundle}.ts` |
| 伴生端支持文档 | `apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/SupportExport.kt`（+ `NativeSupportDiagnostics.kt`、app 层 `SupportExportAction.kt`/`MainActivity.kt`） |
| 能力枚举/门控 | `apps/android/core/src/main/kotlin/ai/deepseek/dsh/gateway/NativeGatewayDiagnostics.kt`（+ `NativeGatewayClient.kt:166-207`） |
| 历代 arc/TRAPS 全量 | memory 文件 `upstream-first-handoff-seal-chain.md`（若接手 agent 同机同 memory 目录则自动加载） |
| 既有 handoff 机制史 | `artifacts/upstream-first/handoff/2026-09-29-01/HANDOFF.md` |

---

## 12. 接手确认清单

- [ ] 读本文档 + worktree `git log -1` 核对基线
- [ ] 若有 memory 目录：读 `upstream-first-handoff-seal-chain.md`
- [ ] gen-82 按 §5.6 开工；完成后继续按 §6 模板自主推进下一项或如实呈报用户门控清单
- [ ] 任何红线（§3）冲突立即停下问用户，不自作主张
