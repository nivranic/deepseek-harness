# 架构决定状态

状态：IN_PROGRESS。采用官方源码基线的决策与取舍见 [Agent Note](.agents/notes/proposed/architecture/2026-09-14-upstream-first-convergence.zh.md)。各能力归属与迁移状态只在 [能力清单](CUSTOM_CAPABILITY_INVENTORY.json)维护。

已选方向：单一官方 Desktop、Host 权威 Session/Interaction、官方 Typert 和 Connection、共享 Web UI、薄 Native Companion。已有协议 2/1 的定向 TS HTTP 协商证据，范围见 [兼容矩阵](COMPATIBILITY_MATRIX.md)。尚未完成：Session/Host settings 完整旧数据转换、四角色授权映射、完整多版本/多语言兼容矩阵，以及统一 mutation identity/回执语义。

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
