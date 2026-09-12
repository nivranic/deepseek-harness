# Gate 1 约定所有权正确性修复实施计划

[English](2026-09-02-gate-1-correctness-repair.md) | 中文

> **面向 Claude：** 必须使用 `executing-plans`，逐项实施本计划。

**目标：** 让已交付的 Remote 垂直切片在 Host、Swift 与 Kotlin 客户端之间真实互操作，并具备资源级授权、隐私安全遥测、确定性恢复和一个已验证的候选发布提交。

**架构：** 保留 Typert Gateway、Session、Projection、Interaction、Device Trust 和现有 carrier 的所有者。扩展规范的 `dsh-link-contracts` 真源，使生成式 Swift/Kotlin 产物拥有 transport 与 Remote 事件字段，再按生成字段修复各消费方。真实 Host composition 与跨语言执行是阻断证据；fake server 和源码检查仅作为辅助证据。

**技术栈：** TypeScript、Cordis、Typert、Vitest、Swift/SwiftPM、Kotlin/JUnit、Gradle、YAML、GitHub Actions 和仓库文档门禁。

---

## 范围与执行规则

本计划只实施 Gate 1 的 P0 工作。只有下面全部强制退出断言通过，或需求允许的宿主环境阻断得到明确记录后，才开始规划 Gate 2。

- 每项任务都从 `codex/goal-mode-full-implementation` 上最后一个已提交检查点开始。
- 在改变行为前先编写失败测试，或保留可复现的失败命令。
- 在同一逻辑提交中更新所属 README、JSDoc、活跃 Agent Note、生成产物和双语对侧文件。
- 发现和编辑时排除 `vendor/` 与 `.agents/notes/archived/`。
- 在 `artifacts/verification/gate-1/` 下保存任务证据，包含源码提交、准确命令、结果、改动文件、限制和后续依赖。
- 不发布，不使用生产凭证签名，不提交商店，不扩展 Relay，不增加第二个 Gateway，也不增加其他 Session authority。

## 强制退出断言

- 已交付的 base composition 可解析，`apps/cli/tests/link-session-slice.e2e.ts` 能启动真实 Host。
- Gateway stream 与 Remote 事件测试在不绕过 loader composition 的情况下通过。
- `pnpm run test:docs` 和 `pnpm run doc-sync` 中全部仓库所有的子门禁通过。
- 规范约定拥有 unary、stream、ready、emit、waterfall、cancel、outcome、void 成功、error、sequence、cursor、version、capability 和未知可选字段语义。
- 生成的 manifest、schema、fixture、Swift 与 Kotlin 输出保持新鲜，并解码同一语料。
- 真实 Host-to-Swift 和 Host-to-Kotlin 验收覆盖 pair、connect、describe、list、open、history、follow、prompt、stream、approval、cancel、reconnect 与 revoke。
- Android 拒绝错误的 SPKI pin，并在 follow stream 中断后重新连接。
- 授权拒绝超出范围的 session、workspace、interaction、resource 与 path 访问。
- 多设备审批实现 first-valid-wins 且没有重复副作用，恢复过程不存在静默的永久缺口。
- 遥测默认不导出提示词、源码、工具参数或结果、系统提示词、凭证或 workspace 路径。

### 任务 1：记录并提交执行基线

**文件：**

- 新建：`artifacts/verification/gate-1/implementation-baseline.json`
- 新建：`docs/plans/2026-09-02-gate-1-correctness-repair.md`
- 新建：`docs/plans/2026-09-02-gate-1-correctness-repair.zh.md`
- 新建：`docs/plans/2026-09-02-gate-1-correctness-repair.i18n.yaml`

**步骤：**

1. 确认当前分支、HEAD、upstream、worktree、远端名称、`dev`/`master` 头、merge-base、分叉情况和核验快照后的提交。
2. 确认原 worktree 仍只包含用户所有的未跟踪核验报告，且实施 worktree clean。
3. 编写基线 JSON，包含脱敏远端、已观测 SHA、原 dirty state 保留情况、命令清单和 Gate 1 依赖。
4. 记录并验证双语计划文件。
5. 运行 `git diff --check` 并检查完整 diff。
6. 使用 `chore(goal): record Gate 1 execution baseline` 提交。

### 任务 2：修复已交付 composition 与测试 composition

**文件：**

- 修改：`packages/bundle/base/cordis.patch.yml`
- 按证据修改：`packages/api/gateway/tests/gateway-stream.host.spec.ts`
- 按证据修改：`packages/api/gateway/tests/gateway-stream.host.spec.ts` 使用的 loader fixture 或服务注入所有者
- 测试：`apps/cli/tests/link-session-slice.e2e.ts`
- 更新：拥有受影响 composition 决策的活跃 Agent Note

**步骤：**

1. 运行 `pnpm exec vitest run packages/api/gateway/tests/gateway-stream.host.spec.ts apps/cli/tests/link-session-slice.e2e.ts` 并保存修复前日志。
2. 如果现有 e2e 未清晰隔离问题，则增加狭窄的 YAML 解析断言，使已交付的无效配置项触发失败。
3. 在所属配置项修复已交付 YAML，不禁用 Link access，也不绕过 loader。
4. 让 Gateway 测试 composition 注入 `client-connection` 所需服务；不得只为满足手工构造 context 而改变产品行为。
5. 重新运行聚焦命令并保存修复后日志。
6. 运行受影响包测试与 `git diff --check`，使用 `fix(remote): restore shipped Link composition` 提交。

### 任务 3：消除仓库所有的文档漂移

**文件：**

- 修改：`doc-sync` 报告的所有者 JSDoc 与类型声明
- 重新生成：`docs/config-catalog.md` 和门禁报告陈旧的其他生成式英文输出
- 更新：受影响的 `docs/subsystems/*.md`、`docs/subsystems/*.zh.md` 与 `*.i18n.yaml` 文件组
- 按证据修改：门禁报告的 TypeScript path/config 所有者

**步骤：**

1. 运行 `pnpm run test:docs` 与 `pnpm run doc-sync`，保存每个子门禁结果，并将仓库漂移与宿主 symlink 权限失败分开分类。
2. 针对 public signature type、Cordis inspect/config catalog、导出函数 `@returns`、Artifact subsystem 所有权和 TypeScript path，先修 owner source，再修生成输出。
3. 重新生成衍生产物，并最小化更新双语对侧文件。
4. 每轮修复后重新运行受影响子门禁，最后运行两个聚合命令。
5. 保存 `artifacts/verification/gate-1/G1-DOC.json`，运行 `git diff --check`，使用 `docs: restore repository documentation freshness` 提交。

### 任务 4：让 Link 真源图拥有完整协议格式

**文件：**

- 修改：`packages/remote/link-contracts/src/index.ts`
- 修改：`packages/remote/link-contracts/src/generate.ts`
- 修改：`packages/remote/link-contracts/tests/link-contracts.spec.ts`
- 修改：`packages/api/gateway/src/stream-protocol.ts`
- 修改：`packages/api/gateway/src/client/remote-events.ts`
- 修改：`packages/remote/link-access/src/protocol.ts`
- 更新：`packages/remote/link-contracts/README.md`、中文对侧文件和配对记录
- 新增或取代：规范 Link transport 与 Remote 事件所有权的活跃 architecture Agent Note

**步骤：**

1. 为 unary `{ payload: { args } }`、stream、ready/client identity、emit、waterfall request、cancel、outcome、void 成功、结构化 error、sequence/cursor、独立版本、capability 与忽略未知可选字段添加约定测试。
2. 运行约定测试，并确认缺少的协议字段在实施前触发失败。
3. 扩展现有真源图；不增加手写 JSON Schema 或第二份协议表。
4. 让 Host 协议代码在有类型的同进程边界消费生成定义，或证明与其等价。
5. 运行聚焦 TypeScript 测试与 `pnpm run verify-link-contracts`；在任务 5 重新生成输出前，将 drift 失败保留为预期证据。
6. 运行 `git diff --check`，使用 `feat(link-contracts): own transport and event protocol` 提交。

### 任务 5：重新生成并证明 Swift/Kotlin 等价

**文件：**

- 修改：`scripts/gen-link-contracts.ts`
- 修改：`scripts/verify-link-contracts.ts`
- 重新生成：`packages/remote/link-contracts/generated/**`
- 重新生成：`apps/apple/Sources/SharedAppleRemoteCore/LinkContracts.swift`
- 重新生成：`apps/apple/Tests/SharedAppleRemoteCoreTests/Fixtures/**`
- 重新生成：`apps/android/core/src/main/kotlin/ai/deepseek/dsh/link/LinkContracts.kt`
- 重新生成：`apps/android/core/src/test/resources/fixtures/**`

**步骤：**

1. 从规范真源图运行 `pnpm run gen-link-contracts`。
2. 增加 decoder/conformance 断言，让 Swift 与 Kotlin model 测试回放完全相同的 payload 字节。
3. 运行 `pnpm run verify-link-contracts`，随后再次生成并运行 `git diff --exit-code`。
4. 运行 TypeScript fixture 测试；在具备条件的宿主上运行 `swift test` 与 `gradle --no-daemon test`，否则保留平台 workflow 命令，并只把无法执行的平台操作标记为 `NOT_EXECUTED`。
5. 保存 `artifacts/verification/gate-1/G1-GEN.json`，运行 `git diff --check`，使用 `chore(link-contracts): regenerate native protocol artifacts` 提交。

### 任务 6：修复 Apple Remote 所有权与事件处理

**文件：**

- 修改：`apps/apple/Sources/SharedAppleRemoteCore/LinkClient.swift`
- 修改：`apps/apple/Sources/CompanionUI/RemoteSessionViewModel.swift`
- 修改：`apps/apple/Sources/CompanionUI/InteractionViewModel.swift`
- 测试：`apps/apple/Tests/**`
- 更新：`apps/apple/README.md`、中文对侧文件、配对记录和活跃 Apple Remote Agent Note

**步骤：**

1. 为 fresh-pair wire replacement、Host `ready.clientId`、嵌套 waterfall request、outcome frame、void RPC 成功和 reconnect 后权威刷新增加失败测试。
2. 在 macOS 上运行 `swift test` 或仓库 Apple workflow；Windows 上保留宿主阻断，不得声称通过。
3. 使用生成式 envelope 与单一 credential 所有的 active wire 实施最小客户端改动。
4. 运行 Swift 单元/fake-server 测试和任务 9 的真实 Host 验收语料。
5. 保存 `artifacts/verification/gate-1/G1-APPLE.json`，运行相关文档检查，使用 `fix(apple): align Remote client with Host protocol` 提交。

### 任务 7：修复 Android TLS、所有权、envelope 与 reconnect

**文件：**

- 修改：`apps/android/core/src/main/kotlin/ai/deepseek/dsh/link/LinkClient.kt`
- 修改：`apps/android/core/src/main/kotlin/ai/deepseek/dsh/link/LinkPinning.kt`
- 修改：`apps/android/core/src/main/kotlin/ai/deepseek/dsh/companion/CompanionModels.kt`
- 测试：`apps/android/core/src/test/kotlin/ai/deepseek/dsh/link/LinkClientTest.kt`
- 测试：`apps/android/core/src/test/kotlin/ai/deepseek/dsh/link/LinkPinningTest.kt`
- 更新：`apps/android/README.md`、中文对侧文件、配对记录和活跃 Android Remote Agent Note

**步骤：**

1. 为 Host envelope、权威 client identity、outcome frame、fresh-pair wire replacement、正确 pin 成功、错误 pin 在发送请求字节前被拒绝、follow 中断重连和 snapshot/history 重同步添加失败测试。
2. 在 `apps/android` 中运行 `gradle --no-daemon test` 并保存失败用例。
3. 在每个请求与 stream 实际使用的 TLS 客户端中强制执行 SPKI pinning；移除任何已保存但未强制执行的安全状态。
4. 增加有界 reconnect 与权威重同步，并确保 dispose 达到完全停稳。
5. 运行单元测试、`gradle --no-daemon :app:assembleDebug` 和任务 9 的真实 Host 验收语料。
6. 保存 `artifacts/verification/gate-1/G1-ANDROID.json`，运行相关文档检查，使用 `fix(android): enforce Link security and recovery` 提交。

### 任务 8：强制执行最小资源 scope 与隐私安全遥测

**文件：**

- 修改：`packages/remote/link-access/src/index.ts`
- 修改：`packages/remote/link-access/src/protocol.ts`
- 测试：`packages/remote/link-access/tests/**`
- 修改：`packages/session/session-telemetry/src/**`
- 修改：`packages/session/session-telemetry-otel/src/**`
- 测试：`packages/session/session-telemetry/tests/**`
- 测试：`packages/session/session-telemetry-otel/tests/**`
- 更新：受影响的包 README 文件组、subsystem 文件组、privacy inventory 和活跃 Agent Note

**步骤：**

1. 为未授权 session、workspace、interaction、resource 与 path 增加拒绝测试；同时覆盖已撤销设备、observer mutation、禁用 Remote Approval 和非 pending interaction。
2. 为禁用导出、事先 consent/feedback authorization、许可的安全字段，以及拒绝或脱敏提示词、源码、工具 payload、系统提示词、凭证和 workspace 路径增加遥测测试。
3. 运行聚焦测试，并确认每个新增无效用例触发失败。
4. 从现有 Device Trust role 与请求所有的 scope 解析授权；不增加复杂 RBAC。
5. 让遥测默认只导出元数据，并在字段未列入 allowlist 时快速失败。
6. 重新运行聚焦测试、包 invariant 和文档检查，并为授权与遥测分别提交逻辑检查点。

### 任务 9：增加真实 Host-to-native 验收

**文件：**

- 修改或新建：`apps/cli/tests/link-native-acceptance.e2e.ts`
- 修改或新建：`apps/apple/Tests/` 下的 Swift executable/test 适配器
- 修改或新建：`apps/android/core/src/test/` 下的 Kotlin executable/test 适配器
- 修改：`.github/workflows/apple-swift.yml`
- 修改：`.github/workflows/android-kotlin.yml`
- 新建：`artifacts/verification/gate-1/acceptance/` 下的跨语言语料与日志
- 更新：所属 testing Agent Note

**步骤：**

1. 为 pair、connect、describe、list、open、history、follow、prompt、stream、approval、cancel、reconnect 和 revoke 定义一套场景语料。
2. 让两个适配器报告 Host commit、client commit、protocol version、contract version 和逐步 verdict。
3. 针对真实的已交付 Host 进程运行语料；fake server 可以隔离失败，但不能满足验收。
4. 增加平台 workflow，将日志与 fixture 保存为 CI artifact，并在可运行步骤被跳过时失败。
5. 分别保存 Swift 与 Kotlin evidence JSON，运行 workflow 约定测试，使用 `test(remote): add cross-language Host acceptance` 提交。

### 任务 10：证明多设备审批与恢复

**文件：**

- 修改：`packages/api/gateway/tests/gateway-stream.host.spec.ts`
- 修改或新建：`apps/cli/tests/` 下的确定性多设备与故障注入场景
- 按证据修改：Native reconnect/projection 测试
- 新建：`artifacts/verification/gate-1/multi-device/` 与 `artifacts/verification/gate-1/recovery/` 下的证据

**步骤：**

1. 为 Desktop、Controller A、Controller B 与 Observer 增加受控调度，使两个 controller 的获胜顺序都具有确定性。
2. 断言第一个有效 outcome 获胜，迟到 outcome 收敛为 no-op/cancel，没有副作用执行两次，且 Observer 被拒绝。
3. 在 stream 期间注入网络中断，同时让 Host 继续；重新连接每个 Native 客户端，并将最终 projection 与权威 history/snapshot 比较。
4. 断言不存在永久 sequence gap、重复回放安全、重复 reconnect 幂等，并且最终 projection 正确。
5. 在无随机调度的情况下重复运行场景，保存证据，使用 `test(remote): prove approval convergence and recovery` 提交。

### 任务 11：在一个候选提交上关闭 Gate 1

**文件：**

- 新建：`artifacts/verification/gate-1/gate1-evidence.json`
- 新建或更新：如果最终位置属于双语文档范围，则更新 `CURRENT_GROUND_TRUTH.md` 及其双语对侧文件
- 更新：Gate 1 计划状态，但不重写证据历史

**步骤：**

1. 选择当前已提交 HEAD 作为唯一候选，并在运行聚合检查前记录其 SHA。
2. 运行改动表面要求的约定、conformance、授权、pinning、reconnect、兼容、回归、文档、official build、Apple 与 Android 命令。
3. 将每项失败分类为产品、测试、约定 drift、工具链、宿主环境、缺少凭证或外部服务；不得把仓库失败转换为 `NOT_EXECUTED`。
4. 验证每项强制退出断言，确保生成输出保持新鲜，并确认 `git status --short` 为空。
5. 使用准确的候选 SHA 编写 `gate1-evidence.json`，只有此后才能把 Gate 1 标记为 `PASS`；否则保持 Gate 开放，并继续每项独立修复。
6. 使用 `chore(goal): close Gate 1 correctness repair` 提交证据；只有提交为绿色后才开始编写精确的 Gate 2 计划。
