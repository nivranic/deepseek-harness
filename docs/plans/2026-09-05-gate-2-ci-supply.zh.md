# Gate 2 CI 与供应链实施计划

[English](2026-09-05-gate-2-ci-supply.md) | 中文

> **面向 Claude：** 使用 `executing-plans` 逐项实施本计划。

**目标：** 从同一源码 SHA 生成可核验的候选证据，固定 workflow 依赖，并严格限定自动化权限。

**架构：** 扩展现有 CI 与包发布所有者。应用标识留在原所有者，以回执汇集平台产物，在候选晋级前拒绝缺失平台、标识不一致或字节变化。生产发布不属于此准备 workflow。

**技术栈：** TypeScript、js-yaml、Vitest、现有 GitHub Actions workflow、平台打包工具和标准 SBOM/provenance 格式。

---

## 范围与选定方案

本计划覆盖[交接文档](../../artifacts/verification/goal-mode-handoff-2026-09-05.md#82-gate-2--release-engineering-foundation) 中的 G2-CI 和 G2-SUPPLY。在 Windows、macOS、iOS、Android 打包所有者生成真实产物前，不声明 G2-RC 完成。继续使用现有 worktree 与 draft PR；不修改用户 dev checkout、vendor 源码、生产凭证或发布激活状态。

选定设计在现有所有者周围增加可检查策略与回执。第二套发布引擎会重复包与版本职责。仅有文档清单无法拒绝过期或缺失证据。固定可变版本 tag 仍有上游代码替换风险；完整 commit SHA 保留选定的 Action 字节。

GitHub 的[安全使用参考](https://docs.github.com/en/actions/reference/security/secure-use) 建议使用完整 Action SHA 和默认只读 token 权限，并按 job 增加必要权限。在各 Action 所属仓库核验 SHA。GitHub API attestation 作为独立受保护操作保留可选；portable receipt 必须在没有私有 GitHub 功能时仍可使用。

### 任务 1：固定并验证 workflow 依赖

**文件：** `.github/workflows/*.yml`、`release/action-pins.json`、`scripts/workflow-security.ts`、`scripts/workflow-security.spec.ts`、`scripts/verify-workflow-security.ts`、`scripts/run-gates.ts`、`scripts/run-gates.spec.ts`、`scripts/ci-workflow.spec.ts` 和 `package.json`。

1. 在所属仓库解析每个现有外部 Action 引用，保留请求的引用和核验后的 commit SHA。保留选定 Action major version 与本地 reusable workflow 路径。
2. 编写解析测试，拒绝短 SHA、可变 tag、缺失 permissions、`write-all` 和未登记的可写 job。仅通过已检查策略接纳本地 reusable workflow 与显式 job 权限。
3. 实现覆盖 workflow job 与 step `uses` 字段的 YAML 语义发现。拒绝空集合与畸形 workflow，将验证器接入执行中的 static/hygiene 聚合。
4. 把 Action tag 替换为已核验 SHA，并附可读版本注释。行为 workflow 测试按 Action 名称识别，不绑定版本；安全验证器拥有版本准入检查。
5. 运行聚焦 security/workflow/aggregate 测试、顶层验证器、lint 和文档检查。确认无效 fixture（测试前置数据）通过 CI 使用的同一入口被拒绝。

### 任务 2：明确 required-check 证据

**文件：** `scripts/release/ci-evidence.ts`、聚焦测试、`release/required-checks.generated.json` 和 `artifacts/verification/gate-2/G2-CI.json`。

1. 从现有 aggregate 的 `needs` 派生 mandatory CI job 集合，并显式加入独立 Apple 与 Android 验收 workflow。Windows coverage 和 observational 结果继续单独报告。
2. 只读查询 branch protection，不修改设置。无法访问时记录结果与精确的源码派生 required-check 清单；不得暗示 branch protection 已配置。
3. 解析 run/job 回执，拒绝缺失、跳过、取消、失败或来自不同源码的必要结果。pending 继续保持 pending。实际执行 PR merge SHA 时记录该 SHA 与 tree。
4. 执行拒绝及成功聚合 fixture，再收集当前候选的真实回执。祖先结果不替代已改变候选。

### 任务 3：添加依赖、静态安全与 secret 检查

**文件：** `.github/workflows/supply-chain.yml`、所属 workflow 旁的 scanner 配置、`scripts/workflow-security.spec.ts` 和 G2-SUPPLY 证据。

1. 通过受维护且固定版本的工具加入 dependency review 和 CodeQL/SAST，为每个 job 选择最小必要权限。在候选代码上运行，不使用生产凭证。
2. 对候选与待发布变化执行脱敏输出的 secret scanning。仅允许精确的已知 fixture 字面量或生成测试密钥；不得排除所有 fixture、所有测试或整个应用树。
3. 保留机器可读计数及 scanner/tool 版本。缺失 scanner、账号不支持或跳过扫描均不能产生 PASS。
4. 在候选上实际运行 scanner，并验证受控无效 fixture 失败且不发布其内容。审查发现项，修复真实缺陷后再接受检查。

### 任务 4：绑定候选产物、SBOM 与 provenance

**文件：** `scripts/release/rc-manifest.ts`、聚焦测试、`scripts/release/rc-artifacts.ts` 和 `release/rc-policy.json`。

1. 定义带版本的回执，包含源码 SHA、应用标识、平台/runtime class、相对产物路径、字节数、SHA-256、签名类别，以及 checks、SBOM、provenance 引用。要求平台集合与策略声明精确一致。
2. 拒绝绝对或逃逸路径、离开产物根目录的 symlink、重复平台、混合源码 SHA、标识不一致、不支持的 schema 版本、缺失文件及 checksum/size 不匹配。
3. 通过现有 build-advance 所有者比较上一已分发标识。仅当完整源码、标识与产物摘要均与保留候选一致时允许重试；渠道/版本改变属于新候选。
4. 使用受维护工具对每个实际打包依赖集合生成 SBOM，保留格式/版本和工具身份。生成绑定 builder identity、源码、调用、输入/输出摘要的 portable provenance；不把未签名 provenance 称为已认证 attestation。
5. 在隔离 fixture 中修改一个输出字节和一份回执标识，要求验证失败。验证完整四平台 fixture，并在打包所有者就绪时逐项验证真实产物。

### 任务 5：装配 unsigned RC workflow

**文件：** `.github/workflows/release-candidate.yml`、平台打包所有者、候选 manifest CLI 和 G2-RC 证据。

1. 要求完整不可变源码 SHA 和已声明标识，再针对该 SHA 运行源码检查及真实平台 producer。复用现有构建与启动机制，不生成占位平台产物。
2. 上传产物与回执，不执行生产签名或商店发布。把所有预期平台汇集到候选 manifest（元数据清单）；缺失 runner/toolchain 证据阻断 RC verdict。
3. 附加 checksum、SBOM、portable provenance 和不含业务内容的证据摘要。可选 GitHub attestation 使用独立最小权限 job，与不可信产物执行分离。
4. 平台 producer 就绪后才执行完整 dry-run。记录实际源码 SHA、job verdict 与产物标识；workflow 文件本身不是执行证据。

### 任务 6：记录并推送可审查候选

**文件：** `docs/development/` 下的双语参考、process Agent Note，以及 `artifacts/verification/gate-2/G2-CI.json` / `G2-SUPPLY.json` / `G2-RC.json`。

1. 命令与 schema 细节保留在所有者，交叉链接现有发布序列理由。准确记录必要检查、源码选择、权限例外、scanner 限制和人工生产步骤。
2. 运行适用聚焦测试、顶层检查、doc-sync、lint 和真实候选 workflow。正常提交、检查 hook 修改、推送并核对远端 SHA，PR 保持 draft 且 base=dev。
3. 将实际结果写入唯一交接文档。继续 G2 平台/支持/迁移/兼容/回滚工作及 Gate 3–4，不在本计划结束后标记整体目标完成。
