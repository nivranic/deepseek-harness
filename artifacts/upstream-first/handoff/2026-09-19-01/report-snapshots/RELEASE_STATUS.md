# 发布状态

状态：NOT_STARTED。completeRc=false。

| Gate | 状态 | 未完成条件 |
|---|---|---|
| 0 Upstream Convergence | PASS | 129 个归属及 22 项未提交报告已处置；迁移任务已生成 |
| 1 Architecture/Contract | NOT_STARTED | Desktop 差异迁移、协议、错误与数据转换设计 |
| 2 Compatibility/Security | NOT_STARTED | 全语言 N/N-1 与安全矩阵 |
| 3 Platform/Native/Recovery | NOT_STARTED | 同候选真实平台和真机执行 |
| 4 RC | NOT_STARTED | 同 SHA、签名、公证、SBOM、provenance、更新和 support |

官方 Desktop 打包与更新代码采用 upstream；已制作本地 unsigned Windows NSIS 安装包并执行解包应用；未安装、发布、签名、公证或提交商店。后续发布只能晋级已取得完整回执的不可变产物。

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
