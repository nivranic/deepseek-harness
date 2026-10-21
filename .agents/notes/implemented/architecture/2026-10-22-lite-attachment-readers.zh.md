# Agent Note: attachment_read 与 image_inspect 同代落成配对的 Lite 附件读取器

Status: implemented

[English](2026-10-22-lite-attachment-readers.md) | 中文

## 问题

[配对规则](2026-10-18-lite-local-tool-executors.zh.md)把 `attachment_read` 与 `image_inspect` 留成已声明但不可达的名字——无同代设备 schema 的执行器只有幻觉可达性——gen-66/gen-67 又钉死了更深的阻塞：没有 intake 生产者，随后 [intake](2026-10-22-lite-attachment-intake.zh.md) 本体落地并把请求面决策显式缓行到本代，与两枚执行器及其 schema 配对。store 已就位后，两个问题必须一起回答：执行器读什么、怎么读；被收附件在 provider 请求面上意味着什么。

## 决策

关掉这对配对，并把请求面问题定案为「工具读、prompt 永不携带」。两枚 schema 进入 `lite-device-tool-schemas.json`，与早已声明 `supportsLite` 的设备声明并排（两者皆 low 风险、空权限——同代配对在一个增量内满足）。`attachment_read` 解析 `{"name": string}`、经 store 的 listing 面解析条目（留存的 mediaType 只活在那里）并按其分流：文本类型——url_fetch 已有的词汇，任意 `text/*` 加 json/xml/yaml/javascript application 子类型与 `+json`/`+xml` 后缀，常量从 url_fetch 私有更名为共享的 `TEXTUAL_APPLICATION_SUBTYPES`——在新的 `ATTACHMENT_READ_CONTENT_LIMIT_BYTES = 64 KiB` 帽内按声明字符集解码（拒绝而非截断：模型绝不能把前缀当成整篇文档；独立于 intake 的 8 MiB，因为那约束设备留存什么、这约束一个模型回合的结果）；其余一切类型——包括 okhttp 解析不出的留存 mediaType——以二进制拒绝并点名留存值；corrupt sidecar 的 fail-loud `IllegalStateException` 以自己的 fail-soft 事实作答，绝不向循环抛出。`image_inspect` 解析同形参数、嗅探字节签名——PNG/JPEG/GIF/WebP 照宿主 `read_image` 嗅探器，外加 HEIF 家族的 `ftyp` major brand（heic、heix、hevc、hevx、heim、heis、hevm、hevs、mif1、msf1）——报告嗅探出的格式（留存 mediaType 绝不触达此工具）、宽高像素与留存字节数，一行成文。像素尺寸经注入的 `LiteImageBoundsReading` 缝读取、返回 `LiteImageBounds?`：执行器所在模块是 JVM-only（`kotlin("jvm")`，classpath 无 android.jar），故 BitmapFactory 的 `inJustDecodeBounds` 面——只读元数据不解码像素——落在 MainActivity 里成为私有 `LiteAndroidImageBounds` 对象，JVM 测试自备读取器；嗅探通过后读到 null 尺寸与嗅探失败作答同一句不可识别拒绝。MainActivity 的 `when(name)` 在 lite-open 分支既有的 `liteAttachments` store 上加两分支。本代拥有的请求面决策：被收附件只是工具的读取面、别无其他——模型经 tool call 按名触达、tool result 以类型化历史回喂、任何被收内容绝不随 prompt 或 provider 请求行上行（calculator/url_fetch 的闭环形态；独立 Lite 会话本就没有可上传的 wire）。

## 备选方案

把附件字节、甚至名字清单收进 provider 请求被拒——那是 gen-67 缓行至此的决策，而 tool call 闭环已回答它：模型按名读、结果以类型化历史回返，prompt 携带字节会把请求预算花在用户未必问及的内容上。帽上截断被拒——无声前缀诱使模型当成整篇文档；refuse-at-cap 形态与 artifact_create、url_fetch 一致并报出数字。从执行器模块直接调用 BitmapFactory 不是不智、是不可能——core 是 JVM-only 模块，而把 image_inspect 整体搬进 app 模块会使其评估脱离 JVM 套件；注入的单方法缝把分界钉在恰好那条依赖 android 的指令上。image_inspect 咨询留存 mediaType 被拒——provider 声明的类型可能报错字节，嗅探才是诚实事实。为两枚调用加 conformance fixture 判定为不必——两者都是 fixture 家族已有泛形钉定的标准 tool/call + tool/result 形状，元数据行在 JVM 套件内断言。

## 后果

五枚本地 Lite 名字如今成对携带执行器、schema 与声明——gen-62 台账的缓行对关闭。执行器每个分支都在 JVM 测试下评估（这条缝令 image_inspect 可离线全测，不同于 url_fetch 的真实传输）：LiteToolExecutorsTest 15 -> 23 新增八测——两读取器的畸形参数、按名缺席、声明与默认字符集的文本解码、点名留存类型的二进制拒绝（含 intake 默认值与不可解析类型）、64 KiB 边界、签名表（七个正形；文本字节、截断 GIF 头、无 WEBP 的 RIFF 容器、家族外 `ftyp` brand、空字节为负例）、固定尺寸读取器下的元数据行含 null 尺寸与嗅探门拒绝。core JVM 测试：597 -> 605、85 套件、零失败；contract 维持 4 套件 / 37 测。androidTest 面编译通过（`:app:assembleDebugAndroidTest`）——不声称任何真机轮，BitmapFactory 面只在彼处被锻炼。被收附件对 journal、fold 词汇与 provider 请求保持不可见——与 gen-67 一致。

## 开放跟进

相机 intake 来源继续缓行（gen-67 的跟进把它列在这里；仍在本次增量之外，需要配对相机链的清理机械）；工具行 journal 持久化仍留 chapter-64 决策；真机图片实轮（真实图片字节过 BitmapFactory）待连接设备验收车道存在时随行。
