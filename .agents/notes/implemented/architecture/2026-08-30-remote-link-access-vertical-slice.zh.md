# Agent Note：远程链接访问纵向切片（PoC-2）

Status: implemented

[English](2026-08-30-remote-link-access-vertical-slice.md) | 中文

## Problem

全平台原生化方案（E:\11585 方案，第 5–8、20–29、71–72 章）需要原生伴侣客户端经网络接入单个 Harness 宿主。仓库此前没有设备身份、没有配对、没有远程端点策略，也没有任何 TLS；浏览器 `/api` 面信任的是回环栅栏加 HMAC cookie，这对局域网里的手机是错误的信任模型。方案禁止用第二套业务网关解决此事，因此访问层必须在新的设备认证栅栏之后分发到现有 Typert 网关面。

## Decision

`packages/remote/` 下的三个包构成该访问层。`dsh-device-trust`（`ctx.deviceTrust`）是 SQLite 存储，拥有稳定宿主身份、仅以 SHA-256 摘要存储的一次性配对码，以及携带 Ed25519 公钥、角色（`observer`、`controller`、预留 `administrator`）、分别品牌化的 Session 与 Workspace 授权、时间戳和吊销状态的设备记录。配对在一个 `BEGIN IMMEDIATE` 事务中作废配对码，并插入设备及其授权行；其他消费者无法交错，设备也不可能脱离预期授权单独提交。按照仓库的预发布格式策略，schema version 2 会拒绝尚未发布的 version 1 布局。`dsh-link-access`（`ctx.linkAccess`）绑定 TLS 监听器，其自签 ECDSA P-256 证书按固定 X.509 v3 模板在包内组装，以 SubjectPublicKeyInfo 的 SHA-256 指纹向设备标识。serial 生成会拒绝清除符号位后编码为零的样本，使 DER integer 保持正数和最短编码。若 Node 拒绝已持久化的证书，owner 会同时重新生成密钥与证书；指纹随之改变，受影响设备需要重新配对。每个设备请求携带身份、时间戳与覆盖 `timestamp\nmethod\npath\nsha256(body)` 的 Ed25519 签名。加载期端点表为每个产品端点固定调用类别、最低角色与资源策略；产品作用域不可覆盖，自定义端点必须显式选择 `unscoped`。

载体在分发前检查顶层 Session 与 Workspace 授权，并在写入套接字前投影宿主全局的 Session、Workspace 与事件集合。顶层授权通过后，原有 Session、Workspace、Artifact、Attachment 与文件系统 owner 继续校验各自的业务关系。`session/handoff` 保持 `unscoped`，因为其输入会创建新的 Full Session，并未命名任何既有 Session 资源。远程交互回答必须同时满足 controller 角色、`allowRemoteApproval`、已认证设备自己的宿主签发 Client 代次、Gateway 仍拥有的待定投递，以及交互所属 Session 的授权。Gateway 只在进程内 wire adapter 上暴露待定投递查询与 `next` 委托；它仍是唯一的待定事件注册表，被过滤、禁用、吊销或停止的 Link 代次会执行委托，不会使宿主 waterfall 永久等待。单次 RPC 经 `ctx.connection.createSharedFetchHandler('/api')` 分发，流以 NDJSON 泵送 `typertGateway.wireStream`：这与 `dsh-host-electron-ipc` 使用同一对适配器，因此载体增加的是信任栅栏，不是第二套协议或业务 Gateway。`dsh-link-client` 是参考客户端：SPKI 钉扎发生在自定义 `https.Agent.createConnection` 的 `secureConnect` 上、写出任何请求字节之前；未正常结束而关闭的流抛出 `carrier-lost`，调用方会重新订阅，而不会把静默当作完成。

接线：`dsh-web-app` 增加惰性 `device-trust` 行与随附 `disabled: true` 的 `link-access` 行（远程访问绝不默认打开；部署用 patch overlay 启用），`SERVICE_PAGE`/`LINK_MAP` 把这些服务与公开类型归类到 `docs/subsystems/remote-link(.zh).md`，tsconfig 别名、`tsconfig.host.json` 引用、宿主 tsdown 入口 glob 与包图同步更新。配对授权默认覆盖全部 Session 与 Workspace，以保留显式单用户配对流程；部署可用 `pairingAccess` 收窄新配对设备的范围，更改既有设备授权则需要吊销后重新配对。防重放只有时钟偏移窗口；按方案"不做超前传输复杂度"的规则，逐 nonce 追踪等基准证明必要后再做。

## Consequences

真实 TLS 载体与 built Host 组合覆盖选择性授权、在 owner 执行前拒绝 Session、Attachment 与 Workspace path、在写入套接字前投影 Session 与 Workspace、宿主签发交互关联、待定检查、observer 与审批开关拒绝、分发失败后的安全重试、吊销以及载体停止。直接授权测试拒绝畸形 envelope 与 frame，并覆盖每种 Session 地址、集合 baseline、增量 frame、Remote 通知、waterfall 与取消分支；`dsh-device-trust`、`dsh-link-access` 和 Gateway 保持逐文件 100% 覆盖。Client 代次断线时，待定交互留在 Gateway 中供重连重放；显式策略变更、吊销或载体停止则立即委托投递。授权管理 UI 与 mDNS 广播仍是延后的产品工作；资源授权表和 `pairingAccess` 配置已经提供安全行为，无需创建复杂 RBAC。

## Alternatives considered

方案禁止第二套远程业务网关，因为它会复制控制器所有权。单独的审批注册表会与 Gateway 竞态，使首个有效回答语义无法证明，因此载体改用 Gateway 的待定查询与委托操作。证书生成上，`@peculiar/x509` 会把 tsyringe/`reflect-metadata` 全局 polyfill 拖进宿主进程，`selfsigned` 的纯 JS RSA 密钥生成以秒计；包内固定 X.509 模板加 node 生成的 P-256 密钥同时避开两者，并保持为协议常量。复用浏览器 cookie 栅栏会把回环信任模型复制到局域网流量上。WebSocket mux 未扩展出第二个监听：`wireStream` 上的 NDJSON 流已经构成桌面载体联合，远程载体复用该传输，只增加保持 Gateway 所有权所需的两个待定投递操作。
