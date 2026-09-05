# Agent Note: Session mention 与路径后缀的线性扫描

Status: implemented

[English](2026-09-06-linear-reference-path-scans.md) | 中文

## Problem

当 prompt 包含嵌套但未完成的 `@[` 前缀，或路径在长分隔符序列后带有普通文本时，未锚定的正则可能反复扫描同一后缀。Prompt 准入和 Workspace 展示同步执行，因此二次增长的工作量会延迟同线程的其他操作。

## Decision

[Session mention 发现](../../../../packages/context/session-reference/src/uri.ts) 为 Markdown 和裸 URI 起点分别维护向前游标。嵌套候选复用下一个标签和 URI 定界符。标签转义保留 Unicode code point 语义，格式不完整的 Markdown 仍允许相同的裸 URI 回退。URI 编解码和首次匹配顺序保持不变。

[Workspace 路径辅助函数](../../../../packages/util/workspace-path/src/index.ts) 用一次反向遍历移除末尾分隔符。理解 Windows 路径的调用方识别两种分隔符；POSIX 主目录缩写只识别 `/`。长输入不会被截断，也不会新增调用方限制。

## Alternatives considered

- 限制 prompt 或路径长度会改变接纳的输入，且不能消除限制以内的重复工作。
- 从标签中排除嵌套 marker 会改变规范 formatter 接纳的标签。
- 用另一个回溯表达式替代原表达式，仍会让失败成本取决于不成功的匹配尝试。显式游标让单调推进可以被审查，也无需增加正则引擎依赖。

## Consequences

Mention parser 使用显式定界符状态，同时保留优先级与线性发现。移除缓存前需要重新证明未完成的嵌套候选不会重复扫描同一后缀。路径辅助函数仍只处理字面值，不增加文件系统访问。

回归用例保留空标签、嵌套标签、Unicode 和行终止符转义、格式错误的引用异常与裸 URI 回退。长未完成 prompt 和内部长分隔符序列具有宽松的执行预算。针对已提交 parser 的 25,000 组对照检查文本、引用和错误等价性；聚焦覆盖率包含两个改动源码文件的全部分支。模型记录文本格式和运行时 composition 不变。
