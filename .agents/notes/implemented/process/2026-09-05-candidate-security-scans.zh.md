# Agent Note: 绑定源码的安全扫描与精确非密钥例外

Status: implemented

[English](2026-09-05-candidate-security-scans.md) | 中文

## Problem

扫描器可能在检查错误 checkout、继承源码控制的忽略规则，或输出发现项却未使 job 失败后仍返回成功。宽泛的测试排除会隐藏合法公开向量旁的新凭据。原始报告可能把检测到的敏感内容复制到 CI artifact。

## Decision

[Workflow](../../../../.github/workflows/supply-chain.yml) 以只读权限检查不可变候选。Gitleaks 扫描完整候选 blob 与引入的历史。归档验证拒绝转换或遗漏的 blob；符号链接贡献链接文本。精确路径/行哈希/规则例外保留默认检测规则。翻译哈希必须针对发现项所在 commit 的实际 owner blob 完成证明。

每次 Gitleaks 调用都使用被忽略的放行注释旁的合成凭据证明检测与脱敏。CodeQL 要求四种应用语言完成分析，也保留 suppressed 发现项。已确认非问题项必须使用精确 selector，并将源码上下文固定为不可变 Git 对象；仅源码 suppression 不能授予准入。相关调用者与构建选择仍属于审查上下文，使新用途不能继承过时理由。依赖审查要求实际输出，并拒绝所有严重程度的漏洞。报告保留身份、计数和位置；命中文本与含源码的 SARIF 不进入发布 artifact。[参考文档](../../../../docs/development/security-scanning.zh.md) 拥有要求与覆盖限制。

## Alternatives considered

- 目录排除能减少误报，但会隐藏被排除源码中的未来凭据。
- 文本看起来像哈希不代表它不是密钥；核验 Git owner 可避免泛化的十六进制 allowlist。
- 原始 SARIF 和密钥报告提供更多上下文，但可能重新发布敏感源码或身份。
- Scanner 发现漏洞后可能有意以成功退出，因此进程成功无法建立干净 verdict。
- 仅固定行号的 SAST 例外会在调用者变化后继续生效，使原本有效的理由不再安全；上下文 identity 要求这些输入变化后重新审查。

## Consequences

密码学审查覆盖完整构造：Kotlin 中继使用 ChaCha20-Poly1305 AEAD，`ChaCha20` 只是其 JCA 密钥的算法标签。Noise 的零 nonce 前缀与每个密钥内唯一的计数器组合；新的方向密钥、串行交换与计数耗尽前拒绝必须同时成立。审查固定 Android tree 和分析 workflow，使调用者或 nonce 所有权变化时必须重新评估，而不能沿用算法名称例外。

修改 fixture 行或 SAST 上下文需要重新审查。不支持的平台、submodule、未完成分析、不可用的账号功能和缺失输出都会失败，不保留旧 PASS。即使全部发现项已审查，也不能覆盖提取错误。不含源码的 artifact 减少远端诊断细节；复现使用准确候选和 scanner revision。未签名回执补充 [CI 源码证据](2026-09-05-ci-source-evidence.zh.md) 和 [workflow 策略](2026-09-05-workflow-security.zh.md)。

回归覆盖归档转换、路径逃逸、例外变化、执行前 checksum、旧输出、suppressed 发现项和不完整报告。真实 Gitleaks negative fixture 验证已安装工具。实际语言分析和 dependency graph 执行仍是绑定候选的 CI 证据。原生 C/C++ 和 Rust 不在四语言矩阵内。[候选产物完整性](2026-09-06-candidate-artifact-integrity.zh.md)独立检查打包字节及未签名生产者声明。
