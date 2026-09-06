# Windows 候选生产

[English](windows-candidate.md) | 中文

## Summary

[Windows workflow](../../.github/workflows/windows-candidate.yml) 从明确的同一源码提交构建未签名安装器与 portable 应用。它安装候选、操作两种应用启动器、扫描打包目录，并在上传前验证[平台回执](release-candidate.zh.md)。该 workflow 不验收其余三个平台，也不发布生产版本。

## Table of Contents

- [源码与执行](#source-and-execution)
- [安装与 GUI 检查](#installation-and-gui-checks)
- [打包清单与证据](#packaged-inventory-and-evidence)
- [限制](#limitations)
- [Dev Note](#dev-note)

-----

<a id="source-and-execution"></a>
## 源码与执行

修改已声明输入的 pull request 使用完整 head SHA 执行 workflow。复用调用和手动 dispatch 必须提供 `source_sha`；手动 dispatch 仍受 GitHub 默认分支可用性规则约束。源码验证先于 checkout，生产前再次比较实际 checkout SHA。完整 Action revision、禁用 checkout 凭据保留和 `contents: read` 遵循仓库 [workflow 策略](workflow-security.zh.md)及 GitHub [安全使用参考](https://docs.github.com/en/actions/reference/security/secure-use)。

作业在一次性的 `windows-2025` runner 上使用原生 PowerShell。它安装锁定依赖、检查生成的产品标识、运行 SBOM 回归、构建官方客户端，并调用[现有打包器](../../scripts/build-desktop-exe.ts)。Electron 和 builder 从上游 GitHub release 下载。打包保持未签名并禁用发布。

[生产者](../../scripts/produce-windows-candidate.ts)要求在 `RUNNER_TEMP` 下新建输出目录，并为安装和应用状态创建另一个唯一运行目录。托管 runner 标记用于防止在开发者机器上误执行；它不认证故意伪造环境变量的调用方。不得在持久化自托管 runner 上运行该生产者。

-----

<a id="installation-and-gui-checks"></a>
## 安装与 GUI 检查

NSIS 候选为当前临时 runner 用户静默安装到本次运行目录。生产者比较已安装主程序与解包主程序的字节；[Windows 元数据检查](../../scripts/release/verify-windows-product.ps1)核对安装器、portable 启动器、解包主程序和已安装主程序的字符串版本、数字版本及 `NotSigned`。文件引用必须互不重复。

[Playwright Electron 驱动](../../scripts/release/windows-smoke.ts)分别启动已安装可执行文件和实际 portable 启动器。每次启动使用全新的 Harness 与应用数据目录，移除名称涉及凭据的环境变量和开发启动钩子。驱动通过真实首次提示继续，选择稍后配置凭据，打开设置、选择模型并打开提供方表单，不保存凭据，也不调用模型。

驱动截取已渲染的提供方表单、检查未捕获页面错误、记录运行中应用版本，并在 portable 清理前计算实际执行文件的哈希。两种运行中主程序均必须与打包主程序一致。正常应用关闭和进程退出都必须完成，退出码须为零；失败清理只终止该次启动拥有的进程树。PNG 大小阈值不用于授予启动验收。

-----

<a id="packaged-inventory-and-evidence"></a>
## 打包清单与证据

[SBOM 生产者](../../scripts/release/sbom.py)从[扫描器 registry](../../.github/security/scanners.json)下载固定 Syft 归档，先验证 SHA-256 再提取或执行，并检查二进制版本。显式配置禁用更新检查，外部 Syft 配置被移除。CycloneDX 1.6 输出使用 `image` cataloger 集，因为输入是已安装依赖；默认目录 cataloger 会遗漏已安装 npm 包。

npm 审计遍历实际打包应用目录，遇到不可读目录或链接就失败，并将每个具名包及可用的名称/版本对与生成 SBOM 比较。仅包含模块元数据的 manifest 不算包。无版本号的具名 manifest 仍会计数，并且必须按名称出现在 SBOM 中。Windows 扩展路径保证较长部署路径也被覆盖。清单为空或遗漏包时，必须在生成工具回执前失败。

最终平台回执绑定安装器和 portable 文件、命名 PASS 检查、标准 SBOM、截图及观测元数据附件。可移植 SLSA provenance 指明源码仓库、提交、构建者和 workflow 执行，并绑定全部引用文件摘要。公共验证器再次读取所有引用字节后，生产者才写入 `windows/receipt.json`。上传仅在生产成功后运行；artifact 名称包含源码 SHA、run ID 和 attempt，保留七天。

-----

<a id="limitations"></a>
## 限制

合成回归测试不证明安装器或 GUI 成功；只有真实候选 workflow 才能提供此类证据。npm 比较证明相对于已交付 manifest 的覆盖，不证明缺少 manifest 的打包代码依赖或缺失的许可证元数据。此 workflow 检查全新安装和无密钥 GUI 配置，不验证升级、回滚、模型执行、生产签名或商店分发。未签名 provenance 不认证构建者，单个 Windows 回执也不构成完整四平台 RC。

-----

<a id="dev-note"></a>
## Dev Note

[候选完整性决策](../../.agents/notes/implemented/process/2026-09-06-candidate-artifact-integrity.zh.md)负责信任与证据语义。[产品标识参考](product-release-identity.zh.md)负责平台版本表示。
