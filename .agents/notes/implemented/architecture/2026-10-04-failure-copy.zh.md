# Agent Note：第 45 节 Client 表面共享 Remote 失败文案

状态：已实现

[English](2026-10-04-failure-copy.md) | 中文

## 问题

第 45 节要求所有 Client 对同一错误呈现相同语义。typert 失败词汇表已完成分类，且四个表面在消费——但各自携带不完整的键族，而普查发现五簇把 Remote 失败渲染为裸 `message (code)` 文本：composer 的 steer 通知（队列 dock 已对同一 Steer 失败分类——一个特征内同一操作两种语义）、prompt 失败 toast（两个 attachment 码语义化、其余全裸）、GoalBar 的动作错误、workspace 浏览器的三个重命名/删除对话框、模型选择器的 `code: message` 字符串。

## 决策

- canonical 文案落在 **common 词汇表**：九键（`failure.authentication` … `failure.raw`），zh/en 双语，加入 `client-locale` 内置词典——一份词典一个家，无逐包复制可漂移。两个层级使其处处可达：类型面把 `CommonKeyOf` 并入每个 `LocaleKeysOf<N>`，运行时查找链在条目命名空间未命中后咨询 `common`。
- `remoteFailureCopy(error, t)` 经 typert 词汇分类并返回类文案；`unknown` 类与非 Remote 值把原始诊断经 `failure.raw` 模板呈现——原样可见，绝不编造。`remoteFailureClassCopy(cls, message, t)` 服务于写入时分类的 store（无翻译器的 store 携带类字段）。参数是按 `FailureCopyKey` 取键的翻译函数——任意命名空间绑定的翻译函数结构性满足，采用 helper 即由类型检查强制词典覆盖。
- 迁移簇：steer 通知（与队列 dock 语义一致）、prompt toast（attachment 码保留按 reason 分键的产品文案；其余全分类）、GoalBar（goal 本地失败码走 raw 模板——其产品文案属开放工作）、workspace 三对话框（会话重命名的 `conflict` 特例保留特征文案——严格更精确于类文案、同族不冲突）、模型选择器（双 store 携带 `errorClass`、三渲染点类优先）。

## 备选方案

- **共享注册命名空间供各表面绑定：**每个消费者需要服务访问；common 兜底已通过既有 `t` 座位提供同等可达性。
- **逐包键族（现状）：**每表面五份新翻译、必然漂移；规格要的是一个语义，不是五份。
- **存储 raw `code: message` 并在渲染时分类：**翻译器存在时 store 已丢码；在 store 写入时分类保持状态可序列化且无翻译器依赖。

## 影响

- 迁移表面的用户可见文案不再出现 `(code)` 后缀；unknown 码原样保留 provider 消息。直构 `LocaleRuntime` 的装配级测试现在注册 common 词典，对齐浏览器入口的 `apply`。
- 既有分类消费面不动；其键族仍是有效的特化。

## 开放工作

- provider 码域（持久 `turn/end` 失败）是开放域，不属 §45 封闭词汇；其中仅 `AUTH` 已本地化。审批应答失败静默、文件上传附件状态存储从不渲染的裸消息。其余 Remote 表面（sidebar files/preview 的逐码 switch、ChatView 休眠的 open-file 对话框）可在后续梯队采用 helper。
