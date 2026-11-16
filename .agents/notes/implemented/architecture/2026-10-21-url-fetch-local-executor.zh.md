# Agent Note: url_fetch 作为第三枚 Lite 本地执行器落地

Status: implemented

[English](2026-10-21-url-fetch-local-executor.md) | 中文

## 问题

gen-62 落首批两枚设备执行器时立了配对规则——无设备 schema 的执行器仅幻觉可达——并把 `url_fetch` 缓在「端点策略+§54 网络矩阵」。再勘察把两个缓由都量没了：§54 原文（original-specification.md 2036-2054）是十三条件的 Client↔Host 链路矩阵、与工具发起的出站抓取零交集；真正的缺口是 URL 信任域——模型控制目标 URL，那不是 `validateLiteEndpoint` 治辖的用户配置 LLM endpoint。没有执行器时，设备声明行（moderate、空 permissions、supportsLite）空悬在 AllowLocal 门后无派发者。

## 决策

执行器随其政策一并落地。schema 条目并入 `lite-device-tool-schemas.json`（`{url: string}`——conformance fixture 已钉调用形状），四政策写入其描述。`LiteToolExecutors.urlFetch` 是 IO dispatcher 上的 suspend 函数（循环在调用方 main dispatcher 上 collect；阻塞抓取会 ANR）：参数解析、URL 必须 https（app 层先于平台明文禁令的干净拒绝）、host 解析必须落在私网词汇之外——`isAnyLocalAddress`、loopback、site-local、link-local、fc00::/7 unique-local 前缀、以及 IPv4-mapped/compatible IPv6 地址的内嵌 IPv4 尾巴（JVM 谓词看不穿映射；内嵌地址经同一词汇递归）。连接期 `PrivateNetworkRefusingDns` 对 OkHttp 实际拨号的地址复检，封住 pre-flight 解析与连接之间的 DNS-rebinding 窗口。抓取跑在独立持有的 client 上——绝不复用 provider 的 endpoint 绑定流式 client——用流式形态禁止的有界 unary 档（connect 10s、read/call 30s）、跳转绝不跟随：3xx 把 Location 目标不跟随地答回，模型自己再调 url_fetch。2xx 过文本 Content-Type 门（任何 `text/*`、json/xml/yaml/javascript application 子类型加 `+json`/`+xml` 后缀；缺失头拒收）与 256 KiB 有界读（`URL_FETCH_CONTENT_LIMIT_BYTES`、与 `ARTIFACT_CONTENT_LIMIT_BYTES` 同值并列命名）后其解码文本成为结果。每项拒绝都是 fail-soft 中文文案；unknown-host 消息与 conformance fixture 钉形逐字一致。MainActivity 的 `when(name)` 增纯分支；设备声明与 manifest 不动——INTERNET 已在、targetSdk 36 的明文禁令已立。

## 备选方案

带逐跳重验的跟随跳转被拒——不跟随的跳转把 Location 原样答回、让模型决定，零重验成本。复用 provider 的 OkHttpClient 被拒：它 endpoint 构造器绑定、流式 read/call=0 档会让一次抓取挂死一个回合。仅 pre-flight 地址检查无连接期 Dns 兜底被拒——DNS rebinding 正是这类检查的经典绕过。JVM 测试经真网络触达评估路径被拒——https-only 加私网拒绝使本地 2xx 路径不可达，故响应评估设为 internal 纯缝离线测试（跳转、状态码、类型门、帽边界），网络面测试确定性成立的政策拒绝（十三种私网字面量含 ULA/mapped/metadata 端点；`example.invalid`→钉形 DNS 失败文案）。

## 后果

模型现在能指挥设备抓取一个文本页——五本地名的第三枚上线——其 SSRF 姿态强于勘察底线：拨号前后双私网词汇拒绝、不跟随跳转、https-only、有界读、仅文本门。真站点验收仍属 e2e 域（JVM 套件钉政策拒绝与评估缝；不主张任何活 https 往返）。core JVM 测试：579 -> 587（LiteToolExecutorsTest 7 -> 15）。已知的 `LiteHTTPProviderTest` 截断 flake 在四轮全量中现两次、最终轮过——relay-retirement note 已具名的一/六既有 flake，本代未动。

## 开放跟进

`image_inspect` 与 `attachment_read` 仍无 intake 生产者；工具行 journal 持久化仍留 chapter-64 决策；配对宿主目录拉取的真宿主 e2e 与热刷新 UI 仍自 gen-64 台账开放。
