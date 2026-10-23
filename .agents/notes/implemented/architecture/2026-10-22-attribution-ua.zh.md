# Agent Note: companion 的 provider 请求携带静态 User-Agent；§33 重投影与组合两项以记档决策收口

Status: implemented

[English](2026-10-22-attribution-ua.md) | 中文

## 问题

gen-56（[OkHttp 迁移 note](2026-10-16-lite-http-okhttp-config-face.zh.md)）裁定「归因头（`x-deepseek-harness-*`）保持不加：它们标识的是宿主 harness 自身，与 companion 是不同产品面；最小对齐就是 Bearer、content type 与 accept」，§31 台账以更宽的形态把它留作开放项（归因头决策）。两个事实对该裁定构成压力。其一，宿主强制归因规则（[2026-06-21-mandatory-app-attribution-headers](2026-06-21-mandatory-app-attribution-headers.zh.md)）要求每个产品级 LLM 适配器在每个 provider HTTP 请求上发送静态、非秘密的应用身份，并以 mock 服务器在线上证明——`LiteHTTPProvider` 正是这样的产品级 LLM 适配器（用户自配端点的请求面），规则的措辞没有给 companion 体量的适配器留豁免。其二，「不同产品面」的理由对流量识别不成立：它区分的是两个产品彼此，而不是收到请求的端点运营方眼中的来源——运营方无法区分流量来源时，`User-Agent` 是唯一诚实通道；自配端点同样受益（支持、滥用调查、兼容性调试——宿主规则自列的用途清单）。

## 决策

翻转裁定：`LiteHTTPProvider.stream` 的请求头区在 content-type、accept、authorization 旁增加静态字面 `user-agent: dsh-lite-companion/1.0`（头名照邻位用小写代码形态；线上字段名大小写不敏感）。静态字面照宿主规则的「静态」措辞——绝不读 `BuildConfig` 或运行时版本：宿主适配器经 `createRequire` 从所属包清单读版本，那是 npm workspaces 机制、Android 无对应物，且构建期版本会随每次构建漂移而不增加识别力。显式头同时替换 OkHttp 默认的 `okhttp/<version>` token，线上恰一个身份。保持不加的是宿主的 `x-deepseek-harness-*` 请求身份（DeepSeek 特定决策下的 user 与 session 头）——那是宿主 harness 的请求身份而非产品归因，gen-56 句子对这一族的核心在翻转后依然成立。既有头断言测试（内嵌服务器收到的头钉形）增补 User-Agent 等式；不新增测试类。本代另一半把 §33 两项开放收为记档决策：preset 重投影是条件触发项——excluded 清单（cordis、ptc、standard，因装配段落仍引用 `{{cwd}}`/`{{model}}` 而排除）即触发器的可观测面，宿主侧 preset 摆脱运行时变量后重跑 `gen-lite-preset-catalog` 即收割，而 Lite 侧替代值正是规格所禁的平行 Prompt 系统（original-specification.md:1210）；profile/preset 之外的上下文组合是规格自身的限制而非缺口——规格（original-specification.md:1216-1220）只允许 Lite 通过 profile/preset 组合上下文，任何扩展都是上游规格演进。

## 备选方案

维持 gen-56 不加归因头的裁定被拒——「不同产品面」回答的是流量属于哪个产品，不是端点运营方如何识别它，且宿主规则的「每个适配器」措辞没有 companion 例外。复用宿主 `deepseek-harness` 的 User-Agent token 被拒——companion 是不同产品、有自己的请求身份，借用 harness token 会把 companion 流量错误归因给宿主 harness，恰是 gen-56 点名的混淆、只是方向反过来。token 里用 `BuildConfig` 派生版本被拒——规则要的是静态身份，随构建漂移的版本读起来像规则从未要求的遥测。库默认值与产品 token 并发被拒——`User-Agent` 只有一个字段，显式头是替换 OkHttp 默认值而非在其上叠加。

## 后果

provider 与自配端点看到可识别的 companion 流量（`dsh-lite-companion/1.0`）而非库默认值；请求面其余零移动——journal、fold、十六 tag 闭集未触达。core JVM 测试维持 85 套件 / 608 测零失败（User-Agent 钉形搭载既有 `LiteHTTPProviderTest` 头测试，11 测全绿），contract 维持 4 套件 / 37。gradle 验收轮（scanner env、`-PdshNativeAcceptance`、四任务）BUILD SUCCESSFUL 1m 40s、82 任务其中 9 executed；debug APK 越过 gen-71 基线漂移至新记录基线 `3cb24ecfc2f5a801d02bb439b35386a3db220050943425efb18f4f8199eeebb6`（重编的 core 类重打 debug 面），androidTest APK 以 `0fac30016109b0621c672cb13b4d4a777e1baccfa8abcb09c1ca730d26c3eb69` 字节不变复现——私有的头增补不触 androidTest 打包输入。traceability §33 remaining 的两项开放换成记档决策形态，§31 开放列表摘除归因头决策并记录翻转。

## 开放跟进

归因面本身无开放项。§31 其余开放项不变（chapter-64 决策下的工具行 journal 持久化、与 §38 对齐的审批 ask 档、事实诊断投影、§54 设备端网络验证、多轮请求形状的真模型 e2e），gen-71 的真实空中升级路径 e2e 跟进项照旧。
