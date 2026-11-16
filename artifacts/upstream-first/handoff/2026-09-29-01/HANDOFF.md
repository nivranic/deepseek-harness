# Upstream-First 移交续篇（2026-09-29-01）

本篇接续 [2026-09-25-01 手册](../2026-09-25-01/HANDOFF.md)。前份手册保持原字节；当前状态、授权与下一步以本篇为准。用户本次直接要求：“目前又需要移交给另一个agent了，请你续写移交文档”。本次仅整理移交，没有继续产品实现、重跑产品测试、提交或推送。

任务 ID：`01a0d683-d6ce-77f0-b946-b99408ba2e12`；时区 Asia/Hong_Kong；接手基线为 2026-09-25 手册，最近实施发生于 2026-09-28，交回日期为 2026-09-29。本次实际查询 goal 返回 **paused**，完整目标未完成，`completeRc=false`。接手 Agent 应先获得用户的继续指令，不能因阅读本手册自动恢复。

## 1. 接手摘要

| 项目 | 当前事实 |
|---|---|
| 唯一实施工作树 | `E:/Mix/project/deepseek-harness/.worktrees/upstream-first` |
| 分支 / HEAD | `agents/upstream-first` / `74b476627a950189b348a5771bb205c508f8230f` |
| 远端 | `https://github.com/nivranic/deepseek-harness`；本次 `ls-remote` 确认同 SHA |
| 相对上次移交 | 已新增并发布 41 个提交，完整清单见 [changes.json](changes.json) |
| 最新已封存增量 | `android-attachment-receipt-recovery` |
| 该来源记录 SHA-256 | `a6885018a5c9d2ca9564314993f9edff2d1af832023244979fd2842101feb14d` |
| 当前未提交增量 | `native-upload-budget`：已实现，只有部分验证通过；尚未封存 |
| 修改前归档 | `.artifacts/native-upload-budget-before/archive.json`；6,924 文件 |
| 归档 SHA-256 | `a239e9736694a7e9e531f121ee440d806a042842d7549847e1cf4b306a533c5b` |
| 不可重复执行 | 该 prepare 已完成；附件恢复的 capture/advance/recapture/dispatch 已完成 |
| Session writer | V3；不要采用旧手册或主分支中不适用的 V0 假设 |
| 活动代理 / 进程 | 本次代理列表只有 root；具名进程检查未发现当前预算测试或 catalog 生成器仍运行；不能恢复旧 agent/session ID 后假定任务续跑 |
| 主目录保护 | `E:/Mix/project/deepseek-harness` 的 `dev` 及两份 untracked 报告保持原样 |

主目录两份报告为 `GOAL_PROGRESS_SUMMARY_2026-09-14.md`、`IMPLEMENTATION_VERIFICATION_V2.md`。`.glm-router/` 遥测始终排除，不复制、不暂存、不清理。当前产品改动的精确文件、Git 状态、字节哈希及快照路径见 [changes.json](changes.json)；不要覆盖现有 dirty worktree，也不要把它当作新任务的干净基线。

## 2. 原始目标、追加授权及旧文档纠偏

完整目标仍为原 Upstream-First 81 节规格（0–80），见本包 [原文副本](original-specification.md)，SHA-256 为 `4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80`。本篇不缩减目标为 Android 或本轮预算功能；完成本轮后仍需继续全局路线。

用户明确授权：“授权 Camera 及本目标后续已验证增量推送和 CI”。恢复实施后，已验证且完成封存的增量可普通推送到上述仓库的 `agents/upstream-first`，并触发 `ci.yml`，无需逐次再问。同一提交不要重复派发 CI。仍无 registry 发布、真实用户数据迁移、系统自启动修改、历史证据/旧工作区清理授权。

旧手册中的下列内容不能直接照搬：

- “工作树干净、无未封存增量、下一步 MIME”：已过时。当前先完成 `native-upload-budget`。
- 将 token 写入 `.gh-cred.tmp`：不再使用。Git credential helper 只经子进程管道读入内存，不打印或写入凭据。
- 每次封存后更新记忆：本会话规则只允许用户明确要求时写记忆，本轮未写。
- blanket `--no-verify`：当前增量均使用正常 commit/pre-push hooks；不要自行绕过失败。
- 子代理规则：此前确有并行分工；当前上下文已切换为“只有用户或适用规则明确要求才新建子代理”，不要把旧 agent 名称当作仍存活或默认可重建的授权。
- “e2e 先不管”：仅保留已明确的真实 API 凭据缺失例外，不代表可以跳过本轮 keyless Host/Android 行为验收。

用户先前要求持续完成全部目标，但本次是移交，goal 实际已暂停；移交资料生成不构成完整目标完成，也不自动恢复实施。

## 3. 本弧成果与累计阶段

相对前次 HEAD `5bd766f9114174e4d78760977391ec62104a7868`，41 个正式提交已发布。机器清单记录每个提交及累计变更文件；完整产品进展以 [实施状态快照](report-snapshots/IMPLEMENTATION_STATUS.md)、[需求追踪快照](report-snapshots/specification-traceability.json) 和 [证据快照](report-snapshots/evidence.json) 为准。

最近已封存序列包括文件/照片/相机附件、分享确认与原子草稿导入、可信 Host 查看位置深链、前后台 Push、进程级通知权限，以及附件回执失效后的显式恢复。其他本弧成果不要只从这份短列表推断；读取 41 个提交与完整状态快照。

| Phase | 当前报告状态 |
|---|---|
| 0 / 1 | PASS |
| 2 Desktop / 3 Contract / 4 Interaction / 5 Responsive | IN_PROGRESS |
| 6 Diagnostics | NOT_STARTED |
| 7 Device Trust / 8 Remote Transport | IN_PROGRESS |
| 9 Follow/Attach/Handoff/Multi Host | NOT_STARTED（总体验收状态，不能否认局部实现已落地） |
| 10 Native Companions | IN_PROGRESS |
| 11 Lite | DEFERRED |
| 12 Release/RC | IN_PROGRESS；`completeRc=false` |

Gate 0 已通过；不宣称 Gate 1–4 或全平台 RC 通过。Android 模拟器、录制模型回放、Kotlin 受控 TLS、真实 Host、物理设备与真实模型证据必须分别记录。

## 4. 最新已发布检查点：附件回执恢复

提交 `74b476627a`：`feat(android): 引导附件回执失效后的显式恢复并保留新草稿`。来源为 `artifacts/upstream-first/android-attachment-receipt-recovery-source.json`；同名 `-binding.json`、`-report-validation.json` 均已提交。正常提交与推送 hooks、推送前后来源字节核验通过；发布时及本次读取的远端均与 HEAD 一致。

此增量只在 `PromptSubmissionFailure` 精确识别 `session/attachment-invalid` 的字符串原因 `FILE_NOT_STAGED`、`IMAGE_NOT_STAGED`，展示本地化指引；未改变 SessionModel 的 pending/requestId 语义。真实 SAF 场景通过公开 Agent handle 的 flush/dispose、正常 Session Controller resume，使同一 durable Session id 对应新的 Session 对象，令旧 receipt 不再有效。它不是 Host 重启或 TTL；当前 receipt 存储没有 TTL。

验收覆盖原请求拒绝、完全相同参数/requestId 的显式重试、不同新草稿保留、显式丢弃旧 pending、移除并重新选择文件、最后显式发送。A/B/C/D 草稿 id 各异，新旧 receipt 各异；同字节允许复用 attachmentId。两次上传、三次 prompt 调用，只产生一个接受的用户消息。

该轮证据：Core 434 测试/69 suites；设备场景 1/1；Files/Photos/通知权限回归 3 文件/3 用例；文档 17/17 与 36/36；追踪 6；审计 19；篡改负控 3；验证回执 12 哈希。不要把上一轮通知权限的 installed 18 项算入此轮。

来源记录绑定 2,642 源文件、3,703 构建文件、12 日志、331 helpers、4 截图、98 observations、96 historical manifests。本轮预算已修改源码和构建，因此**不要再对活动工作树运行旧附件恢复 final verifier**；其通过字节已保存在新 before 归档中。

发布 receipt：`.artifacts/authorized-attachment-receipt-recovery-publication.json`，dispatch 为 204；[CI 36355618789](https://github.com/nivranic/deepseek-harness/actions/runs/36355618789)。本地最后记录为 queued；本次未刷新 GitHub CI 终态，不能写成成功。上一通知权限 CI `36351654916` 的两个 Python runtime 预检失败已实际读日志确认是 `DEEPSEEK_API_KEY_EXTERNAL` 为空，属于既有真实 API 例外；这不证明最新 CI 的结果。

## 5. 当前未封存增量：实现与分工

详细设计在本包保存的 [预算计划](resume-evidence/native-upload-budget-plan.md)。其开头“未实现/路由阻断”是设计期文字，已落后于源码和本篇验证表；不能据此重新做已完成的 factory 修复或 prepare。当前实现尚未达到发布条件。

| 归属 | 已改内容 | 接手重点 |
|---|---|---|
| Gateway | `packages/api/gateway/src/{index,types}.ts`；`createDeviceConnection()` 与 `TypertGatewayDeviceConnection`；两组 Gateway 测试 | 普通服务方法捕获调用者 Cordis context，保留 `dispatchRpc(..., true)` / `openWireStream(..., true)` 签名与权限路径 |
| Native Host | `packages/api/native-remote/src/{index,types,capabilities}.ts`、transport 测试 | `nativeRemote/httpRequestBudget` 返回同监听器配置；capability `native-remote.http-request-budget.v1`，权限 `view` |
| 正式 Host 实证 | `apps/web/tests/native-remote-isolation.e2e.ts` | 两个 factory 场景已通过；后加的真实文件 B−1/B/B+1、viewer/revoked 场景没有终态结果 |
| Android Core | `NativeGatewayClient.kt`、`NativeGatewayDiagnostics.kt`、新 `NativeHttpRequestBudget.kt`、`NativeFileAttachmentsModel.kt` 和测试 | 每次显式 `fileUploads/upload` 先查预算；生成一次签名 envelope，转一次 UTF-8 bytes，检查后发送同一 bytes |
| Android App | `MainActivity.kt`、`HostCapabilityDetails.kt`、`NativeShareCard.kt`、`native_companion.xml` | Files/分享文件需 FILE_UPLOAD 与 HTTP_REQUEST_BUDGET；本地化缺能力与请求过大提示 |
| 设备验收 | `NativeCompanionAcceptanceTest.kt`、新 `android-native-upload-budget.e2e.ts`、fixture/expected | Driver 新增 transport 失败等待与只读 HTTP 计数；完整场景尚未运行 |
| 文档/生成 | Gateway/Native/Android READMEs、typert 双语、类型清单、Files/Photos/Share 旧 Note | 新 Note 仍在 `proposed/architecture/2026-09-28-native-http-upload-budget.*`，配对和生成未完成 |
| 编译范围 | `apps/web/tsconfig.json`、`tsconfig.host.json` | 正式 Host E2E 已加入 Host include、Client exclude，勿撤回 |

预算是完整 HTTP JSON body 的 inclusive byte limit，包含 RPC 元数据和 device admission，不含 HTTP headers/TLS/chunk framing。现有 Config 已强制正 safe integer；Android 以 Long 保存，不按 Host 数值分配数组。512 KiB 原始文件、1 MiB args、8 附件的本地限制保持；Host 更大不能自动扩容。

预算缺失、未知版本、非法响应或查询失败不回退默认值，不缓存跨请求预算，不追加 receipt、不覆盖草稿/pending。只有本地完整 body 超限映射 `REQUEST_TOO_LARGE`；真实 HTTP 413 仍是 Carrier 失败。`uploadImage` 不接此预算；分享文件自然经过同一个 file endpoint，不能声称生产影响仅限 SAF。没有新增共享 Remote error code，也没有新增 Swift runtime 或 TS/Python stdio SDK 协议。

设备场景设计：700 个汉字的旧 prompt 被实际 Host transport 拒绝，形成 pending A；编辑短草稿 B；1280-byte SAF 文件的 args 小于 2048，但完整 body 超限，要求本地拒绝且保留 A/B；显式丢弃 A、选小文件、显式发送 B。用两次相同且已收束的 HTTP 计数快照与冻结的全部 Gateway invoke 账本比较，防止把“已发出但被 413 拒绝、未进入 invoke”误报为零 POST。请保留这个并发修正。

## 6. 已观察的验证与未完成工作

以下日志均位于工作树 `.artifacts/`，本包 [evidence-index.json](evidence-index.json) 记录哈希，主要文件已复制到 `resume-evidence/`。数字不跨重复运行累计。

| 证据 | 观察结果 | 主要日志 |
|---|---|---|
| 旧行为基线 | 1 文件/2 用例，成功复现 B 返回 A、仅 B 查询拒绝；不是功能通过 | `native-upload-budget-scope-feasibility.run.log` / `.evidence.log` |
| Gateway/Native factory 源码测试 | 3 文件/154 测试通过 | `native-upload-budget-factory-unit.log` |
| 同 scope 重复注册 | 定向 1 用例通过，不累加成新完整套件 | `native-upload-budget-factory-duplicate-scope.log` |
| 正常 profile factory | 1 文件/2 用例通过；RPC、签名/角色、流撤权、关闭与 A 存活 | `native-upload-budget-factory-proof-cleanup-fixed.log` |
| Native Host transport | 1 文件/27 测试通过；预算/权限/配置/declared 与 chunked 413 | `native-upload-budget-host-unit.log` |
| Host / Client 构建 | factory Host、修正后 Client、预算 Host 构建退出 0 | `native-upload-budget-factory-build.log`、`native-upload-budget-factory-client-build-fixed.log`、`native-upload-budget-host-build.log` |
| Android Core | 7 suites / 57 测试，失败/错误/跳过均 0；14 项新增测试包含在 57 内 | `native-upload-budget-core-results.json`、`native-upload-budget-android-initial.log` |
| App 与 test APK | 两者构建成功；2026-09-28 已在 emulator-5554 执行 install -r -t，各返回 Success | 同一 Android 构建日志；安装来自会话执行结果，未另存安装日志 |
| 聚焦 lint | Gateway factory 与 root 设备 E2E 的最后定向 oxlint 通过 | `native-upload-budget-factory-oxlint.log`、`native-upload-budget-e2e-oxlint-ledger.log` |
| 正式 Host 完整预算边界 | **未完成**：`native-upload-budget-host-proof.log` 只有 RUN 头，没有测试结果或退出码 | 不得拿 factory 的 2/2 代替当前含第三项的完整文件 |
| 已安装 SAF 新场景及回归 | **未运行**；APK 安装不等于验收通过 | 尚无该场景成功日志、installed-apks receipt 或截图 |
| catalog/配对 | **未完成**：catalog 尝试报 `uv_os_get_passwd ENOMEM`；未观察到成功重试 | `native-upload-budget-doc-catalog.log` |
| 当前完整类型/lint/文档/追踪/Gate 0/封存 | **未完成** | 不要复用旧增量的 PASS |

Core 57 项覆盖七类：`NativeHttpRequestBudgetTest`、`NativeGatewayUploadBudgetTest`、`NativeGatewayProtocolTest`、`NativeGatewayDiagnosticsTest`、`NativeFileAttachmentsModelTest`、`NativeShareAttachmentsModelTest`、`CompanionHostControllerTest`。公共 Controller 切换 A/B 与回调清零使用受控 TLS server，不能称为完整真实 DSH Host 验收。

## 7. 失败、修复与仍开放的限制

1. **作用域缺陷已复现并修复到 factory 阶段。** 原 `deviceConnection` 为捕获根 Gateway 实例的普通对象，隔离的 Native B 共享根 Gateway 时可能路由到 A。新工厂利用 Cordis 普通服务方法的 caller context；不使用绕过设备 admission 的 `invoke/stream` 替代品。真实双监听器和仅 B 场景通过。
2. **构建入口差异。** Gateway 的 `lib/index.js` 由 Client face 发出；只做 Host build 会更新 `lib/types/index.js` 而留下旧公共入口。已完成修正后的两面构建。以后改 Gateway 必须覆盖这一路径，不能因 tsc 中间产物变新就认定实际 Loader 采用新代码。
3. **测试编译面遗漏。** 新 Host E2E 初次未 exclude 出 Client，导致 rootDir/Context 连锁错误。已补登记。本次产生的 668 个源旁 JS/d.ts/map 经 Git 未追踪、相邻源、sourcemap 与时间核对，完整备份后只删除这些输出；备份 `.artifacts/native-upload-budget-client-emissions/manifest.json`，不可清理或重新运行其一次性清理 helper。不是 vendor 产品错误。
4. **dispose 二次调用。** `fiber.dispose()` 在已卸载时可返回 void，不能直接 `.catch`。正式测试改为 try/await/catch，并等待实际 WS close、generator finally 与服务移除。基线清理表述收窄见 `native-upload-budget-baseline-cleanup-clarification.md`；原日志不改。
5. **Core 统计初稿。** PowerShell 字典聚合产生 null 总数，保存于 `native-upload-budget-core-results-initial.json`；正确 JSON 由 XML 解析得到 57/7，并绑定七份 XML 哈希。不要使用 initial 总数，也不要重复运行一次性解析 helper 覆盖已保留副本。
6. **lint 工具。** 仓库用 `pnpm exec tsx scripts/run-oxlint.ts <files>`；无 ESLint 配置。ESLint 失败、TSX 沙箱失败和初始单行长度失败均保留，最后定向 oxlint 通过。
7. **游标调查仍开放。** `.artifacts/android-push-foreground-cursor-investigation.json` 为 `OPEN_UNCLASSIFIED`，SHA `85cadc4359e7b11473f3f46f4d7d3b12837425e1632b4e20a86cd10c6f41b457`。后续通过不证明原因或修复；下次失败记录 received/applied cursor 及有界视口/匹配诊断。
8. **其他边界。** Scanner 仍为 same-host/shared-cache 资格，`GO-2026-5932` 保持开放。真实 API 缺 `DEEPSEEK_API_KEY_EXTERNAL` 的例外保留，不索要或打印秘密。Host 重启后的 receipt、真实照片 receipt 恢复、真正 HOME→Recents→task-card 恢复、真机、Apple、跨平台发布仍不可由本轮推断通过。

## 8. 恢复后的执行顺序

1. 先运行本包 `node verify.mjs --live`，核对源码快照、HEAD、关键证据；它不跑产品测试、不查询远端。再次确认没有旧测试/生成器在运行。当前源已 dirty，绝不能重新 prepare 或套用补丁到同一工作树。
2. 复核 `apps/web/tests/native-remote-isolation.e2e.ts` 的第三项真实文件测试及中断位置。保留当前不完整 `host-proof.log`，使用新日志名跑整个正式文件，确认 B−1/B 成功、B+1 被真实 bridge 413 拒绝、viewer/revoked 不能上传且无存储副作用。
3. 继续 catalog/双语配对。`gen-cordis-api.ts` 是主 catalog 生成器的兼容入口，不要重复全局生成；主入口生成一次，再对兼容入口 `--check`。按现有 ENOMEM 证据窄幅宿主重试。检查新公开类型的归属、type-equiv 与 `tool-cordis/src/api-catalog.ts`。新 Note 暂在 proposed；完成实际证据后再迁至 implemented、修复链接并重新 pairing。
4. 源码/生成物稳定后统一按受影响面构建，避免 worker 各自改共同输出；Gateway 改动需要 Client face。已有 passing 检查不因 commit/push机械重跑，但新生成源码或修复影响到的路径必须重验。
5. 运行已安装 Android 新 SAF 场景。确认模拟器及 APK 当前 SHA；若重建过 APK，先重新安装两份。检查全部退出码、HTTP 账本、草稿/pending、唯一持久消息和正常清理，实际查看三张计划截图。
6. 跑最小相关回归：Files、附件 receipt 恢复、分享文件原子采纳；共享图片逻辑若有实际变化，再加 Photos 对应回归。受控预算坏值/未知能力、关闭/Host 切换的 Core 证据与真实 DSH Host 证据分开。
7. 独立复核与完整相关类型/lint、`test:docs`、`doc-sync`、追踪和 Gate 0；完成文档与 Note。当前所有 pairing sidecar 仍可能陈旧，不能在未完成时宣称文档门禁通过。
8. 然后才为 `native-upload-budget` 编写 capture/advance/alias/recapture/binding/validation/final helpers。当前仅 prepare 与其纯验证 helper 已存在，**尚无** `artifacts/upstream-first/native-upload-budget-source.json` 等终态记录。
9. source capture 后冻结其全部输入；按旧封存机制生成报告、做负控、最终收口。审计 19 项命令必须同时选择 `specification-traceability.test.mjs` 和 `verify-audit.test.mjs`，单后者只有 13 项。
10. 正常 hooks 提交/推送，审查待推历史不含临时提交，实时核对远端 SHA、ahead/behind，再只派发一次 CI。之后继续全局规格，不把本轮当作整个目标完成。

本轮 before 已保存附件恢复的最终 receipt 输入与报告字节；其 prior 固定为 `a6885018…`。后续 advance 的前一最新块为 `const androidAttachmentReceiptRecoveryPath =`，新块与历史映射要按实际模板检查；不能盲目复用上轮锚点。保留共享 `archivedInputs`、600000ms 篡改进程预算，以及 `evidence.json` 跨代嵌入前代哈希、并非字节稳定的事实。

## 9. 环境和可直接使用的命令

Windows 仅用 PowerShell 7：`C:/Program Files/PowerShell/7/pwsh.exe`；Python：`D:/.PYENV/pyenv-win/versions/3.12.10/python.exe`。工具名为 powershell 不代表可使用 5.1。所有下列产品命令的根目录为实施 worktree，Gradle 例外在 `apps/android`。

```sh
pnpm run build:lib:host
pnpm run build:lib:client
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/native-remote-isolation.e2e.ts
pnpm exec tsx scripts/gen-cordis-catalog.ts
pnpm exec tsx scripts/gen-cordis-api.ts --check
pnpm exec tsx scripts/run-oxlint.ts apps/web/tests/android-native-upload-budget.e2e.ts
node --test artifacts/upstream-first/specification-traceability.test.mjs artifacts/upstream-first/verify-audit.test.mjs
node artifacts/upstream-first/verify-audit.mjs --require-gate0
```

设备命令前设置 `DSH_ANDROID_ADB=E:/Android_Studio_SDK/platform-tools/adb.exe`、`DSH_ANDROID_SERIAL=emulator-5554`、`DSH_SNAPSHOT=replay`。必要时 Chrome 路径为 `C:/Program Files/Google/Chrome/Application/chrome.exe`；不要把 record/refresh 模式当作默认验收。

```sh
pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/android-native-upload-budget.e2e.ts
```

Gradle 环境：`JAVA_HOME=E:/DevTools/jdks/corretto-17.0.14`；`ANDROID_HOME=E:/Android_Studio_SDK`；`DSH_ANDROID_SCANNER_DIRECTORY=<worktree>/.artifacts/native-scanner-candidate-output`；`DSH_ANDROID_SCANNER_SOURCE=8ca9f6ebf33de3912292416b85f5b510c88de9a3`。清空进程内 `DSH_ANDROID_APPLICATION_SOURCE` 和 `DSH_ANDROID_APPLICATION_TREE`，不要篡改用户全局环境。

```powershell
.\gradlew.bat :core:test --tests ai.deepseek.dsh.gateway.NativeHttpRequestBudgetTest --tests ai.deepseek.dsh.gateway.NativeGatewayUploadBudgetTest --tests ai.deepseek.dsh.gateway.NativeGatewayProtocolTest --tests ai.deepseek.dsh.gateway.NativeGatewayDiagnosticsTest --tests ai.deepseek.dsh.companion.NativeFileAttachmentsModelTest --tests ai.deepseek.dsh.companion.NativeShareAttachmentsModelTest --tests ai.deepseek.dsh.companion.CompanionHostControllerTest :app:assembleDebug :app:assembleDebugAndroidTest -PdshNativeAcceptance
```

两 APK 为 `apps/android/app/build/outputs/apk/debug/app-debug.apk` 与 `apps/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk`，分别执行 `adb -s emulator-5554 install -r -t <APK>`。Driver 不负责安装，只比较安装与构建哈希。包名必须为 `com.deepseek.harness.companion.nativeacceptance` 及其 `.test`，不要操作真实应用数据或物理设备。

Git 网络的已用参数是 `-c http.proxy=http://127.0.0.1:7898 -c http.version=HTTP/1.1`；不改全局代理。TSX ENOMEM、Gradle cache lock、ADB 用户目录以及工作树 `.git` ACL 已有沙箱失败证据，可按当次权限规则使用最小宿主重试，不能绕过产品失败。

## 10. 本包附件与恢复边界

| 附件 | 内容 |
|---|---|
| [state.json](state.json) | 本次时间、目标状态、Git、授权、封存断点、APK 与关键 SHA |
| [changes.json](changes.json) | 41 提交、累计文件变化、当前未封存文件及字节快照清单 |
| [tracked.patch](tracked.patch) | 当前 tracked 产品差异，不含本移交包或遥测 |
| `uncommitted-files/` | 每个当前修改/新增产品文件的原字节副本，包含未跟踪 Kotlin/E2E/Note |
| [evidence-index.json](evidence-index.json) | 主要日志/helper/计划、当前 XML、before 清单的来源哈希与副本映射 |
| `resume-evidence/` | 当前预算计划、主要检查/失败日志、必要 helpers 的副本 |
| `report-snapshots/` | 最后已封存实施状态、需求追踪及机器证据，不能当作预算已验收 |
| [manifest.json](manifest.json) / [verify.mjs](verify.mjs) / [verification.json](verification.json) | 包内哈希、只读验证器与本次结果 |

本包不是完整离线构建环境：没有复制全部 `.artifacts/` 历史 before 归档、APK/AAR、node_modules、Gradle/SDK、证书/Keystore、用户凭据或模拟器状态。跨机器接手必须另行保留实施 worktree 的完整 `.artifacts/` 历史证据及必需构建资源；仅 clone 远端加本包，不能通过完整历史封存校验。禁止把真实凭据当作移交附件。

同机直接沿用 dirty worktree，不要 apply patch 或覆盖 `uncommitted-files`。异机恢复应先 checkout 精确 HEAD，再在新的隔离 checkout 审查后应用 tracked.patch，复制 changes 清单中原本 untracked 的文件；完整快照用于校对字节，不要盲目覆盖已有工作。

本次核验仅涵盖移交包、现有证据哈希、当前修改一致性、实时远端 SHA与具名活动进程。没有重跑产品构建、门禁或设备场景，也没有声称 CI 已通过。旧手册 SHA 与完整规范、快照和当前产品字节均由验证器核对。对未封存文档的临时坏链接/陈旧 sidecar 不在移交时偷偷修复。

## 11. 给下一位 Agent 的提示词

```text
请接手并继续 Upstream-First 完整目标，先阅读：
E:/Mix/project/deepseek-harness/.worktrees/upstream-first/artifacts/upstream-first/handoff/2026-09-29-01/HANDOFF.md

工作树是 .worktrees/upstream-first，分支 agents/upstream-first；HEAD/远端74b476627a。当前有未封存 native-upload-budget 改动，不能重做 prepare 或覆盖 dirty 文件。最新已封存 source 是 android-attachment-receipt-recovery，SHA a6885018…；当前before6924文件，SHA a239e973…。
先运行本包verify.mjs --live，然后按第8节完成尚无终态的真实Host完整预算测试、catalog/配对、已安装SAF场景和相关回归。Core57/7、factory真实2/2、Host transport27只证明各自范围。已有经验证增量的普通推送及CI授权，不必逐次再问；normal hooks、遥测排除、凭据仅内存、完整目标不标完成的规则保留。当前子代理能力和授权遵循新会话实际指令，不假定旧代理仍存在。
本轮封存并发布后继续完整81节规格；不能把Android预算功能等同全目标完成。下一次移交保留此包，新建日期目录并更新LATEST.json。
```
