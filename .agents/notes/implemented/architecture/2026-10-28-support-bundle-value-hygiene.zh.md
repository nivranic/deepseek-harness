# Agent Note: Support bundle 值级卫生与双平台同候选证明

Status: implemented

[English](2026-10-28-support-bundle-value-hygiene.md) | 中文

## 问题

§42/§43 族行收口脱敏与 collector 缺口时有三项发现。其一，秘密形状扫描只覆盖键：自由文本值——错误消息引用一次 curl 失败，即现实中最常见的携带者——可以原样穿过 `message` 字段进入 `describe()` 与 bundle，因为 recorder 存的是原始文本而 `scanKeys` 从不看字符串值。其二，盖戳的 `sourceRevision` 被原样转发：`DSH_BUILD_REVISION` 设成任何畸形字符串都按原样抵达操作者，错误配置的戳悄然劣化 §42 的溯源事实。其三，§43 同候选主张只有单一实现见证：Node producer 校验自己的工件，没有第二平台重推导规范序列化、逐条摘要或链式校验和——规格的「四平台产出字节一致 bundle」是构造性断言，从未经独立端口证明。

## 决策

三项发现各对应一个机制。(1) 环形记录唯一写入口的值级擦洗：`redact.ts` 命名三种秘密形态——`Bearer` 凭据、`sk-` 键、`api-key`/`token`/`password` 式赋值——`recordError` 把每条 message 经 `redactSecretShapedText` 后才入环，每个匹配替换为 `[redacted:<kind>]`，之后才可能抵达环形记录或 §42 载荷。recorder 是唯一写路径，其他事实来源无从绕过。(2) sanitizer 从拒绝键扩展到拒绝值：`scanKeys` 的字符串分支跑 `carriedSecretShape`，携带形态的值使整个 bundle 大声失败——擦洗属于 owner 掌控的记录文本，拒绝属于 bundle 将要发布的组装值。(3) `readStampedRevision()` 只接受 40 位十六进制 commit sha 或字面量 `source-tree`；构造器调用它使畸形的 `DSH_BUILD_REVISION` 令插件加载失败（错误配置在最早可解析点大声失败），`describe()` 逐调用重读使修正后的环境变量无需重载即生效。

§43 同候选证明是一个派生夹具加一个独立 Kotlin 端口。`tests/gen-candidate.mjs` 把固定输入（含一条预擦洗错误的诊断快照、两行 session-header、两行 settings-export）喂给生产 `buildSupportBundle` 并写出封存工件——夹具是派生的，绝不手写，因此不可能漂离 producer 的规则。伴生端 `SupportBundleCollector.kt` 零共享代码地重实现校验：严格形状检查、逐条目规范序列化（`kind` 先行、顶层 content 键按码元序、嵌套对象保插入序、JS 字符串转义取 producer 的精确转义集）、逐条 SHA-256、manifest 顺序、链式校验和。其 JVM 测试验证同一份夹具字节并重推导出相同链式校验和，外加四种篡改形态——改条目值、伪造链校验和、删 manifest 行、乱序 manifest——与 Node collector 测试的拒绝结果一致。

## 已考虑的替代方案

把值扫描拓宽到三形态之外（URL、邮箱、十六进制块）被否决——每拓宽一种形态都放大误报，拒绝健康值的支持工件恰在最需要收集的时刻停止被收集。跨平台共享序列化器（KMP 模块或生成代码）被否决——证明的价值在独立性：共享实现只能与自己一致，而从零端口逐字节一致才是序列化规则真正被规格与 README 钉住的证据。Kotlin 车道对活 Host 导出运行被暂缓——夹具证明钉住算法；把收集接入 Android 导出流程按需跟进，§41 快照路径已示范 wire 取数。Swift 车道与历代同因留在外部：CI synchronize 缺口使本地不可验证即不主张。

## 后果

recorder 只写擦洗后文本；bundle 拒绝携带形态的值；畸形戳令加载失败。TS spec 43/43（九个新用例：§42 审计覆盖记录 message 中三形态的擦洗、擦洗幂等、加载期戳拒绝；§43 覆盖逐形态值拒绝与候选自校验）。Kotlin 车道 JVM 上对同一份夹具字节 5/5；真机验收与 Swift 车道留在外部台账、不予主张。本代之后 §41-44 族行剩余：仅外部验收车道。
