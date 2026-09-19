# 安全状态

状态：IN_PROGRESS。官方 browser trust 的定向测试已执行，通过项包含在 [机器回执](artifacts/upstream-first/evidence.json)的 128 项测试中。

| 项目 | 状态 | 边界 |
|---|---|---|
| local Host/Origin 校验源码和定向测试 | PASS | 不表示远端身份验证已完成 |
| Pair nonce/expiry/replay、Role、Revoke | NOT_STARTED | 需接入新候选和 stream 生命周期 |
| OS secure store | NOT_STARTED | upstream 文件权限不替代安全存储 |
| Remote/Relay MITM、downgrade 威胁模型 | NOT_STARTED | 不放宽 local auth |
| Command risk/Approval 展示 | NOT_STARTED | Host 输出与执行策略统一 |
| SAST、SBOM、依赖/产物扫描 | NOT_STARTED | 安装时供应链策略检查不替代候选扫描 |
| Support/日志脱敏 | NOT_STARTED | 旧 scanner 需来源和新候选集成证明 |

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
