# 跨版本兼容状态

状态：IN_PROGRESS。候选基线：`c291e7961a515f6d7af9304e7fd1d257929aef26`。当前 API 代际为 2，支持请求协议 2/1；发现表示为 1，独立于 productVersion 和 Session writer=3。已完成同代发现/准入及未知 Host 代际的客户端拒绝测试；协议 2/1 应用协商和 Gateway 未知显式请求版本拒绝已验证；未知 Client 的专用升级界面与完整多版本实测矩阵仍未完成。

| Client / Host | 目标 | TS/Web | Desktop | Swift | Kotlin |
|---|---|---|---|---|---|
| N / N | Full | IN_PROGRESS | NOT_STARTED | NOT_STARTED | NOT_STARTED |
| N / N-1 | 协商子集 | IN_PROGRESS | NOT_STARTED | NOT_STARTED | NOT_STARTED |
| N-1 / N | 上一协议 | IN_PROGRESS | NOT_STARTED | NOT_STARTED | NOT_STARTED |
| N-2 / N | Diagnostics only | NOT_STARTED | NOT_STARTED | NOT_STARTED | NOT_STARTED |
| Unknown / N | 拒绝并提示升级 | IN_PROGRESS | NOT_STARTED | NOT_STARTED | NOT_STARTED |

三组 TS API bundle 真实 HTTP 测试已通过：2/2、2/1、1/2；选定协议分别为 2、1、1，覆盖 Goal 根与 scoped 写操作、事件就绪及公开类型。冻结输入为协议 1 API bundle，共享未变 workspace 依赖，不是完整历史版本安装包。真实 Web 的协议 2 协商时序已验证；其余业务与平台未完成。

旧 Kotlin/TS compatibility 回执绑定旧 SHA 和 Link Contract，不构成本候选证据。每格需记录客户端 SHA、Host SHA、协议版本、执行环境与结果。

规格依据：[按初始 SHA 恢复的原文](artifacts/upstream-first/original-specification.md)与[完整追踪记录](artifacts/upstream-first/specification-traceability.json)。追踪覆盖不替代逐项验收，未完成范围不因局部测试通过而缩减。
