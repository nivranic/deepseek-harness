# Agent Note：远程链接访问纵向切片（PoC-2）

Status: implemented

[English](2026-08-30-remote-link-access-vertical-slice.md) | 中文

## Problem

全平台原生化方案（E:\11585 方案，第 5–8、20–29、71–72 章）需要原生伴侣客户端经网络接入单个 Harness 宿主。仓库此前没有设备身份、没有配对、没有远程端点策略，也没有任何 TLS；浏览器 `/api` 面信任的是回环栅栏加 HMAC cookie，这对局域网里的手机是错误的信任模型。方案禁止用第二套业务网关解决此事，因此访问层必须在新的设备认证栅栏之后分发到现有 Typert 网关面。

## Decision

`packages/remote/` 下的三个包构成该访问层。`dsh-device-trust`（`ctx.deviceTrust`）是 SQLite 存储，拥有稳定宿主身份、仅以 SHA-256 摘要存储的一次性配对码，以及携带 Ed25519 公钥、角色（`observer`、`controller`、预留 `administrator`）、时间戳与吊销状态的设备记录；配对消费先删除配对码行再插入设备行，两次 `DatabaseSync` 调用在宿主唯一连接上同步执行，因此消费是原子的。`dsh-link-access`（`ctx.linkAccess`）绑定 TLS 监听器，其自签 ECDSA P-256 证书按固定 X.509 v3 模板在包内组装，以 SubjectPublicKeyInfo 的 SHA-256 指纹向设备标识；每个设备请求携带身份、时间戳与覆盖 `timestamp\nmethod\npath\nsha256(body)` 的 Ed25519 签名，授权是加载期解析的端点 Allowlist（调用类别加最低角色），`$events/result` 按协议标记，因此无论哪份 Allowlist 列出它，独立的 `allowRemoteApproval` 开关都生效。单次 RPC 经 `ctx.connection.createSharedFetchHandler('/api')` 分发，流以 NDJSON 泵送 `typertGateway.wireStream`——与 `dsh-host-electron-ipc` 同一对适配器，因此载体增加的是信任栅栏而非协议。`dsh-link-client` 是参考客户端：SPKI 钉扎发生在自定义 `https.Agent.createConnection` 的 `secureConnect` 上、写出任何请求字节之前；未正常结束而关闭的流抛出 `carrier-lost` 而不是安静结束，调用方因此重订阅而不是把静默当完成。

接线：`dsh-web-app` 增加惰性 `device-trust` 行与随附 `disabled: true` 的 `link-access` 行（远程访问绝不默认打开；部署用 patch overlay 启用），`SERVICE_PAGE`/`LINK_MAP` 把两个服务与六个类型归类到 `docs/subsystems/remote-link(.zh).md`，tsconfig 别名、`tsconfig.host.json` 引用、宿主 tsdown 入口 glob 与包图同步更新。防重放只有时钟偏移窗口；按方案"不做超前传输复杂度"的规则，逐 nonce 追踪等基准证明必要后再做。

## Consequences

PoC-2 参考序列（pair → describe → call → stream → 游标续传重连 → abort → dispose → 钉扎不匹配 → 载体中途断开）在真实 TLS 套接字上端到端通过；载体测试覆盖配对的正常/重放/过期/畸形、五类 401、Allowlist/类别/角色/审批拒绝、声明与流式 413、`$events` ready 与审批开关后的角色门控交互回答、单次调用与流在客户端消失时的中止、跨挂载证书复用、端口冲突与默认禁用——48 个测试、三个包逐文件 100% 覆盖。Windows 配对 UI、设备管理器、远程审批设置与 mDNS 广播延后到基于 `ctx.linkAccess` 的 Phase 1 宿主 UI 增量；经载体的 SessionController 级会话 e2e 延后到首个伴侣端一致性套件（载体已覆盖与浏览器测试相同的网关分发链）；Swift/Kotlin 伴侣端与共享 golden fixtures 是 Phase 2 工作，以 `dsh-link-client` 为可执行契约。

## Alternatives considered

第二套远程业务网关被方案禁止，且会复制控制器所有权。证书生成上，`@peculiar/x509` 会把 tsyringe/`reflect-metadata` 全局 polyfill 拖进宿主进程，`selfsigned` 的纯 JS RSA 密钥生成以秒计；包内固定 X.509 模板加 node 生成的 P-256 密钥两者皆避，且保持为协议常量。复用浏览器 cookie 栅栏会把回环信任模型复制到局域网流量上。WebSocket mux 未扩展出第二个监听：`wireStream` 上的 NDJSON 流已构成桌面载体联合，远程载体零网关改动复用该形态。
