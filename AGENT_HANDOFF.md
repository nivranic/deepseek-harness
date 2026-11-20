# Agent 移交手册

更新日期为 2026-11-15。本文保存 2026-10-31 的审查记录，并在下节补充本次提交收尾结果。后续开发按用户要求暂停。

## Summary

用户已授权提交并推送 `dev` 的全部有效改动。本次 7 份定向测试共 98 例通过，包含两条撤销认证竞态回归。完整 `build` 的 10 项通过。产品验收与源代码归属分类继续保持待办，`completeRc=false`。

恢复开发时，先解决个人 Desktop 全新数据目录缺少 profile 的首次启动问题，再补齐源代码归属分类。实现工作树的重植与 CI 待办另见本地 port-note 附 8 的第十三批交付记录。

### 本次提交收尾

主仓 `dev` 与实现工作树 `agents/upstream-first` 已分别核对分支及远端，fetch 后均无既有待推送提交。56 个源码旁编译输出和 5 个 tsx 缓存已逐项核实并可逆移至 Git 忽略的 `.artifacts/push-20261115-residue/`，源码和协议生成文件纳入提交范围。个人路径已从共享报告中替换，个人打包安装目录使用 `%LOCALAPPDATA%\Programs\DeepSeek Harness Personal`，PowerShell 调用使用 `pwsh`。

本次日志位于 `.artifacts/upstream-first-review/push-*.log`，这些本地收据由用户保管。文档工具的缺失导出已定位到依赖联接仍指向删除的旧工作树，在本 checkout 找到实体目录的 897 个 pnpm 联接已重新挂回本地，8 个无对应实体目录的旧 hoisted 联接保留待查。修复联接后完整构建和 98 例定向测试再次通过。

| 检查 | 本次结果与本地收据 |
|---|---|
| 定向行为 | 7 文件 98/98，`push-focused-final.log` |
| 完整 build | 10/10，包含 Host/Client aggregate check，`push-build-final.log` |
| 完整 Lint | EXIT 0，`push-lint.log` |
| 文档 quick | 21/21，`push-docs-quick.log` |
| 文档生成图与 Mermaid | 7 份图 freshness 与 18 个 Mermaid block 均通过，`push-verify-*-recheck.log` |
| 文档站构建 | EXIT 0，5,300 个内部 fragment 解析通过，`push-doc-build-recheck.log`。构建日志保留 es2024 target 相关告警 |
| 文档站测试 | 165 例通过，1 例 Windows symlink EPERM，`push-doc-site-recheck.log` |
| hygiene | 14 项通过、10 项失败，`push-hygiene.log`。失败涵盖版本/files、locale metadata、产品分类、runtime closure、unknown casts、publint、application entrypoints、vendor rescope 与 NodeNext |
| NodeNext 定因 | 原始失败为创建目录 symlink 时 EPERM，`push-node-next-diagnostic.log`。按既定 Windows 环境裁定交由 Linux CI 负责 |

42 条版本/files 失败涉及的字段逐项与提交前 HEAD 比较，全部一致，见 `push-constraint-baseline.json`。entrypoint、默认产品依赖和 runtime closure 的报错 owner 也与 HEAD 一致。本次 diff 新增 `as unknown` 行数为零。vendor rescope 原始错误为 `git ENOBUFS`。完整 `hygiene` 和 `doc-sync` 保留失败状态，后续仍需处理其失败项与平台信号。

## Table of Contents

- [1. 用户目标与边界](#1-用户目标与边界)
- [2. 仓库基线与保留现场](#2-仓库基线与保留现场)
- [3. 最后停下的位置](#3-最后停下的位置)
- [4. 已实施改动](#4-已实施改动)
- [5. 实际验证记录](#5-实际验证记录)
- [6. 审查覆盖缺口与产品阻塞](#6-审查覆盖缺口与产品阻塞)
- [7. 环境与浏览器安全约束](#7-环境与浏览器安全约束)
- [8. 建议接手顺序](#8-建议接手顺序)
- [9. 报告与上下文入口](#9-报告与上下文入口)
- [Dev Note](#dev-note)

## 1. 用户目标与边界

用户要求按照《DeepSeek Harness 下一版 Agent 总实施规格（Upstream-First）》完整复核现有改动、个人/官方 Desktop 并行逻辑及更新后的上游差异，迭代处理发现的问题。规格原件由用户在仓库外保存，共 3,101 行，编号章节 0–80；本次已通读并建立 81 行追踪表。

后续补充明确允许两个薄 Desktop 壳并行。不要把“两套发行壳”本身当作缺陷；该许可不允许复制 Agent loop、持久化 Session 真相、业务 RPC 或凭据体系，也不免除安装、进程、数据、更新及身份隔离。

用户先要求收尾并移交，随后授权 push 所有改动。提交推送完成后保持开发暂停，恢复工作以用户后续指令为准。

## 2. 仓库基线与保留现场

以下表格记录 2026-10-31 审查时 `dev` 的基线。当前状态以本次收尾记录和现场 Git 查询为准。

| 对象 | 身份 |
|---|---|
| 审查时 dev HEAD | [基线快照的 candidate.head](.artifacts/upstream-first-review/baseline.json) |
| 审查时已采纳官方基线 / merge-base | [基线快照的 adoptedUpstream、candidate.mergeBase](.artifacts/upstream-first-review/baseline.json) |
| 审查时直接获取的最新官方 | [基线快照的 official.head](.artifacts/upstream-first-review/baseline.json) |
| 对应本地引用 | `refs/remotes/audit-upstream/master` |
| dev 相对本次获取的官方 | ahead 165 / behind 351 |
| 基线 → dev / 基线 → 新官方 | 1,233 / 1,461 个变化路径；不是冲突数 |

已执行过直接 fetch，没有添加 upstream remote 或修改 Git 配置：

```sh
git fetch --no-tags https://github.com/deepseek-ai/deepseek-harness.git master:refs/remotes/audit-upstream/master
```

### 不能覆盖的现场

- `.worktrees/upstream-first` 的分支为 `agents/upstream-first`。审查时的未完成合并、16,581 条 tracked-status 记录和 29,409 个 untracked 路径保存在基线快照中。该历史状态已过期，接手时查询当前 Git 状态，保留其现场。
- 56 个既有的源码旁 `.js/.js.map/.d.ts/.d.ts.map` 输出原位于 `packages/llm/deepseek-llm-api-extensions/src` 和 `packages/test-support/{llm-replay,loader-smoke,session-snapshot}/src`。本次已核实各文件对应的 TypeScript owner 和 sourcemap，并保留到 `.artifacts/push-20261115-residue/`。
- `desktop-manager/` 是另一个 C#/WinUI 工程，不是 `apps/desktop-user`。
- 本次未修改官方 `apps/desktop` 源码；先前执行 `git diff --quiet -- apps/desktop` 通过。不要将“官方源码未改”误解为官方集成或安装已验收。

四个过期且被忽略的 `packages/settings/settings/lib/types/invariant.*` 产物因引用已删除导出而阻塞构建。已可逆移到 `.artifacts/upstream-first-review/orphan-settings-invariant.*`；没有删除源码，也没有运行全仓 clean。

## 3. 最后停下的位置

这部分优先级高于其他状态报告中的旧结论。

### 3.1 撤销认证竞态回归已通过

此前的修复会在设备被撤销时销毁其活动 HTTP 响应，但认证可以已经读取到旧设备记录、尚未恢复执行。即使 socket 被销毁，旧认证结果恢复后仍会进入 RPC 或 stream 派发。

已在 `packages/remote/link-access/tests/carrier.spec.ts` 新增两个真实 TLS 回归：暂停 `deviceTrust.device()` 的首次查询返回，撤销设备，等待连接断开，放行旧记录，等待实际 route 完成，最后检查 probe 没有执行。通过实例级 `handle` 包装观测完成，避免负断言跑在服务端继续执行之前；spy 和包装在 finally 恢复。

修复前命令：

```sh
pnpm exec vitest run packages/remote/link-access/tests/carrier.spec.ts -t "revoked during authentication"
```

记录：`.artifacts/upstream-first-review/revocation-admission-before.log`。结果为两个预期失败：unary 实际执行 `echo:revoked-during-auth`，stream 实际执行 `tick:0`。

随后仅在 `packages/remote/link-access/src/index.ts` 的 Describe、Unary、Stream 三处 `await this.authenticate(req, body)` 后添加了：

```text
if (res.destroyed) return
```

2026-10-31 停止时这三处尚未复测。2026-11-15 的 `push-focused.log` 已记录包含两条竞态用例的 98 例定向测试通过，`push-build.log` 记录完整构建与 Host/Client aggregate check 通过。

本次相关远程测试包含以下三份文件，完整 7 文件选择见本次日志。

```sh
pnpm exec vitest run packages/remote/link-access/tests/carrier.spec.ts packages/remote/device-trust/tests/device-trust.spec.ts packages/remote/link-client/tests/link-client.spec.ts
```

该检查只关闭“撤销发生在认证恢复之前”的已证实问题，不保证回滚已提交操作，也不代表所有撤销、关闭和已接收业务操作竞态都已解决。

### 3.2 个人 Desktop 全新 home 首次启动：已修复（源码与回归层）

独立只读复核发现根因：`apps/desktop-user/src/main.ts` 把 `DSH_HOME` 默认切到 `~/.dsh-personal` 后直接以 `profile: 'desktop'` 调用命名 profile 启动器。缺少 profile manifest 时只有存在 shipped template 才能自动初始化（`packages/boot/app-boot/src/profile.ts` 的 `loadProfile`），而 `packages/util/official-bundles/src/bundles.ts` 的模板表刻意没有 `desktop` 行——desktop 应用自持该 profile 的初始 bundle 列表（官方 Desktop 在 Host 启动前经 `DesktopProjectManager.applyRelease` → `createPluginProfile` → `initProfile(dir, WEB_PROFILE.bundles)` 完成同一初始化）。全新 home 下个人版在进入应用前抛错。

本次修复复用同一共享能力，未创建第二套 profile 语义：新增 `apps/desktop-user/src/first-run.ts`（`createDesktopProfile`：以官方 web 模板 bundle 列表调用共享 `initProfile`），`main.ts` 在 `startGateway` 的动态导入组内于 `runProfile` 前执行；`initProfile` 对 manifest、`cordis.patch.yml`、`pnpm-workspace.yaml` 三件均只在缺席时写入，既有文件与用户数据不被触碰。真实入口回归 `apps/desktop-user/tests/first-run.spec.ts` 三例：空 home 经真实 `loadProfile('dsh desktop-user', 'desktop', anchor, home)` 装载（此前该调用必抛）、`DSH_DESKTOP_USER_HOME` override 同链路、已初始化 profile 与用户 patch 层逐字节不被重写。desktop-user 11/11（8 path + 3 新）通过；lint 0/0；typecheck 五门 5/5；完整 build 见 `.merge-helpers/personal-first-run-build.log`。

未完成边界：真实打包安装后的首次启动验收、安装态升级后首跑仍开放（个人打包本身仍是 unsigned 源码层验证）；本修复不迁移、不触碰 `~/.dsh` 官方 home 的任何数据。

### 3.3 浏览器验证没有完成

本地 Web 后台启动任务 `ba0b3tqta` 已报告 exit 1；其任务输出为空，旧 `web-ui.log` 只有曾经监听 3001 的记录。后来访问无令牌的 3001 得到 `ERR_CONNECTION_REFUSED`，不能认为服务仍运行。

一次在新隔离 context 中使用启动 URL 的导航被工具以令牌泄露风险阻止，没有继续尝试该令牌或绕过认证。之后的无令牌导航因连接拒绝失败。没有观察到真实主界面、弹层、登录成功或截图，没有操作用户已有浏览器标签页。

不要通过另一个工具、脚本注入 Cookie 或伪造登录来规避上述阻止。若认证需要用户操作，由用户在允许的独立浏览器完成。未获得 browser page ID，当前不能声称成功创建或清理了一个可用页面。

## 4. 已实施改动

以下是本次改动的范围摘要，具体以当前 Git diff 为准。除 3.1 的最终改动外，验证范围见下一节。

| 范围 | 改动与限制 |
|---|---|
| Client bundle | `packages/client/ui-desktop/tsdown.config.ts` 使用 `import.meta.dirname`，修复把包名当目录导致的 ENOENT |
| 依赖 | 修复 `api/remotes`、`ui-desktop`、`ui-settings-general` 的已分类 dependency 声明，删除重复本地 React types，刷新锁文件及 module graph |
| Remote 测试组合 | LinkAccess/LinkClient 测试在 Gateway 前挂载真实 RemoteAccessService，补 devDependencies，并更新官方 Gateway 错误码期望 |
| 设备撤销 | trust store 首次成功提交撤销后发 typed event；carrier 按设备跟踪响应、撤销即 destroy；包括 carrier 与直接 trust-store 路径，不影响其他设备 |
| 撤销文档生成 | generator 的 EVENT_SCOPE_PAGE 增加 `device-trust` → `remote-link.md`，重生成 subsystem/API catalog，更新 README pair |
| 原生 fold | Kotlin/Swift 改为 message-level `toolCallId`、flat role-tool result、`assistant/attempt`；可见摘要合并 packed text 与 raw text-delta，排除 reasoning/finish |
| 生成协议 | LinkStreamRecord 支持 raw chunk 投影，相关 packed-only 字段 optional；新增 assistant-attempt golden，重生成 Swift/Kotlin/Android/Apple 各副本 |
| Smoke 弹层 | 删除 `dsh-smoke` 存在即注入 `[role=presentation]{display:none!important}` 的行为；测试覆盖无参数、0、1；个人 main 移除旧 smoke URL 参数辅助 |
| 个人路径 | 默认 `~/.dsh-personal`，支持非空绝对 `DSH_DESKTOP_USER_HOME`，在动态导入前设置 DSH_HOME；保留已有 Electron userData，不自动迁移数据；首次 profile 初始化仍缺失 |
| 构建顺序 | 根 tsdown 的并发 workspace 排除官方 Desktop；官方仍在共享 Host libs 后单独 bundle；个人壳加入 Host pass；个人 tests 纳入 host aggregate |
| 个人打包 | mkdtemp 私有 stage；独立产品、exe、appId、安装路径和快捷方式；进程结束改为按两个明确个人 exe 路径过滤，不再全局 taskkill 同名官方进程 |
| 升级文档 | 新增 `docs/upgrade-guide/v0.2.2-alpha.2/personal-desktop-isolation/` 双语 guide 与 pairing record |

个人打包仍是 unsigned 路径，截图大小启发式的验收仍待完成。`com.deepseek.dsh.personal`、`DeepSeek Harness Personal.exe` 及 `%LOCALAPPDATA%\Programs\DeepSeek Harness Personal` 的更改只完成源码层验证，真实打包和安装待验。

## 5. 实际验证记录

证据目录为 `.artifacts/upstream-first-review/`。下列成功只对当时源码成立；3.1 的最后修改之后没有重跑。

| 检查 | 结果与日志 |
|---|---|
| 生成 Link contracts freshness / TS contracts | 通过；18 个 tests；`contract-raw-stream-after.log`、`contracts-catalog-final.log` 等 |
| Android JVM core | 最终 98 cases，0 failed/errors/skipped；`kotlin-core-regenerated.log`、`kotlin-test-counts.json`。不是 APK 或设备验收 |
| Remote/trust/client 既有修复组合 | 57 个 tests 通过；`revocation-after.log`。不包含最后新增的两条认证竞态回归 |
| Cordis catalog partition | 正确文件 `scripts/gen-cordis-catalog-partition.spec.ts` 的 10 tests 通过；`catalog-partition-final.log` |
| Smoke boot | 两个负对照先失败，修复后 13 tests 通过；`smoke-overlays-before.log` / `smoke-overlays-after.log` |
| 个人 path | 8 tests 通过；`personal-paths-final.log`，不是首次 profile 启动验收 |
| Dependency policy | 95 个 covered packages 通过；`dependencies-final.log` |
| build:artifacts | 8/8 通过；`build-artifacts-ordered.log`。先前失败日志保留，不代表最终失败 |
| build:check | Host/Client 2/2 通过；`build-check-ordered.log`；个人测试纳入 aggregate 后的 `build-check-tests-integrated.log` 也通过 |
| Local Web auth | 25 tests 通过；`local-web-auth.log`，覆盖 Host/Origin、loopback、browser auth 的局部行为，不是完整威胁矩阵 |
| Docs quick | 21 checks 通过；`docs-quick-after.log`，不包含本手册及最后更新后的所有文档状态 |
| Focused lint | 17 files，0 errors/warnings；`focused-lint-after.log`，不包含 3.1 最后新增测试和 guard |
| 最后认证竞态负对照 | 2 failed / 28 filtered skipped，确实执行了两条目标测试；`revocation-admission-before.log` |
| 最后认证竞态修复后 | 2026-11-15 已通过；本次 7 文件 98 例包含两条认证竞态回归，见 `push-focused.log` |
| 真实 Web / installed Desktop / Apple Swift / 物理设备 / 签名更新 | **未完成，不得标 PASS** |

先前一个命令误写不存在的 `gen-cordis-catalog.spec.ts`，Vitest 过滤后只跑了其他合同测试；后来已改跑真实 partition 文件。不要引用错误路径那次作为 catalog 证据。

计数脚本最初的正则误转义曾得到 0，已经修正并生成拒绝零计数的最终 Kotlin 汇总；使用最终 `kotlin-test-counts.json`，不要引用中间计数。

## 6. 审查覆盖缺口与产品阻塞

81 行需求追踪不等于逐个 executable owner 已审查。独立审计得出以下覆盖事实：

- `CUSTOM_CAPABILITY_INVENTORY.json` 的 121 个原始 owner 记录仍全部为 `classification: null`、`sourceReviewComplete: false`。
- 只有 10 个能力组给出了六类 disposition，命名覆盖 18 个原始 owner；其余 103 个没有对应分组 disposition。
- 45 个变化的 source-bearing owner 加 Relay 中，仅 13 个有能力组映射，32 个没有；构建/gate scripts 还有额外可执行范围。
- 精确基线 → dev、排除 vendor/archived/.worktrees 后为 1,232 个变化路径，全部在 inventory 中；inventory 额外一项是 vendor。路径收全不等于语义审查完成。
- 81 行状态统计为 40 IN_PROGRESS、18 NOT_STARTED、17 FAIL、4 BLOCKED、1 DEFERRED、1 PASS。不能将报告存在当作 Gate 0 通过。

### 优先补审的三个未覆盖执行区域（2026-11-20 补审完成）

六类归属已入 `CUSTOM_CAPABILITY_INVENTORY.json`（新增三组，13/121 owner 分类，108 仍开放），证据与执行注意见 `.artifacts/upstream-first-review/owner-review-{sandbox-shell,code-runtime,relay}.md`：

1. **执行隔离与 Electron 子进程**＝Adapt×7＋Keep×1：sandbox/shell 七包保持官方基座（对 [UPSTREAM_BASELINE.md](UPSTREAM_BASELINE.md) 所记官方基线 git diff 实测＋235/-28，其中源码净增约 +140，性质单一连贯＝`PreparedArgv.runnerEnv` seam，服务 Electron 宿主下 ACL runner 的 RunAsNode 前置，runner 启动被包裹命令前删除该变量）；node-spawn 官方缺席、2 个生产消费者（sandbox-local、directory-picker win32 宿主）＝Keep。环境覆盖序已核（scrubbed 基底→ENV_OVERRIDES<spec.env<dshEnv<runnerEnv；win32 大小写不敏感＋tombstone）。记录未改的两个观察：NODE_OPTIONS/--inspect 无 spawn 侧清理；ptc-runtime-node 未合并 `confined.env`（与 bash/pwsh executor 不对称，预期 fail-closed 非静默）。
2. **code-runtime 家族与 worker-thread 引擎**＝Delete×2＋Migrate×2：code-runtime 与官方 ptc-runtime 逐字同源（四常量＋抽象类仅改名）且 `ctx.codeRuntime` 全仓零消费者；code-runtime-python 零依赖零挂载；code-runtime-worker-thread 唯一引用＝desktop 挂载行无调用者；workflow-worker-thread＝官方 workflow-ptc 的 fork、本地零启用挂载（desktop 显式 disabled、cli 依赖未用）。官方侧经对基线 git diff 验证零改动（基线见 UPSTREAM_BASELINE.md），同源主张成立。**两批迁移均已执行（2026-11-20）**：workflow-worker-thread——包连同未用 cli 依赖、desktop 禁用行、tsconfig 引用移除，升级指引 `docs/upgrade-guide/v0.2.2-alpha.2/workflow-worker-thread-retired/`；code-runtime 家族——三包连同 desktop 挂载行与依赖、tsconfig 引用、生成器段落（doc-graph seam 条目、cordis-catalog 服务页与类型豁免、readme model-experience 条目）、packages README 行、capability-seams 中文镜像一并移除，升级指引 `docs/upgrade-guide/v0.2.2-alpha.2/code-runtime-family-retired/`；全部生成目录刷新（config-catalog/cordis-api/module-graph/doc-graphs/plugin-packages；dependency-catalog 按 registry 发布事实保留历史条目）。门禁：typecheck 5/5、lint 0/0@6821、extensions+ptc+bundle+cli 定向 1088+ 过（product-analytics 两例并行负载超时＝单跑与限并发 204/204 复跑通过的本机时序 flake）、doc-sync 唯一失败＝既知 Windows symlink EPERM（CI-Linux 负责）。
3. **Relay**＝Experimental：产品组合零接线（Keep 不成立）；Android/Apple 两 native Noise 端口与向量的唯一再生成源（Delete 本轮不成立）；上生产硬缺口＝随机 token＋账号归属、服务端公钥 pin/TLS、body/队列/会话/流上限与背压。README 原型状态声明与两 native README 降级措辞已落地（2026-11-20）。

### 已报告但未完成的产品要求

- Android 生产 LinkClient 使用默认 JDK HTTP client，存储的 SPKI pin 未接入请求；`java.net.http` 在真实 Android app 的可用性也未通过 JVM 测试证明。
- 两端 native 没有把版本/capability handshake 作为业务调用前置条件。
- Apple Keychain save/clear 忽略状态码，持久化失败仍可能宣称配对/取消成功。
- 四角色权限、完整 HostDescriptor/N/N-1、通用幂等与 pending Approval 恢复未建立。
- timed question 确有 Host-log 恢复，不应笼统声称所有 Interaction 都不持久；一般 live settlement first-wins，但晚结果静默 no-op，未达到规定 closed-interaction outcome。
- 当前 snapshot handoff 会新建 Session 并排入执行，不是普通 view-only handoff；重试也未证明幂等。
- 共享 phone drawer、safe area/真键盘/旋转、Host-authored approval 风险上下文、bounded artifact/diff 仍有缺口。先评估新版官方完整实现，不写平行替代。
- credentials-local 的 reconcile/dispose 存在源码推导的外部修改覆盖交错，与官方共享；没有确定性 paused-read regression，不应当作已实测或已修复。
- 完整威胁、安全扫描/SBOM、平台安装恢复、真实设备、签名/公证/更新链均未建立。

所有 Gate 0–4 保持未完成，`completeRc=false`。

## 7. 环境与浏览器安全约束

### Runtime

默认 Bash 的 `node` 实际是 22.22.1，不满足仓库要求；session 元信息所写版本不能作为依据。使用已安装的 Node24：

```sh
node --version
pnpm --version
```

pnpm 为 11.28.5；仓库要求 Node >=24.9。正确 Node24 仍可能输出 SQLite experimental warning，不要仅凭 warning 判定运行时错误。Java17 可用；Android wrapper 在 `apps/android` 下运行。没有可用的 Swift/macOS 本机 runner；当前 shell 没有 `gh`。

### 用户的强制操作边界

- **禁止主动启动、停止、杀死或改动 3000 服务。** 用户只允许测试使用 3001；确实需要时可用 3002，不能逐号加到 3003 等。
- 验证结束必须释放自己启动的 3001/3002 服务；只处理确实归本次会话所有的进程，不按未知 PID 或端口广杀。本次已知 Web 后台任务失败，最后 3001 连接拒绝；不能推断此后端口永远空闲。
- **禁止操作用户真实浏览器**：不得聚焦、切换、检查、关闭已有标签页，不得键鼠输入、SendKeys 或抢焦点。
- 只许 Qoder 内置浏览器，或 chrome-devtools MCP 新建的隔离浏览器/context。新页用 background，操作前确认是自己创建的页面；通用 skill 的“导航当前页”不能覆盖此边界。
- 需要登录时必须由用户完成，不 mock、不伪造登录、不绕过鉴权；工具拒绝令牌导航后不能换工具绕过。
- 不运行安装、镜像复制、快捷方式修改、签名或发布脚本来“顺便验证”。这些会影响真实环境，需要明确授权。
- 不 reset/clean/恢复整个目录，不清理未知未提交文件，不改 Git 配置，不提交或推送，除非用户明确要求。

## 8. 建议接手顺序

1. 阅读本手册第3节；核对 branch/HEAD、`git status --short` 和实际 diff，保留所有既有现场。不要重放旧任务或假定当前仍有服务器。
2. 阅读本次 `push-*.log`，区分已通过的定向测试与仍失败的全仓检查，再确定恢复开发的范围。
3. 阅读个人 main 与共享 profile 启动/初始化，修复全新 personal home 启动，补真实入口覆盖；保持官方 home 和现有文件不变。
4. 修正报告陈旧内容，再继续 source-owner 分类：当前 `IMPLEMENTATION_STATUS.md` 的 Desktop build 行仍写 rerun in progress，后文却已有 8/8 成功；inventory 的 official Desktop 项仍把“恢复顺序”列为待办。最后两条竞态和新 P1 尚未进入旧报告。
5. 补审第6节三个优先区域及其他未分类 owner，给出证据支持的 Adopt/Adapt/Keep/Migrate/Delete/Experimental；不能批量把 null 改成“已审查”来关账。
6. 在完整上游相关 consumer/Cordis 依赖背景下决定 adoption，不从未完成合并树直接拷贝实现或收据。若需要 merge/rebase，先独立确认用户授权与当前现场。
7. 针对实际修改选 focused checks。构建完成声明需要最新 build:artifacts 后的 build:check；prose/docs 走适用 pairing/gates；先前成功的检查无需无理由全重跑，但源码更新后失效的证据应补齐。
8. 浏览器验证在允许的隔离页面与 3001/3002 完成；若认证或环境阻塞，明确记录，不能把单元测试当真实 UI 验收。最后只关闭自己的服务。
9. 对未具备 Apple/设备/签名/发布资源的部分继续保留 BLOCKED/NOT_STARTED。完成审查不等于实现所有产品要求；任何“完成”声明必须明确范围。

## 9. 报告与上下文入口

十份既有审查产物如下；它们有第8节指出的陈旧内容，接手者必须结合当前源码和本手册使用：

- [UPSTREAM_BASELINE.md](UPSTREAM_BASELINE.md)：基线、worktree 与来源。
- [UPSTREAM_DELTA.json](UPSTREAM_DELTA.json)：机器路径差异和现场快照。
- [CUSTOM_CAPABILITY_INVENTORY.json](CUSTOM_CAPABILITY_INVENTORY.json)：能力组与未完成 owner 分类。
- [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md)：0–80 需求追踪与执行状态。
- [UPSTREAM_DELTA.md](UPSTREAM_DELTA.md)：架构 owner、新官方差异、保留缺陷。
- [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)：双薄壳许可与隔离约束。
- [COMPATIBILITY_MATRIX.md](COMPATIBILITY_MATRIX.md)：合同及兼容性证据缺口。
- [SECURITY_STATUS.md](SECURITY_STATUS.md)：安全发现与威胁矩阵缺口。
- [PLATFORM_VERIFICATION.md](PLATFORM_VERIFICATION.md)：平台、viewport/input/设备验收。
- [RELEASE_STATUS.md](RELEASE_STATUS.md)：Gate 0–4、completeRc=false。

完整会话归档由用户在仓库外保管。需要精确命令时按目标消息提取，归档中的认证资料继续保留在本地。

原四项大任务均未完成；本次 goal 未标 complete。不要把移交本身视为原始产品目标已实现。

## Dev Note

个人首次 profile 的源码与回归层已修复（见 3.2；安装态首跑验收仍待）；完整 owner 分类、平台与发布验收继续待办。
