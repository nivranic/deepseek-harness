# Gate 2 产品版本标识实施计划

[English](2026-09-05-gate-2-product-identity.md) | 中文

> **面向 Claude：** 使用 `executing-plans` 逐项实施本计划。

**目标：** 为 Windows、Apple 和 Android 构建提供统一应用版本、构建序列与分发渠道，并用可执行检查拒绝漂移。

**架构：** 保留 workspace 根 manifest 作为应用 SemVer 的所有者。发布元数据只存储构建号与渠道，生成各平台表示，并在打包前验证每个消费者。Link protocol、contract 和 Session format 版本继续独立拥有。

**技术栈：** TypeScript、现有发布脚本、Vitest、Gradle properties、XcodeGen/xcconfig、electron-builder 和仓库文档检查。

---

## 范围与前置条件

本计划实施 G2-VERSION，以及 G2-CHANNEL 的标识与策略部分。[交接文档](../../artifacts/verification/goal-mode-handoff-2026-09-05.md#82-gate-2--release-engineering-foundation) 保留完整 Gate 2–4 范围。RC 产物、更新源、商店提交、签名和晋级仍由后续任务负责；创建本计划不代表通过任何发布门禁。

Gate 1 修复候选执行 CI 时可以开展准备工作。宣布进入下一阶段前，在 [Gate 1 证据](../../artifacts/verification/gate-1/gate1-evidence.json) 中记录实际结果。Apple 环境延期不豁免产品失败。所有工作保留在现有实施 worktree，保护用户的 `dev` checkout。

## 选定设计

使用 `package.json.version`，加上只包含 `schemaVersion`、`buildNumber` 和 `channel` 的 `release/product.json`。初始值沿用现有 SemVer，构建号为 `1`，渠道为 `dev`；引入机制时不创建发布 tag，也不递增产品版本。每个新的分发候选都递增构建号，包括渠道切换；相同候选重试时保留标识。

生成 `release/product.generated.json`、`apps/android/product-version.properties` 和 `apps/apple/Config/Product.xcconfig`。生成 JSON 包含完整 SemVer、数字 marketing version、构建号、各平台构建表示与渠道。后续 RC manifest 将此标识绑定到 source SHA 和产物摘要；把当前 commit 写入被提交的生成文件会形成自引用。

Windows 四段文件版本将每个分量限制为 `65535`；构建号采用相同上限。Apple 构建号按三段单调映射：`1 + floor(buildNumber / 10000)`、`floor(buildNumber / 100) % 100` 和 `buildNumber % 100`。Android 原样消费整数。因此构建号 `1` 映射为 Apple `1.0.1` 和 Windows `<major>.<minor>.<patch>.1`；写入任何输出前验证数字限制。

渠道选择分发策略和产物标识，不改变运行时 composition。`dev` 表示开发产物；`canary` 表示显式订阅的预发布；`beta` 只接受 `beta` 或 `rc` 预发布标识；`stable` 不接受预发布。晋级和上传保持禁用，直到相应受保护的发布 workflow 就绪。渠道选择不改变协议准入，也不启用产品 capability。

**替代方案：** 各平台手工版本会保留漂移，因此拒绝。由 Link protocol 派生应用版本会混淆发布节奏与互操作，因此拒绝。单靠 CI run number 无法从已提交输入重现候选，因此构建号必须显式记录；RC 验证必须与上一份已分发 manifest 比较。

### 任务 1：解析并生成标识

**文件：** 新建 `scripts/release/product-identity.ts`、`scripts/release/product-identity.spec.ts` 和 `release/product.json`。

1. 为当前应用版本、每个渠道、畸形元数据、未知字段、无效 SemVer、数字溢出、stable/beta 不匹配添加失败测试。覆盖 Apple 分量进位，并拒绝相对上一份已分发标识未递增的构建号。
2. 运行 `pnpm exec vitest run scripts/release/product-identity.spec.ts`，保留首次失败。
3. 实现纯解析器和生成器，在文件输入处严格验证。文件写入置于纯实现之外；写入前验证完整输出集合。
4. 运行聚焦测试；要求每个输出字节确定，且恰好有一个结尾换行。不要把协议常量加入输入文件。

### 任务 2：生成并验证平台输入

**文件：** 新建 `scripts/gen-product-identity.ts`、`scripts/verify-product-identity.ts`、`release/product.generated.json`、`apps/android/product-version.properties` 和 `apps/apple/Config/Product.xcconfig`；修改 `package.json` 和 `scripts/run-gates.ts`。

1. 添加 `gen-product-identity` 与 `verify-product-identity` 命令。验证器读取源码输入并比较所有预期生成字节；检查时不得修复过期文件。
2. 将验证器接入现有 static/hygiene 聚合。在所属门禁测试中添加聚焦的聚合成员断言。
3. 连续生成两次，第二次必须无差异。在隔离夹具中修改每个生成文件，要求验证器拒绝，包括原 Android `0.1.0` 漂移。

### 任务 3：连接实际消费者

**文件：** 修改 `apps/android/app/build.gradle.kts`、`apps/apple/project.yml` 和 `scripts/build-desktop-exe.ts`。

1. 加载生成的 Gradle properties，不使用兜底版本。所有 Apple 应用 target 通过生成的 xcconfig 配置 marketing/build version，并保留完整版本与渠道元数据。
2. staging 前验证 desktop manifest 与根标识一致。将派生文件构建版本与渠道元数据传入打包，保持发布关闭。
3. 执行 Android assembly 并检查生成包元数据。使用 macOS 车道检查解析后的 Xcode build settings，并构建全部应用 scheme。若产物工作尚未就绪，unsigned Windows 打包与安装 smoke 保留在 G2-WIN。

### 任务 4：保留版本递增所有权

**文件：** 修改 `scripts/release/bump.ts` 及其所属测试。

1. dsh bump 验证选定标识，改写根版本后生成 native 输出，并将输出纳入正常提交。vendor 序列不得修改产品元数据。
2. 扩展 dry-run 测试，证明没有文件写入或 Git mutation。无效的渠道/版本组合必须在修改 manifest 前失败。
3. 在隔离夹具中验证发布规划器；不要在本候选上执行真实版本递增、tag 或发布。

### 任务 5：文档与结果记录

**文件：** 在 `docs/development/` 下新增双语产品标识参考，更新受影响的 Apple/Android/desktop README 对，并在行为验证后向 `.agents/notes/implemented/architecture/` 添加已实施 Agent Note。

1. 保留独立 npm 发布序列的理由，并链接新的应用元数据决策；此项属于局部扩展，不替代 vendor/native 发布所有权。
2. 在 `artifacts/verification/gate-2/G2-VERSION.json` 与 `G2-CHANNEL.json` 中记录准确命令、源码输入、平台输出、失败和剩余打包限制。
3. 运行聚焦行为测试、生成漂移验证、相关构建、`test:docs`、`doc-sync` 和 lint。如实记录未执行的平台检查，不将其提升为 PASS。
4. 正常提交，检查 hook 修改，并按现有授权推送。PR 保持 draft，交接文档保留所有剩余 Gate 2–4 任务。
