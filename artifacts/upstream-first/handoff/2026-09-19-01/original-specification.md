# DeepSeek Harness 下一版 Agent 总实施规格

## 0. 总目标

本轮工作的核心目标不是单纯“继续把遗留功能做完”，而是把当前项目重新收敛为：

> **一套 Harness 核心 + 一套稳定跨端 Contract + 多种 Connection Carrier + 多个轻量 Platform Shell。**

Windows、macOS、Linux、Web/PWA、iPhone、iPad、Android 不得继续发展成彼此独立、各自维护 Agent/Session/Remote 逻辑的多个产品。

本轮优先级必须遵循：

**Upstream First > 架构收敛 > 正确性/可靠性 > 安全 > 跨端一致性 > UX > 新功能数量。**

最终目标：

- 最大限度采用 DeepSeek 官方 upstream 当前实现；
- 减少 downstream 独有代码；
- 降低未来 merge/rebase 冲突；
- 避免官方已经实现一套 Desktop 后我们继续维护另一套 Desktop；
- Mobile 尽量只承担 Client/Companion/Lite 角色；
- Agent、Session、Tool、Approval 等核心语义永远由 Host 权威管理；
- 所有跨端操作走统一 Contract；
- UI/design token 尽量来自官方 Web Client；
- 所有发布、兼容、安全、迁移都有机器可验证证据；
- 不再采用“能编译 / 有 APK / 有 EXE = 完成”的验收方式。

---

# 1. 第一原则：在同步最新 upstream 前禁止继续堆功能

这是下一轮 Agent 接手后的第一条硬性要求。

## 1.1 必须先完成 upstream refresh

开始任何新功能前：

1. 拉取 `deepseek-ai/deepseek-harness` 最新官方 `master`。
2. 记录：
   - upstream HEAD SHA；
   - 本项目 dev HEAD；
   - 当前 Goal 主 worktree HEAD；
   - 所有迁移/compat/trust/settings/session worktree HEAD；
   - merge-base；
   - ahead / behind 数；
   - dirty/untracked 状态。
3. 输出：
   - `UPSTREAM_BASELINE.md`
   - `UPSTREAM_DELTA.json`
   - `CUSTOM_CAPABILITY_INVENTORY.json`
4. 对官方近期开启/修改的：
   - `apps/desktop`
   - `packages/api`
   - `packages/client`
   - `packages/client/connection`
   - `packages/client/runtime`
   - `packages/interaction`
   - `packages/session`
   - `packages/settings`
   - `packages/credentials`
   - Desktop packaging/release workflow
   做源码级对比。

## 1.2 upstream audit 完成前禁止

不得继续：

- 扩展旧 Windows Desktop Host；
- 扩展旧 macOS Full Host；
- 新增第二套 Desktop updater；
- 新增第二套 RPC；
- 新建平行 Session protocol；
- 新建与 Typert Remote 重叠的 HTTP API；
- 扩张 `packages/remote/link-*`；
- 改动 Session/schema generation；
- 扩大 Device Trust persistence schema；
- 增加 Apple/Android Remote API；
- 扩展 Lite Tool Contract；
- 对 RC Gate 做最终定型；
- 继续在旧 SHA 上做大规模 UI。

原因：

> 官方 upstream 已经发生明显架构演进。继续在旧基线上开发，会不断制造未来必须重写的代码。

---

# 2. 官方 upstream 应作为新的架构基准

当前官方架构应被视为本项目的“真源”。

官方目前已经形成几个非常重要的边界：

### Agent / Host

Agent Core、Tool、Session、Interaction 等运行在 Host。

### Session

Session 是 append-only / event-sourced 的持久真源。

不要让：

- Mobile；
- Electron renderer；
- Remote transport；
- Handoff；
- Relay

自己维护另一份 Session 真相。

### API

优先使用官方当前 Typert Remote/API Gateway。

普通 RPC：

> 使用官方 Remote Contract。

流式数据：

> 使用官方 stream/mux/Connection carrier。

禁止随意增加：

`POST /custom/...`

这种平行 API。

### Client

Client business state 应继续围绕：

`ConnectionController → SessionManager → Session`

而不是：

React Component → IPC → 自定义 Host Service。

React/UI 组件不得直接承担协议和 Host 状态机。

### Desktop

官方 Desktop 已经出现，并且架构相当明确：

- Electron Shell；
- 官方 Web Client；
- 内置匹配版本 dsh runtime；
- 内置 Node/pnpm；
- 不监听普通 Web HTTP 端口；
- `dsh-app://` 承担 asset/fetch；
- framing pipe 处理流式通信；
- Node IPC 主要负责生命周期；
- Desktop runtime 与 dsh 版本精确绑定。

所以：

> **今后 Windows/macOS Full Runtime 必须以官方 `apps/desktop` 为主。**

---

# 3. 当前自研 Desktop 的处理策略

这是本轮最重要的架构调整之一。

## 3.1 不再维护两套 Full Desktop

禁止形成：

```text
官方 apps/desktop
        +
我们的 Windows Full Runtime
        +
我们的 Swift macOS Full Runtime
```

这是长期维护灾难。

未来目标：

```text
              Official Harness Host
                       │
                 apps/desktop
                 Electron Shell
                ┌──────┴──────┐
              Windows        macOS
```

## 3.2 当前已有 Desktop 功能分五类迁移

### A. upstream 已完全覆盖

直接删除 downstream 重复实现。

例如：

- runtime 生命周期；
- Node runtime；
- Web UI host；
- Desktop profile；
- update infrastructure；
- Electron 生命周期；
- macOS signing/notarization；
- Windows installer；
- updater metadata。

### B. upstream 有能力但实现不同

迁移至 upstream extension point。

例如：

- diagnostics；
- health；
- plugin status；
- runtime recovery；
- native menu。

### C. downstream 独有且仍有价值

作为：

- Cordis plugin；
- shared Host service；
- Client plugin；
- Desktop-specific adapter

重新接入。

不得修改 Desktop 主架构。

### D. 仅为旧架构存在

直接废弃。

### E. Experimental

移出 production dependency。

进入：

`experiments/`

或独立 feature branch。

---

# 4. 产品最终架构

目标架构：

```text
                    Harness Core
                        │
            ┌───────────┴───────────┐
            │                       │
         Session                 Interaction
            │              Question / Approval
            │                       │
            └───────────┬───────────┘
                        │
                   Host Services
                        │
                   Typert Remote
                        │
                 Connection Layer
                        │
          ┌─────────────┼─────────────┐
          │             │             │
       Browser       Desktop        Remote
       Carrier       Carrier        Carrier
          │             │             │
          └─────────────┼─────────────┘
                        │
                 Shared Client Runtime
                        │
      ┌─────────┬─────────┬────────┬─────────┐
      │         │         │        │         │
     Web      Win       macOS     iOS     Android
```

---

# 5. Platform 定位必须重新统一

## Windows

角色：

**Full Host + Desktop Client**

基于：

`apps/desktop`

禁止维护第二 Full Runtime。

---

## macOS

同 Windows：

**Full Host + Desktop Client**

官方 Electron Desktop 为主。

原 Swift Full Host：

> 不再作为主要生产路线。

如果 Swift 代码继续保留，只允许承担：

- native Companion；
- Keychain；
- push；
- share extension；
- deep link；
- platform integration。

---

## Linux

保持：

**CLI + Web Host**

官方没有成熟 Linux Desktop 之前：

不得为了“平台完整”强行维护第三套 Desktop release。

未来 Linux Desktop 单独做 ADR 后再决定。

---

# 6. Mobile 产品定位重新定义

Mobile 分三级。

## Level A：Remote Companion

优先级最高。

手机：

- 不执行完整 Agent Runtime；
- 不直接访问开发目录；
- 连接 Windows/macOS/Linux Host；
- 查看 Agent；
- 发送 Prompt；
- Answer question；
- Approve；
- Follow；
- Handoff；
- 查看 Diff / Artifact；
- 切 Host；
- 收通知。

这是 iOS 和 Android 的默认模式。

---

## Level B：Lite Runtime

仅提供经过明确限制的一小部分本地能力。

例如：

- simple note；
- structured tasks；
- artifact；
- restricted local tool；
- sandboxed files。

不得伪装成 Full Host。

必须公开：

`runtimeMode = lite`

---

## Level C：Full Mobile Host

只作为长期实验。

### Android

技术上存在实现可能性，但：

- Node；
- PRoot；
- sandbox；
- process lifecycle；
- Android background restriction；
- APK size；
- native dependency；
- plugin；
- update；
- Play policy

复杂度都很高。

所以列为：

**P3 Experimental**

### iOS

Full Host 暂不作为正式产品目标。

主要受：

- process；
- JIT/runtime；
- filesystem；
- background execution；
- App Store

等平台限制影响。

---

# 7. 第一阶段 P0：把 Web Client 做成真正跨端 Client

在做更多 Native UI 前，必须把官方 Web Client 做好。

原因：

官方 Web Client 本身就是 Desktop 的 UI。

如果 Web Client 支持优秀的：

- Phone；
- Tablet；
- Desktop；
- Touch；
- Keyboard；

那么：

Windows / macOS / Web / PWA

自动获得一致体验。

## Breakpoint 建议

### Phone

`< 600px`

- Sidebar → Overlay Drawer；
- Right Panel → Sheet / fullscreen；
- Conversation 全宽；
- Composer sticky；
- 不允许 persistent sidebar 压缩聊天区域。

### Large Phone / Small Tablet

`600–839`

- compact rail / drawer；
- inspector overlay；
- Composer adaptive。

### Tablet

`840–1023`

- collapsible rail；
- 主 Conversation；
- inspector 可 overlay。

### Desktop

`>= 1024`

使用官方现有 Desktop layout。

---

# 8. Mobile UI 必须覆盖的边界

## Safe Area

iOS：

- Dynamic Island；
- Home Indicator；
- landscape safe area。

必须支持：

`env(safe-area-inset-*)`

## Virtual Keyboard

Composer 不得被：

- iOS keyboard；
- Android IME；
- floating keyboard

挡住。

## Rotation

必须验证：

- phone portrait；
- phone landscape；
- iPad portrait；
- iPad landscape；
- Android tablet。

## Input

同时支持：

- touch；
- mouse；
- trackpad；
- keyboard；
- stylus。

## Foldable

Android：

不能只依赖：

`window.innerWidth`

应适配窗口尺寸变化。

---

# 9. UI 设计语言

不要自己再创建一套“Mobile Design System”。

优先使用官方：

- design tokens；
- CSS variables；
- semantic colors；
- typography；
- radius；
- spacing；
- elevation；
- dark mode。

所有自定义组件应尽量：

```text
官方组件
   ↓
薄 wrapper
   ↓
跨端 UI
```

而不是：

```text
Web Design
iOS Design
Android Design
Windows Design
```

完全四套。

目标：

> 视觉允许 platform-native 微调，但语义、层级、交互结构必须一致。

---

# 10. Conversation 页面推荐结构

Phone：

```text
┌──────────────────────────┐
│ ← Sessions    Host ●  ⋮  │
├──────────────────────────┤
│                          │
│ User                     │
│                          │
│ Agent                    │
│                          │
│ Tool                     │
│ ┌──────────────────────┐ │
│ │ ✓ tests passed       │ │
│ └──────────────────────┘ │
│                          │
│ Approval                 │
│                          │
│ [拒绝]       [允许一次] │
│                          │
├──────────────────────────┤
│ Ask DeepSeek...          │
│ +       Model      ↑     │
└──────────────────────────┘
```

运行 Host 必须明显显示：

```text
运行位置
Workstation
Windows
workspace-write
```

手机打开 Session 时：

> 不允许用户误以为命令将在手机执行。

---

# 11. Cross-device 第一原则

## View 可以移动

执行位置不能隐式移动。

例如：

用户在：

Windows

启动 Session。

然后 iPhone 打开：

Session 仍运行在 Windows。

---

# 12. HostDescriptor

所有 Client 连接 Host 后第一件事：

请求：

`host.describe`

建议结构：

```ts
HostDescriptor {
  hostId
  displayName

  productVersion
  apiProtocolVersion
  sessionFormatVersion

  platform
  arch

  runtimeMode

  capabilities[]

  transports[]

  serverTime

  workspaceFacts?

  permissionFacts?
}
```

重要：

必须独立维护：

```text
productVersion
apiProtocolVersion
sessionFormatVersion
```

禁止：

一个 `version=3`

同时代表全部东西。

---

# 13. Capability negotiation

禁止 Client 猜 Host 支持什么。

例：

```text
session.follow.v1
session.handoff.v1
device-pair.v1
approval.remote.v1
artifact.stream.v1
diff.viewer.v1
model.select.v1
support.bundle.v1
```

UI：

只有 capability 存在时才显示。

禁止：

```text
点击
→ 请求 API
→ 404
→ 再隐藏
```

---

# 14. N / N-1 Compatibility

必须形成正式矩阵：

| Client | Host | 行为 |
|---|---|---|
| N | N | Full |
| N | N-1 | Negotiated subset |
| N-1 | N | 兼容上一协议 |
| N-2 | N | Diagnostics only |
| Unknown | N | Reject + upgrade |

Session disk format 不由 Client 直接解析。

---

# 15. Interaction 必须重做生命周期

当前非常重要的可靠性问题之一是：

Question / Approval 不能与某一个 HTTP request 生命周期绑定。

正确设计：

```text
Agent
 ↓
Host 创建 PendingInteraction
 ↓
Client A 收到
Client B 收到
 ↓
A 断网
 ↓
B 回答
 ↓
Host resolve
 ↓
Agent resume
```

PendingInteraction 必须拥有：

```ts
requestId
sessionId
type
createdAt
expiresAt?
status
revision
requiredPermission
```

---

# 16. 多 Client 同时回答

场景：

Desktop 和 iPhone 同时在线。

iPhone：

点击 Allow。

Desktop：

也点击 Allow。

必须：

第一个成功。

第二个得到：

`interaction-closed`

而不能：

重复执行 Tool。

---

# 17. Mutation Idempotency

所有会产生状态变更的 Client 请求建议携带：

`clientMutationId`

例如：

- send prompt；
- approve；
- answer；
- revoke device；
- handoff；
- cancel；
- rename session。

断网重试时：

Host 可识别重复请求。

---

# 18. Reconnect

Connection 状态不要只有：

```text
connected
disconnected
```

至少区分：

```text
connecting
authenticating
ready
offline
reconnecting
host-not-ready
auth-expired
device-revoked
incompatible
fatal
```

每一种必须提供对应 UX。

---

# 19. Offline 行为

Mobile 断网：

允许：

- 查看已有 snapshot；
- 查看缓存 UI。

禁止：

自动缓存 Prompt 并在网络恢复后偷偷发送。

如果未来支持 offline queue：

必须明确展示：

```text
待发送 1 条
```

用户确认后才发。

---

# 20. Device Trust

Device Trust 继续保留，但迁移至 upstream-compatible service。

配对建议：

Desktop：

```text
添加设备
  ↓
生成短期 Challenge
  ↓
QR
```

Mobile：

```text
扫码
 ↓
生成 Device Key Pair
 ↓
提交 Public Key + Proof
 ↓
Host 签发 Device Grant
```

二维码里禁止保存：

长期 bearer token。

---

# 21. Device Role

保持简单：

| Role | 查看 | 发 Prompt | Question | Approval | Device Admin |
|---|---|---|---|---|---|
| Viewer | ✓ | | | | |
| Collaborator | ✓ | ✓ | ✓ | | |
| Controller | ✓ | ✓ | ✓ | ✓ | |
| Owner | ✓ | ✓ | ✓ | ✓ | ✓ |

第一版不要做复杂 RBAC。

---

# 22. Lost Device

必须提供：

- revoke one；
- revoke all；
- rename；
- last seen；
- platform；
- key fingerprint；
- pairedAt；
- role。

设备 revoke 后：

已有 stream：

必须立即断开。

---

# 23. Relay

Relay 推荐：

Host：

主动 outbound connect Relay。

而不是：

Host 开公网端口。

Relay：

只能负责：

- routing；
- presence；
- encrypted packet forwarding。

Relay 不应该拥有：

Host private key。

长期应该考虑 E2EE。

---

# 24. LAN

LAN discovery 是便利功能，不是 trust boundary。

mDNS 只能回答：

“附近有没有 Host”。

不能回答：

“这个 Host 是否可信”。

Discovery：

```text
mDNS
QR
Manual host
Relay
```

最终都必须进入同一 Device Trust 流程。

---

# 25. Follow

`session.follow`

必须支持：

```text
cursor/revision
```

网络中断：

```text
revision 201
 ↓
offline
 ↓
reconnect
 ↓
request from 202
```

而不是重新下载全部 Session。

---

# 26. Handoff

第一阶段 Handoff 定义：

**转移查看位置，不转移执行 runtime。**

例如：

Windows：

```text
继续到手机
```

手机打开同一个：

```text
HostId
SessionId
Revision
UI location
```

Agent 仍运行 Windows。

---

# 27. Runtime Migration

真正：

```text
Windows Agent
   ↓
移动到 Android Agent
```

属于非常复杂的第二类能力。

涉及：

- workspace；
- process；
- tool state；
- shell；
- file tree；
- plugin；
- credentials。

暂不与普通 Handoff 混为一谈。

---

# 28. Multi-Host

Mobile 支持：

```text
Work PC
Home PC
MacBook
Linux Server
```

必须明确显示 active Host。

切 Host 时：

Composer 暂时 disabled。

禁止：

UI 已显示 Host B，
请求却仍发往 Host A。

---

# 29. Session Location

每个 Session 应公开：

```text
Host
runtime mode
workspace
permission preset
online state
```

UI 顶部长期显示简洁 chip：

```text
● Work PC · Windows
```

---

# 30. Model Select / Steer

原遗留的 Steer / Model read-select 仍应继续。

但：

API 与 UI 必须进入 shared Contract。

不能：

iOS 一套；
Android 一套；
Desktop 一套。

HostDescriptor capabilities：

```text
model.select.v1
model.steer.v1
```

Client 根据 capability 渲染。

---

# 31. Lite Runtime

如果继续 Lite：

必须重新定义责任边界。

Lite 不是：

“小型 Full Host”。

Lite 是：

**限制能力的 Local Harness Environment。**

必须拥有自己的：

```text
runtimeMode=lite
capabilities
tool catalog
permission policy
```

---

# 32. Lite Tool

Tool 必须声明：

```ts
ToolDescriptor {
  id
  version
  risk
  permissions
  supportsLite
  supportsRemote
}
```

禁止 Mobile 猜 Tool 是否能运行。

---

# 33. Lite Persona/System Prompt

旧遗留仍应保留。

但不能维护平行 Prompt 系统。

尽量复用官方：

System Prompt assembly / context capability。

Lite 只通过：

profile/preset

组合不同上下文。

---

# 34. Diff Viewer

继续做，但降低优先级。

共享能力：

```text
line number
syntax highlight
hunk
added/removed
large file virtualization
binary fallback
copy
open file
```

Phone：

默认 unified diff。

Desktop：

可支持 split diff。

---

# 35. File / Artifact

所有平台统一：

```text
ArtifactDescriptor
FileDescriptor
```

必须考虑：

- large file；
- binary；
- image；
- unknown MIME；
- partial download；
- range；
- interrupted transfer；
- filename encoding；
- zero-byte file。

---

# 36. Attach

Mobile Composer 必须有显式：

`+`

而不是依赖 drag & drop。

支持：

iOS：

- Photos；
- Files；
- Camera；
- Share Sheet。

Android：

- Storage Access Framework；
- photo picker；
- camera；
- share intent。

---

# 37. Commands 风险等级

原 command risk 欠账应提升为 P0/P1。

建议：

```text
LOW
MODERATE
HIGH
CRITICAL
```

风险不是由 Client 判断。

由 Host Tool/Command layer 输出。

Client 只展示。

---

# 38. Approval UI

Approval 必须显示：

```text
操作
目标
Host
Workspace
Risk
Permission escalation
Command preview
```

危险操作不能只显示：

> “是否允许？”

---

# 39. Credentials

优先迁移至 OS secure store：

Windows：

Credential Manager / DPAPI。

macOS / iOS：

Keychain。

Android：

Keystore + encrypted storage。

Linux：

Secret Service 等可用后端。

不要再把：

文件权限 `0600`

等同于：

“Agent 无法读 Credential”。

---

# 40. Plugin 权限

Plugin 建议描述：

```text
filesystem
network
shell
credential
session
interaction
remote
```

安装插件时应展示 capability。

高风险 Plugin：

明确确认。

---

# 41. Health / Readiness

建议区分：

```text
health
readiness
```

health：

进程是否活着。

readiness：

是否可以接受 Agent 请求。

例如：

```ts
HealthSnapshot {
  process
  runtime
  sessionStore
  pluginState
  connection
  modelProvider
}
```

---

# 42. Diagnostics

必须跨平台统一。

包含：

- product version；
- SHA；
- protocol；
- session format；
- Host ID；
- platform；
- runtime；
- plugins；
- connectivity；
- migrations；
- crash；
- last errors。

禁止包含：

- API keys；
- bearer；
- pairing secrets；
- raw credentials。

---

# 43. Support Bundle

原 G2-SUPPORT 工作继续完善。

Support Bundle 应：

1. producer；
2. sanitizer；
3. manifest；
4. checksum；
5. collector validation。

并且验证：

四平台同候选。

---

# 44. Telemetry

继续：

默认关闭。

UI 不要只做一个：

“Telemetry”

总开关然后隐藏数据类型。

最好区分：

- Session telemetry；
- provider metadata；
- relay metadata；
- Device Trust metadata；
- crash diagnostics。

---

# 45. Error Code

建立跨平台 closed vocabulary。

建议：

```text
unsupported-version
capability-unavailable
authentication-required
device-revoked
pairing-expired
permission-denied
session-unavailable
revision-conflict
duplicate-mutation
interaction-closed
host-not-ready
transport-interrupted
migration-required
internal
```

所有 Client 对同一错误必须呈现相同语义。

---

# 46. Persistence

所有 persistence migration 要求：

- adjacent version；
- atomic；
- recoverable；
- old generation 保留；
- 不 silent drop；
- crash-safe。

不要：

启动时直接原地覆盖唯一副本。

---

# 47. Feature Flag

新能力需要：

```text
feature flag
+
capability
```

例如：

```text
remotePairing
sessionFollowV2
nativeHandoff
liteRuntime
```

方便分阶段上线。

---

# 48. 目录结构建议

不要机械执行以下目录名。

Agent 必须先根据最新 upstream package ownership 做最终 placement。

概念目标：

```text
apps/
  cli/
  web/
  desktop/

  apple/          # downstream thin companion only
  android/        # downstream thin companion only

packages/

  api/
    remotes/

  client/
    connection/
    runtime/
    ui-*/

  interaction/

  session/

  identity/
    device-trust/

  settings/

  credentials/

  diagnostics/

  support/
```

原：

```text
packages/remote/link-access
packages/remote/device-trust
packages/remote/link-contracts
```

不能默认原样继续。

先审计：

官方当前 API/Connection 能否接管这些责任。

---

# 49. 15 项旧遗留重新评估

## 1. macOS Direct Full Host

原状态：

部分实现。

新结论：

**不再作为主产品路线。**

官方 Desktop 已经存在。

行动：

- 功能差异审计；
- 有价值能力迁到 official Desktop/service；
- Swift Full Host 降为 Experimental；
- 禁止继续扩大。

---

## 2. iPhone / Android 真机 E2E

继续。

优先级：

**P1**

必须覆盖真实设备。

---

## 3. Lite 内置 Tool Execution

继续，但延后。

优先级：

P2。

先稳定：

Remote Contract。

---

## 4. Lite Persona

继续。

P2。

复用官方 Prompt/Context composition。

---

## 5. mDNS / Bonjour

继续，但降级。

P2。

只是 discovery convenience。

不能参与 trust。

---

## 6. Capability / Version Negotiation

升级为：

**P0。**

这是所有跨端能力基础。

---

## 7. Windows Role Editing / Diagnostics

拆分。

Diagnostics：

P1，共享实现。

Role Editing：

移到 Device Management UI。

不再 Windows-only。

---

## 8. iPad / Android Adaptive Layout

提升：

Web Responsive = P0。

Native Adaptive = P2。

---

## 9. Diff Line Number / Highlight

P2/P3。

共享 viewer。

---

## 10. 统一 HarnessRuntime

原方案需要改变。

不要创建一个庞大的自定义 `HarnessRuntime` Facade 覆盖官方 runtime。

真正需要统一的是：

```text
Host Contract
Connection
Session
Interaction
Capabilities
```

因此：

> **概念保留，实现方式推倒重审。**

---

## 11. Session Running Location / Multi Host

P1。

继续。

对移动端非常重要。

---

## 12. Follow / Private Network UX

P1。

Follow 继续。

Private Network 则重构为：

Transport + Trust。

---

## 13. Network / Compatibility Matrix

提升为：

**P0 Gate。**

不能只测试 Kotlin。

必须最终覆盖：

- TS/Web；
- Desktop；
- Swift；
- Kotlin。

---

## 14. Steer / Model Read-Select

P1。

放进统一 Remote API 和共享 UI。

---

## 15. Health / Contract Stability / Command Risk

提升：

P0/P1。

Health / Readiness：

P1。

Version Contract：

P0。

Command Risk：

P0/P1。

---

# 50. 新发现但旧清单没有覆盖的事项

必须新增：

### Human Interaction Durability

Question/Approval 不能依赖短 HTTP timeout。

### Mutation Idempotency

避免 reconnect 双执行。

### Multiple Client Race

Desktop 与 Mobile 同时审批。

### Host Sleep / Wake

MacBook 合盖。

Windows sleep。

Android/iOS background。

### Clock Skew

Pair challenge 不应单纯相信 Client time。

### Captive Portal

错误 Wi-Fi 网络。

### VPN

VPN 切换。

### IPv4 / IPv6

不要默认 IPv4。

### NAT

LAN discovery 与 remote transport 分开。

### Replay

Pairing nonce 必须一次性。

### Device Re-key

Secure storage 清空后重新配对。

### Host Rename

Host ID 不得绑定 displayName。

### Workspace Move

Session workspace 路径变化必须明确错误。

### Host Reinstall

旧 Device Trust 是否继承必须有规则。

### Large Artifact

需要 backpressure。

### Background Push

Push 只通知：

不能成为权威 Session data transport。

### Notification Action

未来从通知直接 Allow 需要严格权限设计。

初期不要做危险审批通知按钮。

---

# 51. CI 测试金字塔

## Unit

覆盖：

- contract；
- parser；
- reducer；
- migrations；
- capability；
- error；
- idempotency。

## Integration

覆盖：

- session；
- interaction；
- reconnect；
- pairing；
- revoke；
- follow；
- handoff。

## Browser E2E

至少：

Chromium。

增加：

WebKit。

重点覆盖 Mobile Safari 语义。

## Native E2E

Swift：

simulator + physical。

Kotlin：

emulator + physical。

## Real Host

使用真实 dsh runtime。

## Real Model

保留独立 secret runner。

---

# 52. UI Visual Matrix

每次 UI RC 至少检查：

```text
320×568
393×852
768×1024
1024×768
1440×900
```

状态：

```text
idle
streaming
tool
approval
question
offline
reconnecting
error
empty
loading
large diff
artifact
```

主题：

```text
light
dark
```

访问性：

```text
200% zoom
font scaling
reduced motion
keyboard-only
screen reader smoke
```

---

# 53. Native Device Matrix

## iOS

- current major；
- previous major；
- iPhone；
- iPad。

## Android

至少：

API 34；
current API；
16 KiB page-size 环境继续保留。

设备：

Phone + Tablet。

未来再加入 foldable。

---

# 54. 网络矩阵

必须覆盖：

```text
same LAN
different LAN
Wi-Fi → Cellular
Cellular → Wi-Fi
VPN on/off
Host IP change
Host sleep
Host restart
Client background
Client process death
Relay reconnect
packet loss
latency
```

---

# 55. Contract Compatibility Matrix

每个 RC 自动跑：

```text
Client N     ↔ Host N
Client N     ↔ Host N-1
Client N-1   ↔ Host N
```

Swift、Kotlin、TS 都要进入。

---

# 56. Desktop Release

完全尽量沿用官方 pipeline。

Windows：

- NSIS；
- signing；
- updater；
- blockmap。

macOS：

- Developer ID；
- hardened runtime；
- notarization；
- staple；
- Gatekeeper。

不要重新造 release system。

---

# 57. Mobile Release

iOS：

```text
archive
codesign
TestFlight
physical install
upgrade
keychain persistence
deep link
background/foreground
```

Android：

```text
release APK/AAB
signing
internal track
upgrade
Keystore persistence
process death
deep link
```

---

# 58. Gate 设计重做

## Gate 0：Upstream Convergence

要求：

```text
upstream SHA fixed
delta inventory complete
duplicate architecture classified
migration plan generated
```

未通过：

禁止新开发。

---

# Gate 1：Architecture / Contract

要求：

- package ownership；
- no duplicate Desktop；
- Typert Contract；
- version negotiation；
- persistence；
- migration；
- error vocabulary；
- unit/contract tests。

必须 machine-readable。

---

# Gate 2：Compatibility / Security

要求：

- N/N；
- N/N-1；
- N-1/N；
- Device Trust；
- revoke；
- replay；
- MITM threat review；
- command risk；
- SAST；
- dependency；
- SBOM。

---

# Gate 3：Platform / Native / Recovery

要求：

同一候选 SHA。

Windows：

真实。

Mac：

真实。

Apple：

真实。

Android：

真实。

覆盖：

install / launch / run / recover。

---

# Gate 4：RC

只有以下全部成立：

```text
same SHA
same source provenance
all platform receipt
signatures
notarization
SBOM
checksum
compat
security
migration
support bundle
update test
```

才允许：

```json
{
  "completeRc": true
}
```

---

# 59. 禁止“产物存在 = Gate Pass”

例如：

```text
Windows.exe ✓
mac.dmg ✓
Android.apk ✓
iOS.ipa ✓
```

不能推出：

RC 完成。

必须证明：

这些来自：

**同一个 Source SHA。**

---

# 60. Evidence Schema

建议每个平台统一：

```json
{
  "candidateSha": "...",
  "upstreamSha": "...",
  "platform": "...",
  "arch": "...",
  "buildId": "...",

  "sourceProvenance": "...",

  "tests": {},
  "native": {},
  "security": {},
  "compat": {},

  "artifact": {
    "sha256": "...",
    "signed": true
  },

  "timestamp": "..."
}
```

---

# 61. Agent 提交策略

禁止：

一个巨大 commit：

```text
feat: mobile + remote + trust + session + desktop + diagnostics
```

必须拆。

推荐 Patch Train：

### Train A

```text
upstream sync
delta audit
```

### Train B

```text
interaction reliability
reconnect
idempotency
```

### Train C

```text
responsive Web
mobile composer
approval/question UX
```

### Train D

```text
HostDescriptor
Capability
Version
```

### Train E

```text
Health
Diagnostics
Support
```

### Train F

```text
Device Trust
Pair
Revoke
```

### Train G

```text
Remote Carrier
Attach
Follow
Handoff
```

### Train H

```text
Native Apple
Native Android
```

### Train I

```text
Lite
```

---

# 62. 每个 Commit 的最低要求

Commit 必须说明：

```text
Problem

Upstream Owner

Why this owner

Contract change

Persistence impact

Security impact

Compatibility impact

Test evidence

Rollback
```

---

# 63. Agent Note

重大架构改动必须建立：

`.agents/notes/...`

内容：

```text
Status
Problem
Current upstream boundary
Decision
Alternatives
Contract
Persistence
Security
Compatibility
Failure handling
Tests
Rollout
Rollback
```

---

# 64. UX 状态完整性

每一个主要页面都必须检查：

- Loading；
- Skeleton；
- Empty；
- Error；
- Offline；
- Disabled；
- Permission denied；
- Unsupported；
- Reconnecting；
- Partial；
- Retry。

禁止页面只考虑：

“成功正常情况”。

---

# 65. Accessibility

必须纳入 Gate。

包括：

- keyboard；
- visible focus；
- semantic dialog；
- aria label；
- color contrast；
- reduced motion；
- text scaling；
- screen reader；
- touch target。

主要 Touch target 尽量：

约 44 CSS px。

---

# 66. 性能

Mobile：

避免：

- 整个 transcript 重 render；
- huge DOM；
- 大 Diff 一次性渲染；
- 大 Artifact 入内存。

应该：

- virtualization；
- incremental rendering；
- bounded buffer；
- stream backpressure。

---

# 67. Crash / Recovery

Host crash：

Client 提示：

```text
Harness Host 已停止
[重新启动]
[查看诊断]
```

Desktop Shell crash：

Host 生命周期必须明确。

Mobile crash：

重启后恢复：

```text
trusted host
last session
connection state
```

但禁止自动提交 unfinished draft。

---

# 68. Update

Client/Host version compatibility必须在 update 前检查。

Desktop：

继续官方 updater。

Native Mobile：

Store / signed channel。

禁止 Native App：

偷偷下载新的 executable Agent Runtime 来绕过 Store。

---

# 69. Security Threat Model

必须建立正式 threat model。

至少：

```text
MITM
DNS rebinding
Origin spoof
QR replay
pairing brute-force
token leakage
lost device
stolen device
relay compromise
plugin escalation
malicious Agent command
downgrade
unsigned update
support-bundle secret leakage
log secret leakage
session replay
permission race
```

---

# 70. Security 核心要求

### Pairing

nonce + expiry + single-use。

### Device Grant

可撤销。

### Transport

加密。

### Remote

不关闭 Host 原有 localhost 防线。

### Relay

不能成为 trusted Host。

### Logs

redact。

### Update

signed only。

### Plugin

最小权限。

### Tool

Host-side enforcement。

---

# 71. Web local auth 不得为了 Mobile 被破坏

官方当前 local Web 安全边界是重要基础。

Mobile Remote 不能通过：

```text
dsh web --host 0.0.0.0
```

然后当正式产品。

正确：

新建独立 Remote Connection Source。

Web Local：

继续原来的 local auth。

Remote：

走 Device Trust。

---

# 72. 当前项目最应该删除的债务

Agent 在 audit 后重点搜索：

### duplicated runtime

### duplicated protocol

### duplicated session model

### duplicated device storage

### duplicated error code

### duplicated UI state machine

### duplicated updater

### duplicated signing pipeline

### duplicated permission model

能上移到共享层的一律上移。

---

# 73. Definition of Done

功能不能仅满足：

“能跑”。

必须同时：

### Functional

功能正确。

### Compatibility

N/N-1。

### Cross-platform

覆盖目标平台。

### Recovery

断网/崩溃恢复。

### Security

威胁模型检查。

### UX

状态完整。

### Accessibility

可用。

### Observability

有诊断。

### Test

自动化。

### Documentation

同步。

### Evidence

机器可判定。

---

# 74. Stop Condition

Agent 遇到以下情况必须停止继续堆功能并转为报告：

### Upstream architecture conflict

例如官方刚重写 API。

### Persistence ambiguity

不知道哪套数据是真源。

### Security boundary unclear

尤其 Device Trust/Remote。

### Current candidate SHA mismatch

不能继续假装 RC。

### Native runner unavailable

不得把 simulator 当物理设备通过。

### Signing unavailable

不得把 unsigned artifact 标为 release pass。

---

# 75. 最终产品形态

理想目标不是：

```text
Windows 产品
Mac 产品
iOS 产品
Android 产品
Web 产品
```

各自维护 Agent。

而是：

```text
                 DeepSeek Harness Platform

                        Core Host
                           │
           Session / Tool / Interaction
                           │
                    Typed Contract
                           │
                     Connection
                           │
        ┌──────────┬───────┼───────┬──────────┐
        │          │       │       │          │
       Web       Win      Mac     iOS      Android
```

平台差异只保留在真正需要 native 的地方：

- secure storage；
- window；
- notification；
- share；
- camera；
- deep link；
- filesystem picker；
- background lifecycle；
- install/update。

Agent/Session/Approval/Tool 等核心语义保持唯一。

---

# 76. 下一轮 Agent 实际执行顺序

严格按以下顺序推进。

## Phase 0

Upstream Refresh。

不写新功能。

---

## Phase 1

Upstream Delta Audit。

建立：

```text
Adopt
Adapt
Keep
Migrate
Delete
Experimental
```

六分类。

---

## Phase 2

Desktop Convergence。

将 Windows/macOS Full Runtime 收敛到官方 `apps/desktop`。

---

## Phase 3

Contract Stabilization。

完成：

```text
HostDescriptor
Capability
Version
Error
Idempotency
```

---

## Phase 4

Interaction Reliability。

完成：

```text
Question
Approval
Reconnect
Multi-client
Cancellation
Recovery
```

---

## Phase 5

Responsive Shared Client。

完成：

Phone / Tablet / Desktop。

---

## Phase 6

Diagnostics。

完成：

Health / Readiness / Support Bundle。

---

## Phase 7

Device Trust。

完成：

Pair / Role / Revoke / Recovery。

---

## Phase 8

Remote Transport。

不得破坏官方 local Web security。

---

## Phase 9

Follow / Attach / Handoff / Multi Host。

---

## Phase 10

Apple / Android thin native companions。

---

## Phase 11

Lite。

---

## Phase 12

Release / RC。

完整执行 Gate 0–4。

---

# 77. P0 / P1 / P2 / P3 总表

## P0

必须先做：

- upstream sync；
- delta audit；
- Desktop convergence；
- Interaction reliability；
- capability/version；
- N/N-1；
- responsive Web；
- Mobile approval/question bug；
- reconnect；
- idempotency；
- command risk；
- Contract tests；
- Gate redesign。

## P1

之后做：

- Device Trust；
- Remote Transport；
- Follow；
- Handoff；
- Multi Host；
- Diagnostics；
- Health；
- support bundle；
- model select/steer；
- physical device E2E。

## P2

再做：

- native iOS；
- native Android；
- Lite；
- mDNS；
- Diff enhancements；
- Artifact integration；
- tablet specific UX。

## P3

实验：

- Android Full Host；
- iOS Full Host；
- Linux Desktop；
- runtime migration；
- complex RBAC。

---

# 78. 最重要的架构决策

本轮必须明确接受以下决策：

> **1. 官方 Desktop 取代我们自建的 Desktop 主架构。**

> **2. Mobile 第一身份是 Remote Companion，而不是 Full Runtime。**

> **3. Web Client 是所有端 UI 一致性的基础。**

> **4. Agent/Session 永远属于 Host。**

> **5. Transport 不得影响 Agent semantics。**

> **6. Device Trust 与 LAN discovery 分离。**

> **7. Product/API/Session 三套 Version 分离。**

> **8. Capability negotiation 是跨版本能力的核心。**

> **9. Question/Approval 生命周期与网络请求生命周期解耦。**

> **10. 所有发布 Gate 必须绑定同一 Source SHA。**

---

# 79. Agent 最终输出要求

每完成一个阶段必须更新：

```text
IMPLEMENTATION_STATUS.md
UPSTREAM_DELTA.md
ARCHITECTURE_DECISIONS.md
COMPATIBILITY_MATRIX.md
SECURITY_STATUS.md
PLATFORM_VERIFICATION.md
RELEASE_STATUS.md
```

所有状态只能是：

```text
NOT_STARTED
IN_PROGRESS
BLOCKED
PASS
FAIL
DEFERRED
```

不得使用：

“基本完成”

“应该没问题”

“大概支持”

这种不可机器判断的状态。

---

# 80. 最终成功标准

整个项目最终达到：

### Upstream

可以持续同步官方而不发生大面积冲突。

### Architecture

不存在两套 Full Desktop/Session/RPC。

### Cross-device

Win / Mac / Linux Host：

可被 Web / Desktop / iPhone / iPad / Android 安全访问。

### Reliability

断网、后台、Host restart 后可恢复。

### Security

Remote 不以降低 local Host 安全为代价。

### UX

所有端信息架构一致。

### Mobile

Phone/Tablet 真正可用，而不是“桌面网页缩小版”。

### Compatibility

N / N-1 自动验证。

### Release

同 SHA、签名、SBOM、provenance、真实 Runner/真机。

### Maintainability

平台 Shell 薄，业务逻辑集中。

### Future Upstreamability

新增能力尽量遵循官方 package ownership、Cordis、Typert、Client Runtime 和设计规范，从而让未来 upstream 采用或我们持续 rebase 的成本尽可能低。

---

# 本轮一句话总原则

**不要继续把 DeepSeek Harness 做成“五套客户端各自带一套 Harness”；应把它收敛为“一套官方兼容 Harness 平台 + 一套跨端 Contract + 多个轻量 Shell”。**