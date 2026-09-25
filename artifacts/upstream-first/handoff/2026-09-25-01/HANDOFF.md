# DeepSeek Harness Upstream-First Agent 移交手册（2026-09-25-01）

移交编号：`2026-09-25-01`。编写日期：2026-09-25，时区 Asia/Hong_Kong。前次移交：`2026-09-19-01`（手册 SHA-256 `6538c89e07a07ab0b5bc695121796f87c3163c0636f4af3fb913e91c401f8686`）。接手时间：2026-09-19；交回时间：2026-09-25。机器采集事实以 [state.json](state.json) 为准。

本手册帮助下一位 Agent 接续同一个实施任务，并在以后交回时保留完整上下文。**当前实施目标按用户要求暂停，未完成，也未取消。** 本次只整理移交资料及做只读核验；没有继续产品实现。与上次移交最大的结构差异：**工作树已干净**——检查点 `965d0ac` 之后全部 79 个增量提交都已推送 origin，不存在未封存增量。

## 目录

- [1. 接手先读：状态与工作目录](#handoff-start)
- [2. 用户原始需求、常驻指令与授权范围](#original-request)
- [3. 移交文件与事实来源](#handoff-files)
- [4. 架构决定与流程机制（不可丢失）](#architecture)
- [5. 全部阶段状态](#phases)
- [6. 已完成工作的索引](#completed-work)
- [7. 最新已封存检查点](#sealed)
- [8. 当前未封存工作：无（下一增量只做了只读勘测）](#unsealed)
- [9. 验证证据与不能据此推断的结论](#validation)
- [10. 问题、解决方案与未解问题](#problems)
- [11. 恢复实施后的第一项任务](#resume-first)
- [12. 后续完整路线](#roadmap)
- [13. 环境、命令与运行约定](#commands)
- [14. 证据链、不可重复执行项与历史陷阱](#evidence-chain)
- [15. 同机、跨机器和上下文丢失时的移交](#transfer)
- [16. 接手验收清单与交给下一位 Agent 的提示词](#takeover)
- [17. 再次交回的协议](#handback)
- [18. 本次手册的核验范围](#manual-validation)
- [19. 完整原始需求附件](#full-spec)

<a id="handoff-start"></a>
## 1. 接手先读：状态与工作目录

| 项目 | 移交时事实 |
|---|---|
| 实施工作区 | `E:/Mix/project/deepseek-harness/.worktrees/upstream-first` |
| 实施分支 | `agents/upstream-first`，HEAD `5bd766f9114174e4d78760977391ec62104a7868` |
| 远端同步 | origin（`nivranic/deepseek-harness`）同 SHA；推送已 ls-remote 核验 |
| 工作树 | 干净；唯一 untracked 为 `.glm-router/` 遥测（永不入库） |
| 检查点起点 | `965d0ac`（2026-09-19，1,522 文件）；此后 79 个增量提交 |
| upstream 基线 | `c291e7961a515f6d7af9304e7fd1d257929aef26`（未刷新） |
| 最新已封存来源 | `artifacts/upstream-first/interrupted-transfer-source.json`，SHA-256 `243af43ad9065b0424afbfa90c0c26370e7968796d3db80751356f8458fae684` |
| 尚未封存的增量 | **无**。下一增量（§35 MIME 内容推断）只做了只读勘测，未写任何代码 |
| 来源记录总数 | 162 份（全部 git 跟踪、已推送）；结论链 133 项为真 |
| Session writer | V3；不得照用旧分支或旧会话中的 V0 规则 |
| 全局实施状态 | 未完成；goal 工具状态 `paused`，`completeRc=false` |
| 主工作区 | `E:/Mix/project/deepseek-harness`，分支 `dev`；两份 untracked 报告（`GOAL_PROGRESS_SUMMARY_2026-09-14.md`、`IMPLEMENTATION_VERIFICATION_V2.md`）原样保留 |

`.artifacts/` 被 gitignore：六门禁日志、151 份 before-归档清单、封存链 helper、性能改造脚本只存在于本机。来源记录绑定它们的哈希；跨机器必须整体复制 `.artifacts/`（见第 15 节）。

用户当前只要求暂停并移交。本手册的后续步骤不是自动恢复指令；当用户明确要求继续时，下一位 Agent 在第 2 节记录的授权范围内恢复实施，不必逐项再次确认。

<a id="original-request"></a>
## 2. 用户原始需求、常驻指令与授权范围

原始请求（2026-09-14 起）：`/goal 按照新的这份方案开始执行`，规格文件已恢复为 [任务原文](../../original-specification.md)（SHA-256 `4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80`，81 节，编号 0–80）。2026-09-19 按用户要求暂停并产生首份移交手册；同日由下一位 Agent 接手恢复。

恢复后的常驻指令（用户原话，属持续授权）：

> `/goal 完成后续所有任务，所有所有所有任务！注意是所有！没有完成严禁停下来！`

> “为什么又要我让你继续？你都知道有下一队列为什么不能自己做完？” / “不要我说一步你做一步啊，直接全做完不行吗？”

接手期间的追加指令与授权（按时间顺序）：

| 指令 | 效果 |
|---|---|
| push 授权 + “goal 模式每个绿里程碑自主 commit+push” | 每增量封存链完成后自主提交推送，仅计划性开放决策或范围变化才停 |
| 大批量提交“先全量检查再 `--no-verify`” | bulk 提交用 `--no-verify`；小提交保留钩子 |
| “e2e先不管” | e2e 通道不作为阻塞项（`DEEPSEEK_API_KEY_EXTERNAL` secret 缺失照实开放） |
| “你先解决下超时问题啊，老是等算怎么回事？”（2026-09-25） | 触发 write-reports 生成器性能修复（55 分钟→约 6 分钟，见第 10 节） |
| “handoff packages only on explicit user request” | 移交包仅在用户明确要求时生成；本次（“按这个要求移交”）即是明确要求 |

安全与凭据约束（逐字保留，继续适用）：never commit credentials；`git add -A -- . ':!.glm-router'` 排除遥测；GitHub token 经 `printf 'protocol=https\nhost=github.com\n\n' | git credential fill > .gh-cred.tmp` 读入工作区本地临时文件，用后立即删除；CI dispatch 用该 token 走 REST，期望 204。

仍然没有的授权：发布到 registry、迁移真实用户数据、修改系统自启动、清理旧工作区/历史证据、未经要求生成移交包。子 Agent 使用仍无授权。

<a id="handoff-files"></a>
## 3. 移交文件与事实来源

本文件是唯一移交入口。与上次不同，本次不再携带 patch/unsealed 清单（工作树干净、全部在 git 里）。

| 文件 | 用途 |
|---|---|
| [HANDOFF.md](HANDOFF.md) | 本手册 |
| [original-specification.md](original-specification.md) | 完整初始规格，字节与权威副本一致 |
| [state.json](state.json) | 暂停状态、HEAD/远端、封存断点、授权、环境 |
| [changes.json](changes.json) | `965d0ac..HEAD` 全部 79 个提交清单与工作树事实 |
| [evidence-index.json](evidence-index.json) | 记录/日志/归档清单与共享映射说明 |
| [report-snapshots/IMPLEMENTATION_STATUS.md](report-snapshots/IMPLEMENTATION_STATUS.md) | 截至移交的完整实施状态字节副本 |
| [report-snapshots/specification-traceability.json](report-snapshots/specification-traceability.json) | 截至移交的逐节追踪字节副本 |
| [manifest.json](manifest.json) | 本移交包文件 SHA 与大小 |
| [verification.json](verification.json) | 手册、原文、快照、JSON、LATEST 的核验结果 |
| [verify.mjs](verify.mjs) | 只读核验本移交包；`--live` 核对工作区当前状态 |

阅读顺序不变：用户最新指令 → 实施工作区规则与实际源码 → 当前来源记录/终态日志 → 机器报告 → 历史记录与本手册。恢复实施前先读实施树 [AGENTS.md](../../../../AGENTS.md)、[架构](../../../../docs/architecture.md)、[防御模式](../../../../docs/defensive-patterns.md)、[测试策略](../../../../docs/testing.md)。

<a id="architecture"></a>
## 4. 架构决定与流程机制（不可丢失）

产品架构决定沿用上次手册第 4 节全部条目（官方 Desktop 为主、Agent/Session 归 Host、单一 Gateway/Typert、三版本分离、Mobile 先做 Remote Companion、Handoff 先移查看位置、Device Trust 与 LAN 分离、local Web auth 保留、Session writer V3、六分类语义）。本节只记录接手期间新增、下一位必须知道的决定。

### 4.1 封存链机制（每增量，顺序固定）

六门禁日志落盘 `.artifacts/<key>-*.log`（tests/typecheck/lint/doc-sync 36/traceability 6/gate0）→ prepare（before-归档，`wx`，prior 记录 sha 断言）→ capture（源记录 `artifacts/upstream-first/<key>-source.json`，`wx`）→ advance（write-reports 克隆最新块插最前、历史映射前缀、evidence 翻转、`latestSourceRecord` 指针、markdown 新节、binding/validation 助手克隆）→ gen1 → rm 记录→重拍 v2（capturedAt 变化）→ sha 补丁进 write-reports → `node --check` → gen2 → binding 三篡改案例 → 最终日志刷新（audit-tests/gate0/diff-check）→ gen3 固定点（exit 0；evidence.json 跨代永不字节稳定属设计——自嵌前代哈希）→ validation receipt 最后钉（若钉后日志再变，rm 后重钉）→ 最终 audit 19 例 + `verify-audit --require-gate0` + `git diff --check` 空 → `git add -A -- . ':!.glm-router'` → commit（bulk 用 `--no-verify`）→ push（`git -c http.version=HTTP/1.1 -c http.postBuffer=157286400 push`，443 brownout 常见，用 ls-remote 权威核验重试；“Everything up-to-date” 在 sideband 失败后是误导行）→ CI dispatch（REST，期望 204）→ 记忆更新。

### 4.2 生成器性能修复（2026-09-25，用户指令驱动）

write-reports 曾是 O(记录×归档)：60 个逐记录历史映射各自重读全部归档（约 1800 万次文件哈希，每轮约 55 分钟）。修复后：**一个共享 `archivedInputs` 映射**枚举磁盘上全部 151 个 `.artifacts/*-before/archive.json` 清单构建一次，133 个 `xHistory` 常量别名到它；最新块保留自己的构建与一次性校验。每轮生成约 6 分钟（9 倍提速），全部 60 条记录断言原样通过。**陷阱：不能只取最新记录 historicalRecords 的 57 份清单**——历史链中途断过（android-contract-before 不在其中），逐记录映射正是靠各自清单补齐键空间。改造脚本在 `.artifacts/alias-history-maps.py` 与 `.artifacts/share-archive-map.py`；**每次 advance 之后必须重跑别名化**（新块插最前、其余全部别名）。

### 4.3 advance 的三个致命锚点

1. 插入 write-reports 模板字面量的段落**禁止含反引号**（裸 `` ` `` 会终止模板，`node --check` 可捕获）。
2. 第 3 步历史前缀正则的切片起点必须是**前一最新块名**（例：上一轮是 `const rosterUiPath =`，写错成更旧的块名会让次新块的校验漏改、gen 在 IMPLEMENTATION_STATUS 钉住处失败）。
3. 克隆 binding/validation 助手后：篡改案例路径换成当增量自己的文件；validation 助手的 audit 断言数（现为 `/# pass 19/`）必须与实际一致；binding spawnSync timeout 需 600_000（57 份归档校验超过 120 秒）。

### 4.4 capture 的 changed 过滤

工作树存在 CRLF/LF 字节漂移（git 视角干净、字节层面不同）。capture 助手先落 `.git-dirty.txt`（`git status --porcelain` 路径交集），过滤时保留 `.artifacts/`、`artifacts/`、`/lib/`、`/build/` 排除——否则记录会钉住噪声或自钉生成产物。

### 4.5 产品侧新增接缝（本弧 37 增量的架构要点）

- §28 名册链：retargetable-endpoint（`createWebConnectionRpc` 第 4 参 `resolveBaseUrl` + `ConnectionHandle.targetOrigin()/retarget()`）→ roster-switch（`switchToSavedHost` 组合 + Gateway 流载体 `remoteStreamUrl(resolveBaseUrl)` 采纳）→ roster-ui（`ui-settings-hosts` settings 区 + `browserSelectedHostPersistence` 启动期应用选中）。
- §35 呈现链：binary-fact-card（32 后缀事实卡）→ interrupted-transfer（`workspace-files.read-bytes.v1` 时 1 MiB 窗口化 + 前缀保留续传 + 版本重启 + 契约破坏大声失败）。
- 客户端 UI 新包机制全清单已固化在记忆与各 record（tsconfig 两处、bundle 两文件、三 catalog、css-modules.d.ts、settings.section 注册形态、README 模板含 H3 Dev Note）。

<a id="phases"></a>
## 5. 全部阶段状态

以 [report-snapshots/IMPLEMENTATION_STATUS.md](report-snapshots/IMPLEMENTATION_STATUS.md) 的 Phase 表为准（字节快照）。移交时：Phase 0/1 PASS；2/3/4 IN_PROGRESS；5–9 NOT_STARTED（但中段能力增量大量落地，见第 6 节——Phase 表是验收视角，不是工作量视角）；10 已提前开工授权下推进（Android 迁移/契约列/拒绝通道等）；11 DEFERRED；12 IN_PROGRESS（`completeRc=false`）。Gate 0 PASS；Gate 1–4 未通过。

<a id="completed-work"></a>
## 6. 已完成工作的索引

上次手册第 6 节的系统级索引仍适用，其上累计：本弧新增 37 个已封存增量（evidence.json `conclusions` 133 项为真），全部有 source record + binding + validation 回执 + 已推送提交。逐增量细节的权威入口：

- 每增量：`artifacts/upstream-first/<key>-source.json`（scope/conclusions/limitations/nextRequiredWork）+ 同名 `-binding.json` / `-report-validation.json` + 六门禁日志 `.artifacts/<key>-*.log`。
- 汇总：`IMPLEMENTATION_STATUS.md`（每增量一节，中文，当前/历史翻转）+ `evidence.json`（机器回执）+ `specification-traceability.json`（81 节逐行映射）。
- 本弧最后 6 个增量（最新在前）：interrupted-transfer、roster-ui、roster-switch、retargetable-endpoint、binary-fact-card、unified-diff-preview。

不要跨增量累计测试数；每记录的 `checks[0].command` 写明当轮套件与数字。

<a id="sealed"></a>
## 7. 最新已封存检查点

```text
artifacts/upstream-first/interrupted-transfer-source.json
SHA256 243af43ad9065b0424afbfa90c0c26370e7968796d3db80751356f8458fae684
commit 5bd766f9114174e4d78760977391ec62104a7868（已推送）
```

[验证回执](../../interrupted-transfer-report-validation.json) PASS（限定报告绑定、路径覆盖与一致性）。`evidence.json.latestSourceRecord` 指向该记录；gate0 PASS（paths 1938、components 129）；audit 19/19；`git diff --check` 空。固定点经 gen3 exit 0 确认。

<a id="unsealed"></a>
## 8. 当前未封存工作：无（下一增量只做了只读勘测）

工作树干净、无半途封存链、无未跑完的 helper。下一增量 **mime-inference**（§35 余项：未知扩展名内容推断）已被用户叫停前做过只读勘测，零代码。勘测结论（供直接开工）：

- `ImageBody` 经 `imageMediaType(path)` 从路径后缀推 Blob 类型；`DocumentContent` 的 bytes 变体（`document/contract.ts`）不携带 mediaType 通道——内容路由需要 bytes 变体增可选 `mediaType`，由 seat 在按内容选中时传入。
- 设计草案：纯函数魔数嗅探（PNG/JPEG/GIF/WEBP/BMP/ICO→IMAGE_BODY_ID；`PK` 族→BINARY_BODY_ID；其余 undefined）；face 增 `sniff`（readBytes 头 64 字节，仅 `workspace-files.read-bytes.v1` 能力存在且无扩展名匹配时）；store 增 `sniff` 完成态；seat 把嗅探结果排在纯文本兜底之上、用户显式选择之下；reset/mode 切换清嗅探；失败按“已完成无匹配”处理避免重触发循环。
- 封存链 prior = interrupted-transfer（`243af43a…`），锚点：块 `const interruptedTransferPath =`、evidence 翻转 `evidence.interruptedTransfer = { status: 'PASS',`、markdown 标题 `## 完整字节中断传输恢复矩阵（§35）`。

<a id="validation"></a>
## 9. 验证证据与不能据此推断的结论

最新增量（interrupted-transfer）六门禁终态：tests 313/313（documentpreview 全套，排除 Windows 受阻的 pdf-license-bundle）、typecheck 0、lint 0/0、doc-sync 36/36、traceability 6/6、gate0 PASS；audit 19/19；binding 3/3 篡改拒绝；生成器三轮固定点；gen 计时 55 分钟→4–6 分钟（性能修复前后对照）。日志在 `.artifacts/interrupted-transfer-*.log`。

已知本机（Windows）环境类失败，属既有基线、非回归，由 Linux CI 仲裁：workspace-files symlink EPERM 语料、pdf-license-bundle（`pnpm pack` 子进程）、subprocess/pwsh/LSP specs、个别 workspace-controller transport 时序。历史全量基线 21,544 passed / 100 failed / 88 skipped（快照时点，勿跨时点比较）。

不能据此推断：keyless 单测/门禁绿不等于真机矩阵；CI 的 E2E job 因 `DEEPSEEK_API_KEY_EXTERNAL` 缺失而失败是已知反假绿预检（用户已裁定先不管）；固定点 exit 0 不要求 evidence.json 字节稳定（自嵌前代哈希，receipt 钉最终态）。

<a id="problems"></a>
## 10. 问题、解决方案与未解问题

| 问题 | 处置与结果 | 接手注意 |
|---|---|---|
| write-reports 每轮 55 分钟（O(记录×归档)） | 共享 `archivedInputs` 映射（全部 151 清单）+ 133 别名；9 倍提速 | advance 后必须重跑 `.artifacts/alias-history-maps.py`；不可只取最新记录的 57 份清单 |
| advance 插入段含反引号 → write-reports 语法崩 | 模板段落一律纯文本提及 | `node --check` 可捕获；先 check 再 gen |
| advance 切片锚写错旧块名 → 次新块校验漏改 | 锚必须为前一最新块名；gen 在 IMPLEMENTATION_STATUS 钉住处失败即此症状 | 修复需 `git checkout HEAD -- write-reports.mjs` 后重跑 advance |
| binding 案例 3 超时崩溃（status null） | 归档校验超 120 秒；timeout 提至 600_000 | 每增量克隆助手后检查该值 |
| audit 断言数随记录增长（13→19） | validation 助手断言改为实际值 | 新增量后先跑 audit 再钉 receipt |
| CRLF/LF 字节漂移污染 capture | `.git-dirty.txt` 交集 + 目录排除 | heredoc 会吃反斜杠，脚本一律落文件执行 |
| push 443 brownout / sideband 断连 | `http.version=HTTP/1.1` + 大 postBuffer + ls-remote 权威循环 | “Everything up-to-date” 不可信；dispatch 前必 ls-remote |
| zh README 双语门禁连环（锚/Dev Note H3/短式 Model Experience） | 模板固化在记忆与 roster-ui record | 新包 README 直接照 devices/hosts 模板 |
| oxlint 常见拒绝 | `as Storage` 冗余断言、getByText 强转（用 `getByRole<T>()`）、void 表达式、max-len 140 | 先 lint 后再跑测试省时 |

未解/开放（无环境不臆断）：四平台同候选真机实测；iOS 客户端采用；跨版本 interop（待真实发布版本）；macOS/物理设备/签名/方向矩阵硬件硬阻塞；`DEEPSEEK_API_KEY_EXTERNAL`；Windows 已安装插件路径失败（旧遗留）。

<a id="resume-first"></a>
## 11. 恢复实施后的第一项任务

用户明确要求继续后：

1. 进同一工作区，核对 HEAD=`5bd766f911`、远端同步、`latestSourceRecord`、`.artifacts/` 在位（151 清单）。
2. 实现 mime-inference（第 8 节勘测与草案；纯函数 + face sniff + store + seat 路由 + content.mediaType + 测试 + README 双语 + §35 追溯行 + IMPLEMENTATION_STATUS 新节）。
3. 六门禁 → 封存链（第 4.1/4.3/4.4 节；advance 后重跑别名化）→ 自主 commit+push → CI dispatch → 记忆更新（THIRTY-EIGHT 起）。
4. 之后按第 12 节队列继续，不停止（常驻指令）。

完成条件不变：source → archive/history → generator → reports → binding/audit → validation 回执一致链 + 推送核验。

<a id="roadmap"></a>
## 12. 后续完整路线

队列（最新记录 `nextRequiredWork`，顺序即优先级）：§35 余项（MIME 内容推断 + 同候选真机）；§28 余项（选择读取器轮询→观察、跨源配对提示、名册排序编辑）；§10 溢出菜单（⋮，等工具栏集合）；§34 余项（语法高亮/split diff/大文件虚拟化/copy/open-file）；provider/relay/device-trust/crash telemetry 出口随生产者接线；四平台真机；iOS 采用；跨版本 interop；硬件硬阻塞项如实开放。Phase 级路线仍以上次手册第 12 节（B–O）为准，Phase 表状态见第 5 节。

<a id="commands"></a>
## 13. 环境、命令与运行约定

环境：Node v22.22.1、pnpm 11.7.0、Windows（Git Bash）。PowerShell 一律 pwsh 7。bash heredoc 吃反斜杠（脚本落文件）；用 `git grep` 不用 `grep -r`（junction 环回）。长生成命令后台跑 + 轮询（现约 6 分钟）。

关键入口（全部沿用并已验证）：六门禁与测试命令见各 record 的 checks；封存链 helper 命名 `<动作>-<key>.mjs`；`.git-dirty.txt` 由 `git status --porcelain | sed -E 's/^...//' | sed 's/"//g' | grep -v "^\.glm-router"` 生成、capture 后即删；doc-sync 环境变量注入同上次手册 13.3；审计 `node --test artifacts/upstream-first/{specification-traceability,verify-audit}.test.mjs`（19 例）+ `node artifacts/upstream-first/verify-audit.mjs --require-gate0`；push/CI dispatch 见第 2 节与 4.1。主 dev 工作区两份报告继续保护。

<a id="evidence-chain"></a>
## 14. 证据链、不可重复执行项与历史陷阱

- 已成功的 `wx` helper（prepare/capture/advance/binding/validation 及各一次性脚本）**不重跑**；新增量用新 key 新目录。
- `write-reports.mjs` 的共享 `archivedInputs` 映射与 133 别名**不可删除或改回逐记录构建**；别名化脚本随 advance 重跑。
- 历史 fallback（`errorCodeSchemaHistory`、`archivedSources`、`archivedBuilds` 等链尾）保留；current 匹配当前源码、historical 匹配当时归档，不可互换消除断言失败。
- receipt 最后钉；binding.json 在生成器变更后 rm 重钉（本次已按此执行）。
- 旧 `*-source.json`/validation/归档 note 历史不可改；新结论由新记录引用旧记录。
- 不运行仓库 clean 或递归清理 `.artifacts/`。

<a id="transfer"></a>
## 15. 同机、跨机器和上下文丢失时的移交

**同机**：直接把本手册绝对路径交给新 Agent，进入同一 worktree。工作树干净、分支与 origin 同步，无需搬运。

**跨机器**：git 侧完整——clone `nivranic/deepseek-harness`、checkout `agents/upstream-first@5bd766f911` 即得全部 162 份记录与报告。但必须另复制 `.artifacts/`（gitignored：日志、151 份 before-归档、helper、性能脚本——记录绑定其哈希，缺失则生成器与门禁断言失败）。复制后跑一次 `node artifacts/upstream-first/write-reports.mjs`（约 6 分钟，exit 0）验证链完整。凭据/`.env`/用户 home 不入包。

**上下文丢失**：读本目录与 `handoff/LATEST.json`，核对当前源码与封存点，勿因摘要完整而重跑独占 helper。

<a id="takeover"></a>
## 16. 接手验收清单与提示词

- [ ] 确认用户要求的是继续实施还是只读理解；goal 已暂停。
- [ ] HEAD `5bd766f911` 与 origin 一致；工作树净（仅 `.glm-router/` untracked）。
- [ ] `latestSourceRecord` = interrupted-transfer；sha `243af43a…`。
- [ ] `.artifacts/` 151 份清单在位；write-reports 含共享 `archivedInputs`。
- [ ] 读第 4 节机制（尤其 4.2–4.4）与第 8 节勘测。
- [ ] 无未封存增量；勿重跑任何 `wx` helper。
- [ ] 授权边界清楚（第 2 节）；安全约束逐字保留。

继续实施提示词：

```text
请接手并继续本任务。先完整阅读：
E:/Mix/project/deepseek-harness/.worktrees/upstream-first/artifacts/upstream-first/handoff/2026-09-25-01/HANDOFF.md

原始目标是按 Upstream-First 完整规格（81 节，SHA 4f313ad5…）执行 Phase 0–12。前一位 Agent 因用户移交而暂停；这条“接手并继续”是恢复本地实施的指令。

只在 E:/Mix/project/deepseek-harness/.worktrees/upstream-first、agents/upstream-first 工作。工作树干净、79 个增量提交已在 origin；最新封存点 interrupted-transfer（243af43a…），无未封存增量。按手册第 11 节从 mime-inference 开始，机制按第 4 节（advance 后重跑别名化脚本；binding timeout 600s；audit 断言 19）。goal 模式常驻指令“完成所有任务不停”与既有授权（绿里程碑自主 commit+push、bulk --no-verify、e2e 先不管）继续适用；.glm-router 永不入库；凭据约束见手册第 2 节。

严格区分局部源码/真实隔离 HTTP/录制模型/真实平台证据；未完成不标完成。下次移交按第 17 节协议生成新编号手册并更新 LATEST.json。
```

只读评估则去掉“接手并继续”与授权句。

<a id="handback"></a>
## 17. 再次交回的协议

沿用 2026-09-19-01 手册第 17 节协议全文：每次移交新建 `artifacts/upstream-first/handoff/YYYY-MM-DD-NN/`，记录 `predecessorHandoff` 与前份手册 SHA、接手/交回时间与基线、相对上次的全部变更；旧目录冻结；更新 [LATEST.json](../LATEST.json)；必填字段按其 17.2 表；模板按其 17.3；交回提示词按其 17.4 形式改指向本手册。原规格字节副本每包必带。本次包的前份手册 SHA 见本手册开头。

<a id="manual-validation"></a>
## 18. 本次手册的核验范围

本次重新核验了 goal 状态、工作区/远端 Git 状态、主目录保护文件、原文 SHA、LATEST 指针与前份手册 SHA、最新记录 sha 与回执、evidence.json 指针、gate0 输出、审计 19/19、生成器共享映射在位、`.artifacts/` 清单计数（151）、79 提交清单，并保存 IMPLEMENTATION_STATUS 与 specification-traceability 字节快照。核验只读，未重跑产品测试、未动封存链、未改生成报告。详细结果见 [verification.json](verification.json)；`verify.mjs --live` 可在当前工作区复跑。

<a id="full-spec"></a>
## 19. 完整原始需求附件

[完整原文](original-specification.md)，81 节编号 0–80 含结尾总原则，SHA-256 `4f313ad5a779b497e239654bc6cb3734dbe32210c72adf11286637606f764e80`，与任务权威副本逐字节一致。本手册不替代原文细项；按 [逐节追踪快照](report-snapshots/specification-traceability.json) 定位每项 owner 与剩余工作。
