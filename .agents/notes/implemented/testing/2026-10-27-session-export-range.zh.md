# Agent Note: 确定性会话导出归档支持 HTTP 范围续传

Status: implemented

[English](2026-10-27-session-export-range.md) | 中文

## Problem

`GET /api/session.export` 每次请求都重新生成一份 ZIP，其 fflate 条目携带 `Date.now()` 的 DOS 时间戳：同一会话的两次导出逐字节不同，路由不声明 `Accept-Ranges`、不响应 `Range`、不报告长度，因此浏览器下载中断后只能从零开始，未来的续传也会把错配的两半拼接成损坏的归档。§35 边缘矩阵此前只钉住了工作区读侧（文档预览的固定窗口传输引擎、`readBytes` 字节窗），经导出端点的存储侧读路径仍无人服务。

## Decision

两层。`archive.ts` 导出 `SESSION_LOG_ZIP_MTIME`（2000-01-01T00:00:00Z，落在 DOS 日期域内）并在构造后为每个条目盖戳——fflate 0.8.3 的 `ZipDeflate` 不消费 options 里的 mtime（`f.mtime==null?Date.now():f.mtime` 作用于交给 `add` 的对象），确定性要求在构造与 `archive.add` 之间赋值 `entry.mtime`，该配方在落地前经 1.3 秒间隔的探针验证为逐字节相同。路由在每个成功响应上声明 `Accept-Ranges: bytes`；普通 GET 保持今日的单遍流式生成、不带 `Content-Length`；`HEAD` 测量一遍生成并以空 body 报告精确的 `Content-Length`；携带单个合法 `bytes=N-`/`bytes=N-M` 范围的 GET 先测量一遍，再以切片后的第二遍生成回答 `206`——越过末尾的终止字节收敛到 `L-1`，起点到达或越过末尾时以 `bytes */L` 回答 `416`，后缀范围、多范围、其他单位与倒置端点按 HTTP 忽略（按普通 200 提供）。解析与切片是纯函数（`parseRangeRequest`、`sliceByteRange`）；`HEAD` 忽略 `Range`，因为 HTTP 要求对 GET 以外的方法忽略该头。

## Alternatives considered

缓冲整个归档以单遍服务精确长度——被否决，它破坏有界内存流式不变量（Host 除根之外至多持有一份子会话日志、一张图片、一个文件分块）。每个请求都测量——在评审中被否决，因为它破坏了路由既有的行为测试套件：经 `downloads.sessionLog` 驱动的挂起型取消用例会在测量遍内死锁（子会话读取挂起时 Response 永不落地）、flush 与附件读取效果翻倍、流中失败从「200+拒绝的 body」提前变成 500——只对范围与 HEAD 请求测量，把第二遍生成限制在续传流量上。交付不带 `Accept-Ranges` 的分块 200——被否决，因为续传正是台账项本身。

## Consequences

中断的导出下载可以从已持有的字节继续，服务的两半永远来自逐字节相同的两遍生成，拼接不会错配。只有续传请求与 `HEAD` 支付第二遍生成；普通下载与此前完全一致地单遍流式，路由既有的十个行为测试（flush 顺序、拉取容量步调、reader 取消的中止传播、流中失败呈现、读取效果计数）语义不变。新呈现面由路由 spec 钉住：确定性（两次导出逐字节相等、DOS 日期/时间字段经 fflate 自身的本地时间编码等于固定时间戳）、206 切片（`bytes=5-`、`bytes=0-`、`bytes=0-9` 与 `bytes=10-` 拼回完整归档、越过末尾的收敛、深跳尾段）、带 `bytes */L` 的 `416`、被忽略的各形态、`HEAD` 长度、范围请求生成中途的 500。§35 的 partial download/range 边缘至此两侧钉全——工作区窗口与导出路由。浏览器弹窗仍把 URL 交给下载管理器、自身不编排范围续传；这保持为今日行为。
