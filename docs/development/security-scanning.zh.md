# 候选安全扫描

[English](security-scanning.md) | 中文

## Summary

[供应链 workflow](../../.github/workflows/supply-chain.yml) 以只读权限扫描不可变 PR head。密钥检测、依赖审查和四个 CodeQL 语言 job 必须全部成功。发现项或未完成的扫描会阻断聚合 verdict。

## Table of Contents

- [密钥扫描](#secret-scanning)
- [依赖与静态分析](#dependency-and-static-analysis)
- [证据与限制](#evidence-and-limitations)
- [Dev Note](#dev-note)

-----

<a id="secret-scanning"></a>
## 密钥扫描

[scan-secrets.py](../../scripts/scan-secrets.py) 要求 Python 3.10+、Git、tracked 内容干净且与候选 tree 相同的 checkout，以及祖先 base commit。`--candidate`、`--base` 和 `--output` 选择完整 commit SHA 与 verdict 文件。扫描器从候选的[登记表](../../.github/security/scanners.json) 安装 Linux 或 Windows x64 归档，在执行前验证 SHA-256，并确认可执行文件版本。未登记平台会失败。

完整候选 tree 和 base 到候选 commit 范围的新增行是两个独立输入。导出文件必须与每个 Git blob 的字节一致；遗漏或替换都会失败。符号链接仅贡献链接文本，不跟随目标。未跟踪文件（包括本地凭据）不在输入范围内。Submodule 需要独立固定的扫描输入，当前会失败。

Gitleaks 使用默认规则并对报告脱敏。源码放行注释和忽略文件不能禁用检测。每次调用先证明真实可执行文件能拒绝放行注释旁的合成凭据，并隐藏该值。自检失败会阻断扫描。

[例外](../../.github/security/secret-exceptions.json) 匹配精确路径、完整行的 SHA-256 和 rule ID，仅用于已审查的公开向量、隐私 canary、无效测试输入和类型声明。行或规则变化后仍是发现项。翻译记录仅在完整 Markdown owner 字段等于发现项所在 commit 上该 owner 的 Git blob identity 时单独分类。多行命中没有例外。

-----

<a id="dependency-and-static-analysis"></a>
## 依赖与静态分析

依赖审查通过 GitHub dependency graph 比较显式 base 与候选。runtime、development 或 unknown scope 中任何严重程度的漏洞都会失败。许可证批准不属于此检查。输出缺失或账号功能不可用都不会产生准入；成功的空 diff 合法。Job 不发布 PR 评论。

CodeQL 为 JavaScript/TypeScript、Python、Java/Kotlin 和 Swift 执行 `security-extended` 查询。Kotlin 编译包含 core 和 Android app。Swift 编译包含 SwiftPM 和全部三个 Apple app scheme。这些 job 不构成原生 C/C++ 或 Rust 分析证据。构建或提取失败会阻断对应语言 job。

[security-evidence.py](../../scripts/security-evidence.py) 要求 analyzer outcome 成功，且 SARIF 含工具身份、driver 与 extensions 中的非空规则集、成功 invocation 和显式 results。包括已 suppression 的发现项都会失败；分析通知中的 warning/error 也会失败，并同时保留诊断 ID 与发现项。不上传含源码的 SARIF 和 CodeQL database。被拒绝的规则元数据只记录结构计数用于诊断。

-----

<a id="evidence-and-limitations"></a>
## 证据与限制

Artifact 保留候选/tree identity、scanner revision 或归档摘要、计数与发现项位置，不含命中文本、源码片段、作者身份或凭据。错误会用 FAIL 替换旧 PASS 文件。Run/attempt artifact 名称标识 producer。回执仍是未签名观察记录；[CI collector](workflow-security.zh.md#candidate-source-evidence) 为其必要 workflow 独立核验 GitHub 和源码数据。

密钥扫描没有宽泛的测试目录排除。CodeQL 覆盖已提取的应用语言；依赖审查覆盖 GitHub dependency graph 能识别的变化。这些检查不证明所有漏洞均不存在，不生成 SBOM，不授权发布，也不替代平台发布验收。聚合没有跳过 scanner 仍成功的路径。

-----

<a id="dev-note"></a>
## Dev Note

[决策](../../.agents/notes/implemented/process/2026-09-05-candidate-security-scans.zh.md) 拥有例外与证据取舍。[Workflow 策略](workflow-security.zh.md) 拥有 Action pins 与权限。
