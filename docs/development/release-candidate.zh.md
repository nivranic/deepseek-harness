# 发布候选完整性

[English](release-candidate.md) | 中文

## Summary

候选验证器将下载的应用产物与独立选定的提交、当前 checkout 的[产品标识](product-release-identity.zh.md)进行核对。完整清单必须包含 Windows、macOS、iOS 和 Android 回执。单个平台回执可以单独检查，但不构成完整发布候选验收。这两种操作均不授权发布。[Windows 生产者](windows-candidate.zh.md)负责该平台的安装、GUI 操作与打包目录扫描。

## Table of Contents

- [输入与命令](#inputs-and-commands)
- [产物与证据要求](#artifact-and-evidence-requirements)
- [信任与验证限制](#trust-and-verification-limits)
- [Dev Note](#dev-note)

-----

<a id="inputs-and-commands"></a>
## 输入与命令

使用包含预期产品标识和已审查 [RC 策略](../../release/rc-policy.json)的 checkout。独立于下载清单选定预期完整小写提交 SHA 和 Git 仓库 URI。[CLI](../../scripts/verify-rc-candidate.ts)接受以下选项：

| 选项 | 含义 |
|---|---|
| `--root` | 独占、已完成写入的产物目录 |
| `--manifest` 或 `--receipt` | 完整清单 JSON 或单个平台回执 JSON；必须二选一 |
| `--source-sha` | 预期完整源码提交 |
| `--source-repository` | provenance 中的预期 Git 仓库 URI |
| `--previous` | 可选的可信历史分发清单；仅与 `--manifest` 一起使用 |
| `--max-json-bytes` | 每份文档的正整数字节上限，默认为 33554432 |

使用这些选项调用 `pnpm run verify-rc-candidate`。成功时输出带有 `scope: candidate` 或 `scope: platform` 的 JSON 摘要；验证失败时返回非零退出码。命令不写 PASS 文件、不执行产物、不安装应用，也不发布。`pnpm run verify-rc-policy` 只检查策略，并在静态与 hygiene 聚合中执行；成功不代表任何产物通过验收。[CLI 回归](../../scripts/verify-rc-candidate.spec.ts)通过合成文件与修改单字节的拒绝用例执行两个入口。

没有 `--previous` 时，分发递增状态为 `not-checked`。提供该选项时，重试要求源码、完整产品标识及交付记录相同，包括路径、大小、摘要、运行时类别和签名类别。证据和执行元数据可以在自身验证通过后更新。其他候选必须跨版本、跨渠道增加构建号。调用方负责确认保留清单的真实性，以及它确实对应上一次分发。

-----

<a id="artifact-and-evidence-requirements"></a>
## 产物与证据要求

[元数据解析器](../../scripts/release/rc-manifest.ts)定义 schema version 1 和规范排序。策略要求每个受支持平台各有一份回执，并声明各平台的产物种类和运行时类别。`full` 表示 Host 分发；`companion` 表示可包含原生 Lite 功能的客户端分发。该分类不验证 Lite 功能。候选签名类别为 `unsigned` 和 `debug`。

文件引用采用所属平台目录下的 ASCII 相对路径，例如 `windows/installer.exe`。绝对路径、父目录跳转、Windows 设备名、保留字符、末尾点号或空格及大小写别名均被拒绝。所有文件包含正整数字节大小和 SHA-256。必填的 `attachments` 数组可为空，也可包含截图和诊断文件。[读取器](../../scripts/release/rc-files.ts)以流方式读取二进制文件、限制 JSON 大小、拒绝符号链接和硬链接，并在接受结果前检查已观察文件和目录是否被替换或修改。

每个命名检查为 JSON，包含 `schemaVersion: 1`、检查名称、源码 SHA、完整标识、平台、`status: PASS`，以及覆盖全部交付文件的 in-toto subjects。额外或不匹配的声明被拒绝。这验证的是记录中的声明；平台生产者仍负责实际测试标识与启动。

[证据验证器](../../scripts/release/rc-evidence.ts)使用固定版本的官方 CycloneDX 库及其 JSON schema 依赖校验 CycloneDX 1.6 SBOM。文档必须声明 1.6 版本、包含记录的扫描器名称和版本、标明扫描目标，并提供非空组件清单。其他 SBOM 格式被拒绝。生产者必须用持续维护的扫描工具扫描实际打包依赖集合；schema 有效的合成清单不等于真实扫描。

可移植 provenance 使用 in-toto Statement v1、SLSA provenance v1 和 build type `urn:dsh:release-candidate:v1`。subjects 绑定全部交付文件、检查、附件和 SBOM 摘要。external parameters 绑定源码 SHA、标识和平台；解析后的源码材料绑定独立选定的仓库 URI 与提交。run details 绑定回执中的构建者与执行标识。这些未签名声明不认证其作者。

-----

<a id="trust-and-verification-limits"></a>
## 信任与验证限制

调用方必须在验证及后续使用期间，阻止对产物目录、祖先目录和引用文件的并发写入或重命名。文件描述符检查与最终元数据复查能够发现已观察到的变动；可移植 Node 文件系统 API 不提供针对恶意并发写入者的沙箱。结果描述的是已验证字节，字节变化后结果即过期。

一致性不证明清单完整性、扫描器执行、构建者身份、签名、安装、启动、兼容性或回滚。被攻陷的生产者可以创建彼此一致的未签名声明。[源码安全扫描](security-scanning.zh.md)、可信 workflow 执行、真实平台验收和认证证明各有独立负责人。不得用测试夹具替代缺失的真实生产者来关闭 RC 验收。

-----

<a id="dev-note"></a>
## Dev Note

[产物完整性决策](../../.agents/notes/implemented/process/2026-09-06-candidate-artifact-integrity.zh.md)记录信任前提与重试策略。[实施计划](../plans/2026-09-05-gate-2-ci-supply.zh.md)跟踪真实平台生产者和候选 workflow 装配。
