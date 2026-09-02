# Agent Note: 遥测匿名用户 id（$DSH_HOME/.anonymous-user-id）与 OTel Resource 的 user.id

Status: implemented

[English](2026-07-31-telemetry-anonymous-user-id.md) | 中文

## 问题

session telemetry 已默认挂载（[默认挂载 Note](2026-07-31-web-telemetry-default-mount.zh.md)），但 OTel Resource 只有 `service.name`/`service.version`，没有任何用户级标识——接收端无法按用户聚合、无法数活跃用户。此前唯一相关口径是一条未实现的「hostname/本机 IP 哈希派生 user.id」裁定。需要给 OTel 回流一个语义干净的匿名用户身份。

## 决策

`@deepseek-ai/dsh-anonymous-user-id` 在 `$DSH_HOME/.anonymous-user-id`（`resolveDshHome` 解析，`$DSH_HOME` > `~/.dsh`）中持久化一个私有 256-bit 随机根种子。不同 HMAC 域分别派生 UUID 形态的公开 `AnonymousUserId` 与 Session 遥测假名所用密钥。`getOrCreateAnonymousUserId()` 只返回公开值；`getOrCreateAnonymousIdentity()` 返回该值与纯 Session 假名函数，绝不返回根种子或派生密钥。OTel 后端把公开 id 作为 Resource 的 `user.id` 随每批导出携带一次；`/feedback` 与[直连 DeepSeek 请求身份](2026-08-11-deepseek-request-user-id-header.zh.md)使用同一公开值。旧裸 UUID 已经导出过，因此会轮换而不能成为 secret 密钥材料。

| 裁定 | 取值 | 理由 |
|---|---|---|
| 身份来源 | 随机 256-bit 根种子，绝不从 hostname、网络地址或 git remote 派生 | 安装数据不得让身份可反查 |
| 存储形态 | `.anonymous-user-id` 中一行 `v1:<64 个十六进制字符>` 根种子；POSIX 只接受当前用户拥有、group／other 均无权限的普通文件 | 一个私有来源派生所有公开或用途限定的关联值，且不读取已经暴露的内容 |
| 读写形态 | 同步 IO + 进程内按解析后文件路径 memo | `OpenTelemetrySessionBackend` 构造函数是同步的（async 迫使插件装载改形）；每个进程解析一次 identity，运行中删文件不影响本进程 |
| 并发首启 | 写入并 flush 同目录随机 `0600` 文件，通过禁止替换的硬链接发布完整 inode，再安全重读胜者 | 不会有进程观察到已发布的半成品根种子；落败或失败进程会采用有效胜者，或保留私有内存材料 |
| 轮换 | 通过禁止替换的硬链接发布或采用一个完整私有 `.anonymous-user-id.rotate` claim，确认当前目标，以原子方式把共享 claim 移至其路径，再安全重读 | 相互配合的轮换进程采用同一种子，中断的进程留下可恢复的完整 claim，旧格式、损坏、超限或暴露的内容不能成为密钥材料 |
| Windows 访问控制 | 拒绝符号链接形态与非普通最终路径；新文件继承 harness home 的 DACL | Node.js mode bit 无法验证 DACL，因此自定义 `DSH_HOME` 必须由运维方保护 |
| 丢失语义 | 文件被删 → 下次启动生成新根种子与派生身份 | 匿名身份没有恢复要求 |
| 写失败 | best-effort 返回内存 id | 遥测绝不因 home 只读被阻塞 |
| 上报位置 | Resource 属性，非逐条 attributes | 每批一次即够接收端按 Resource 维度聚合；逐条注入要动 seam 约定且涨 wire 体积 |
| Session 关联 | 使用由私有根种子派生的 Session 专用密钥执行 HMAC | 已导出的 `user.id` 无法推导或字典探测可预测 Session id |
| semconv 依赖 | 不引 `@opentelemetry/semantic-conventions` 包 | 一个字符串常量不值一个依赖 |
| 落点 | `@deepseek-ai/dsh-anonymous-user-id`，由 OTel 后端、`/feedback` 与直连 DeepSeek 请求共享 | 消费方共用同一存储契约，且不依赖导出后端 |
| 单独开关 | 无 | 任一消费方都可创建该身份；`DSH_TELEMETRY_DISABLED` 会停止遥测上报，但不会禁用反馈确认或 DeepSeek 请求头 |

## 考虑过的替代方案

| 被拒 | 一句话理由 |
|---|---|
| hostname/IP 哈希派生 id（此前口径） | 可反查即非匿名；随机 UUID 语义干净，用户已裁定取代此前口径 |
| user.id 放每条 record 的 attributes（Claude Code 形态） | 要动 session-telemetry seam 约定或逐条注入，wire 体积涨；Resource 每批一次已满足聚合 |
| 在 `/feedback` 需要该 id 之前抽取共享包（初版实现） | 当时唯一的真实消费方是 OTel 后端；只有直接反馈需要同一个关联 id 后，抽取才具备依据 |
| AppCLIEntry 读好 id 经 config patch 注入 | 每个 surface 入口都要接线；config 里传运行时事实与部署配置混淆 |
| 挂进 `@deepseek-ai/dsh-home-paths` | paths 是纯路径计算零 IO；带持久化的身份能力会污染包边界 |

## 后果

- 一个 `$DSH_HOME` 产生一个稳定公开用户 id 与一个稳定 Session 假名命名空间；独立初始化的 home 之间没有关联机制，除非运维方复制或共享私有根种子。
- OTel Resource、`/feedback` 与直连 DeepSeek 请求共享公开 id，只有 identity 包能产生 Session 假名。
- 删除 `.anonymous-user-id` 会在下次启动时重置所有派生身份；home 不可写时，每个进程使用一个未持久化的私有根种子。
- 读取旧裸 UUID 会轮换一次公开 id，并通过共享的禁止替换 claim 把文件替换为带版本的私有材料。
- 检查会在发布前拒绝符号链接形态、非普通、不可读、无效 claim 与已经变化的路径；该进程会在安全时使用共享 claim，否则使用未持久化根种子。暴露或超限的普通文件会通过共享 claim 在不读取内容的情况下轮换。Node 没有按 device 与 inode 执行的跨平台 compare-and-replace syscall：能写 harness home 的进程可以在最终检查与 rename 之间替换目录项。rename 绝不会跟随符号链接或写入其目标，但可以替换该目录项。Windows 保密性与这一步最终路径完整性依赖 harness home DACL，因为 Node.js 无法通过 mode bit 验证它。进程在清理前终止时可能留下 identity 解析会忽略的 owner-only 随机 `.tmp` 同目录文件。
