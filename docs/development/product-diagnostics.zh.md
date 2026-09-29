# 产品诊断记录

[English](product-diagnostics.md) | 中文

## Summary

产品诊断将固定错误类别与版本、构建号、源码提交、平台和运行时类别关联。[采集器](../../scripts/collect-product-diagnostics.ts)投影已有原生报告，不复制异常消息、路径、模块名、栈帧或业务内容。采集完整性与发布验收分别记录。

## Table of Contents

- [Collection](#collection)
- [Record format](#record-format)
- [Limitations](#limitations)
- [Dev Note](#dev-note)

-----

## Collection

Windows 在安装验收失败后采集记录。Mac Host 在原生测试区间产生崩溃报告结果时采集记录；缺少测试区间时不产生记录。两个工作流均要求准确且干净的候选 checkout，以及当前生成的[产品标识](product-release-identity.zh.md)。它们将 `product-diagnostics.json` 与原生报告一同保留在相应 artifact 中。

采集器要求 `--platform windows` 或 `--platform macos`、`--directory` 和正数 `--max-input-bytes`；工作流传入 4194304 字节。它通过[产物读取器](../../scripts/release/rc-files.ts)读取该平台的固定报告文件名，核验字节及元数据，并拒绝替换已有输出。生产者必须独占报告目录及其祖先目录，保持它们不被并发修改。采集失败输出不含被拒输入的固定消息及阶段：`arguments`、`source-metadata`、`source-clean`、`source-candidate`、`product-identity`、`product-freshness` 或 `native-report`。工作流保持失败；阶段标识失败的检查，不代表底层根因。

## Record format

[解析器](../../scripts/release/product-diagnostics.ts)定义 schema 版本 1。记录包含 `version`、`buildNumber`、`channel`、`sourceSha`、`platform`、`runtimeClass`、`status`、`collectionErrors` 和 `errors`。每条错误只含固定 `errorClass` 和正数 `count`；类别不能重复。缺失或多余的序列化字段、无效发布标识及矛盾的采集事实均失败。移动端记录不能声明 Full Host；ANR 仅属于 Android。

| Status | Required facts |
|---|---|
| `OBSERVED` | 已记录错误，没有已知采集失败 |
| `NO_REPORT` | 没有记录的错误或已知采集失败 |
| `UNAVAILABLE` | 没有记录的错误，采集失败 |
| `INCOMPLETE` | 采集失败，仍可能保留观测到的错误 |

原生适配器将报告汇总为 `native-crash`。格式也接受 `anr`、`startup`、`health`、`connection`、`protocol`、`storage`、`update` 和 `permission`，供相应生产者使用。Windows 未提供匹配的 Application Error 事件时，失败的安装器可以对应 `NO_REPORT`；安装失败仍未解决。

## Limitations

目前只接通 Windows 和 macOS 原生采集器。iOS、Android ANR 和运行时操作生产者尚未实现。这些记录不实现 Support Bundle、上传、保留策略或遥测同意流程。完整 Support Bundle 还需要获准的健康、连接、协议、角色、capability 和更新事实，以及 secret scan。源码字段属于关联元数据；产物摘要与 provenance 须独立验证。

## Dev Note

<details>
<summary>维护者工作上下文</summary>

无。

</details>
