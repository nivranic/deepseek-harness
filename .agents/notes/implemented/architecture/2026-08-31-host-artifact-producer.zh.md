# Agent Note: 宿主工件生产方

Status: implemented

[English](2026-08-31-host-artifact-producer.md) | 中文

## 问题

工件词汇先行落地时没有生产方：宿主没有代码创建工件或记录事件，面板仍只是"原则上可消费"，`LinkSessionEventKind` 也仍列旧标签而无活事件可观察。第 56 章钉死了生产方必须遵守的切分——日志携带引用、元数据与状态；内容字节活在资源通道里。

## 决策

`dsh-artifact` 从纯词汇长为缝主：`ctx.artifacts`（`ArtifactStore`：按引用 id 的 `put`/`get`/`remove`——与 Lite 存储暴露的形状相同）加模型可见的 `artifact_create` 工具。一次调用创作一件完整工件：工具要求有归属的 agent 会话，修剪并校验 `kind` 与 `title`，铸造 `art-<uuid>`，记录 `artifact/created`，经通道写入 UTF-8 字节，再记录 `artifact/status`——成功 `ready`，否则记录 `failed` 并透出通道错误。`dsh-artifact-local` 是出厂通道：`<DSH_HOME>/artifacts` 下每引用一个原子 `<id>.artifact` 文件（属主私有权限，独占创建的临时文件改名覆盖目标——`writeFileAtomic` 为此获得 `Uint8Array` 内容支持），缺席读为 null，删除静默。持久不变量伴随强制事件形状（非空且已修剪的类别与标题、封闭状态集）与开回合关系，对孤儿状态有意沉默——每个折叠里的合法 no-op。`LinkSessionEventKind` 增长两个工件标签（现 15 个），经既有漂移门禁再生进 Swift 与 Kotlin 模型；原生折叠零改动——它们已消费原始事件记录。出厂 base bundle 挂载工具与后端（`dsh-artifact` + `dsh-artifact-local` 两行，依赖已声明）；工具 schema 目录在抛弃式 home 上引导真实配对并文档化生成的 schema；录制会话快照不动——没有既有快照组合挂载新工具。

## 后果

模型现在能端到端产出一等工件：日志可回放、伴侣可渲染，字节在宿主上持久。远程工件面板在配对设备跟随一个调用该工具的会话的当下即活。剩余：后续会话的读取面（`artifact_read` 或线读取）、二进制工件输入、已存字节的保留策略。

## 考虑过的替代方案

内容寻址存储（attachment 族的模型）被延后——工件按调用在铸造的引用 id 下创作，保留策略存在前去重无收益；id 键控的通道转而镜像 Lite 存储，保持缝跨运行时对称。把内容内联进日志（或事件里 base64）被直接否决——第 56 章禁止内容上日志。为中继的离线设备排队状态事件不在范围——工件的存在性随日志回放传播，不随推送。
