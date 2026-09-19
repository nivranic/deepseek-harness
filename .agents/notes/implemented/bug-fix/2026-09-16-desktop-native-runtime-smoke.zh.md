# Agent Note: Desktop 原生检查跟随随包运行时

Status: implemented

[English](2026-09-16-desktop-native-runtime-smoke.md) | 中文

## 问题

Desktop 生产依赖图使用预构建系统原语实现 POSIX Session 锁，在 Windows 上通过 Koffi 使用内核信号量。产物 smoke 仍要求加载已移除的 `fs-ext`，并测试没有生产消费者的文件定位操作。因此 Windows 打包会在安装正确的生产依赖图后失败。生成的 profile 也保留了该包已无必要的构建许可。

## 决策

[产物 smoke](../../../../apps/desktop/tests/fixtures/runtime-payload-smoke.mjs)检查当前 PTY、FFI、图像和 HTML 依赖。[真实 Host smoke](../../../../apps/desktop/scripts/smoke-runtime.ts)加载声明了共享 peer 的外部插件，通过随包持久化服务执行 [Session 锁 fixture](../../../../apps/desktop/tests/fixtures/runtime-session-lease.mjs)。独立后端竞争同一已物化 Session：第二个写入者被拒绝，读取可以继续，释放后后继者获得写权。两个后端均完成清理后，私有完成 marker 才记录成功。只有 Host 和 marker 均通过核对，准备过程才成功。

这种方式通过公开包导入调用当前平台的原生锁实现。[预构建系统决策](../architecture/2026-09-07-prebuilt-system-primitives.zh.md)继续负责 POSIX flock 和保持不变的 Windows 策略。[Desktop 运行时决策](../architecture/2026-09-08-desktop-bundled-runtime-and-external-plugins.zh.md)继续负责包过滤与完整 Host 启动；更新其当前描述，两项决策均未被替代。

生成的 profile 仅为当前随包原生安装脚本提供生命周期构建许可。已移除的包没有默认许可或包专用复制规则。未知资源继续遵循一般复制策略。

## 考虑过的替代方案

**重新加入已移除的包，让 smoke 通过。** 这会在没有生产消费者的情况下恢复安装时编译，并违背预构建运行时设计。

**删除检查且不补充原生操作覆盖。** 仅加载包不能证明 Session 写入者互斥，也不能证明释放后允许后继者获得写权。

**从构建工作区导入私有锁实现。** 这可能验证了源码，却遗漏打包的原生依赖。外部插件从运行时解析公开包及共享 Cordis 实例。

## 影响

运行时准备通过新的 Harness home 和正常 Loader 组合，验证 Host 实际消费的原生操作。生成元数据和拒绝旧包许可有定向测试，完整打包路径提供内置 Node 的执行证据。变更不改变 Session 数据、锁语义、provider 行为或生产超时。每个平台仍须分别进行原生执行和发布验收。
