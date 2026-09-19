# Agent Note: 浏览器启动令牌认证

Status: implemented

[English](2026-08-24-browser-token-authentication.md) | 中文

## 问题

Web Host 以当前操作系统用户的权限运行具有工具能力的 Session，但其 HTTP 接口用请求路由事实识别特权调用者。具体而言，按方法维护的 loopback 列表把 loopback `Host` 值视为本地 authority，尽管 HTTP 客户端可以控制该 header。能够到达服务器的调用者因此可以声明 `localhost`、进入配置方法，再利用模型发现等 Host 侧操作披露存储的凭据。随附 CLI 绑定 loopback 可以限制普通可达性，却不能认证被转发或以其他方式送达该 socket 的请求。

## 决策

`dsh-client-connection` 在分发前认证完整 Host API。每个 API Proxy 方法、Remote 一元调用、通用 Connection channel 和 Remote WebSocket stream 都要求同一个浏览器会话；endpoint 所有权与方法名称不改变 authority。既有 Host/Origin 校验先执行，继续负责 DNS rebinding 和跨站请求防御，失败时返回 403。Host 可信但没有有效浏览器会话时返回 401。浏览器信任规则仍由[载体级浏览器信任决策](2026-07-28-api-browser-trust-boundary.zh.md)持有。

每个 Host 进程生成随机启动令牌，并由应用根 context 跨 Connection 热重载保留。`dsh-web-app` 每个进程只打印并打开一次 query 中带该令牌的普通根 URL。`frontend-static` 请求 Connection 授权 index 响应：只有 `GET /?token=...` 会把进程令牌交换为 cookie，再重定向到干净的 `/`；API 路径和 Authorization header 都不接受该令牌。过时令牌如果同时带有有效 cookie，会重定向到干净的 `/`。缺失与无效凭据得到同一份最小 401 响应。非 index 静态资产保持公开。

cookie 是签名且绑定 authority 的 bearer。确定性名称与签名 payload 都包含规范化 hostname 和 port，因此同一 Harness home 可以在不同 Web port 运行而不发生 cookie 冲突。payload 在绝对有效期内携带安全整数形式的签发与过期时间；`cookieMaxAgeDays` 默认为 30。cookie 是 host-only、`Path=/`、`HttpOnly`、`SameSite=Strict`。随附服务器使用 loopback HTTP，因此不设置 `Secure`。这里没有 logout 操作或反向代理专用处理。

HMAC 密钥是 `ctx.credentials` 中位于 `client-connection/browser-session` 的版本化 `grant` 记录；本地提供方将其存入 `$DSH_HOME/.credentials.yaml`。Connection 在激活期间加载或创建该记录，并保留密钥以同步校验请求。持久记录发生变化后，当前 Connection 继续使用已加载的密钥；下一次激活会加载替换记录或创建缺失记录，因此删除记录并重启进程会撤销全部既有 cookie。无效 owner payload 会明确失败，而不是被覆盖。启动令牌本身绝不持久化并在每次进程启动时变化；未过期 cookie 则能在相同 authority 上跨重启继续有效。

页内 Web Worker preview 不暴露网络 socket。其由页面持有的 `postMessage` tunnel 先进入真实 route，收到 401 或 403 后再经 worker 本地 fetch handler 重试。这样既保留 Connection interceptor，又把认证绕过限制在创建 Host worker 的页面内。

随附 CLI 继续拒绝 `--host 0.0.0.0`。认证不代表支持网络部署、TLS、转发 header 解释或代理配置。

浏览器 HTTP 调用者为每个请求捕获既有 Connection generation。HTTP 401 发布 `auth-expired`、撤回 generation 就绪状态并暂停自动恢复；Host 有意返回统一响应，因此该状态涵盖凭据缺失、无效和过期。已取消请求或旧 generation 的响应不能使替换 generation 失效。HTTP 403 仍表示信任拒绝，不表示设备撤销。Settings 提供使用当前启动链接后重连的本地化说明，不回显凭据，也不重新提交被拒绝的 Prompt。Gateway 独立拥有已完成交互回答的重试。[发现失败决策](../bug-fix/2026-09-17-terminal-host-discovery.zh.md)继续拥有协议不兼容与畸形发现信息的处理。

Host 发现通过 generation source 在 `host/describe` 检查访问权限前报告 `authenticating`，随后恢复连接建立。首次与重试认证使用同一个 Connection 控制器和取消信号。Gateway 在进度变化前记录是否允许初始准入等待，避免认证状态把重连期间的写操作变成排队任务。旧进度及就绪后的回调不能改变活动阶段。该状态描述访问检查，不是新增登录或设备授权操作。

响应侧先检查取消，再分类 HTTP 状态。调用者取消或代际替换后到达的响应不能成为新的认证失败。活动 401 自身使代际失效时，Gateway 为该操作保留 `gateway/authentication-required`，不改记为取消；调用者或贡献项取消仍优先。[Remote 失败决策](2026-08-28-ctx-remote-failure-vocabulary.zh.md)拥有 HTTP 到错误码的映射，生命周期重试与回答保留规则不变。

## 验证

单元覆盖 Connection 重载时保留进程令牌、每次激活只加载一次密钥、无需读取凭据提供方的同步校验、cookie 属性、HMAC 与 payload 校验、authority 与有效期校验、记录删除在下一次激活时生效、无效持久记录，以及用有效 cookie 清理过时令牌 URL。Host 传输套件固定通用 RPC、Typert Remote HTTP、精确 Fetch 路由和 WebSocket upgrade 路径上一致的 401/403 行为。frontend 真实组合测试经 Loader 启动 credentials、Connection、webserver 与静态服务，证明读取 index 前完成令牌交换，同时静态资产仍公开。打包 worker 测试证明 cookie 编码可移植，并覆盖认证与信任拒绝后的 worker 本地重试。真实 CLI 测试在临时 `DSH_HOME` 上用同一端口两次启动 `dsh web`，证明伪造 `Host: localhost` 仍未认证，以交换所得 cookie 调用 `settings/describe`，观测新的进程令牌，并在重启后复用旧 cookie。

Client 测试覆盖就绪前与活动 generation 中的 401、不自动重试、显式恢复，以及 generation 替换或调用者取消后忽略迟到 401。Web profile 录制场景在发现、Prompt 或 Question 回答投递期间移除浏览器 Cookie。重新认证并显式重连后，被拒绝的 Prompt 需要重新提交，待处理回答则按既有规则重试。已被接受或由独立认证的 Client 完成的交互不再重发旧回答，完整 Session 与未修改的 fixture 一致。独立进程测试在恢复暂停期间通过另一个已认证 Client 取消 Approval 和 Question，验证没有审批副作用，并在新回合期间拒绝旧答案。移除 Cookie 验证共用的 401 路径，不代表自然过期或设备撤销。

## 曾考虑的替代方案

**从 TCP 对端地址判定特权调用者。** 直接对端地址仍可能只识别本地转发进程，而非浏览器用户；它会在 API 的命令执行能力旁保留第二套 authority 模型，并要求代理策略回答原始调用者是谁。一个应用凭据才是每项操作都能执行的身份。

**保留按方法的特权列表，并把存储凭据限制在已配置目标。** 列表可能漏掉新 endpoint，也不能约束已经控制工具型 Session 的调用者。`discoverModels` 目标规则不构成安全边界，因为同一已认证主体可以更新 settings 并运行命令。统一认证覆盖授予进程控制权的操作。

**持久化启动令牌或把它作为 API bearer 接受。** 持久启动令牌会成为第二份长期凭据；Authorization header 支持则会增加没有当前 consumer 的非浏览器客户端约定。进程令牌只完成一次浏览器 cookie 交换。

**每次重启都轮换签名密钥。** 这会阻止既有浏览器在普通 DSH 重启后重连。只持久化签名密钥既保留该工作流，又由进程令牌轮换把启动 URL 限定在一个进程生命周期。

**增加 logout、TLS 代理和转发 header 配置。** loopback Web 应用与已报告认证缺口都不需要这些能力；加入它们会在没有当前 consumer 时定义部署约定。浏览器站点数据控制会撤销单个浏览器会话；删除凭据记录并重启进程会撤销全部会话。

## 后果

持有浏览器 cookie 就能调用完整的工具型 Host API，这与 Web 应用在创建 Session 后暴露的 authority 一致。`Host` 不授予更高的方法层级，方法在 API Proxy 与 Typert Remote 之间迁移也不会改变调用者集合。

持久密钥使 cookie 跨重启生效，也让被盗 cookie 最多保有配置的绝对有效期。删除记录并重启进程是全局撤销机制；当前 Connection 刻意避免在每个请求上访问凭据提供方。不设置 `Secure` 保留 loopback HTTP，但如果操作者让同一 cookie authority 经未加密网络可达，cookie 会以明文传输。启动 URL 含进程凭据，必须视为敏感输出；运行时诊断不会重复它。

本决策部分取代[浏览器信任说明](2026-07-28-api-browser-trust-boundary.zh.md)中的认证延期与未认证非 loopback 后果。该说明仍是媒体类型、Host、Origin、Fetch-Metadata 和配置 authority 校验的有效权威。没有 active Agent Note 被归档：重叠只发生在局部，两条安全规则都保有未来决策价值。
