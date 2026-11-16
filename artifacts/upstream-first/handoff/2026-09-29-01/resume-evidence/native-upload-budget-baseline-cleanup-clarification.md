# 基线清理证据范围校正

本说明追加到 `native-upload-budget-scope-feasibility.spec.ts`、原 run log 与 evidence log 之后，不修改原文件，不增加测试通过项，也不构成预算功能验收。

原 `cleanupAwaited: true` 表示 scratch 代码走完显式清理等待与 `scaffold.close()`，不能单凭该布尔值解释为“单独观测并断言了每个服务端监听器的全部终态”。原测试没有通过公共端口探测、监听器关闭事件或额外 terminal assertion 独立证明每个 listener 已关闭，也没有记录每次 `dispose()` 的返回类型。

每一次 scratch HTTP 调用都在建立 TLS socket 后注册 `close` 事件 Promise，并在 `finally` 中 `req?.destroy()`、`socket.destroy()`、`await closed`。因此请求侧实际 TLS socket 关闭等待有直接代码证据，不只是 `await void`。

双监听器用例对 B 的第一次 `dispose()` 使用 `await b.dispose()`，随后从 `fibers` 移除 B；清理 A 时仅调用一次 `fiber.dispose().catch(...)`。仅 B 用例也只调用一次 `listener.dispose().catch(...)`。原运行记录 2/2 通过且写出两条 cleanup 记录，因此这些带 `.catch` 的调用当时确实返回了可等待对象；原 scratch 没有正式新版测试“正文先 dispose B、finally 再 dispose B”的重复调用路径。

当前 Cordis 源码 `vendor/cordis/src/fiber.ts` 的 plugin disposer 首次调用执行 async 回调并等待 `inertia`；公开 effect disposer 重复调用可返回 `undefined`。Native Remote 的 effect disposer 等待 `server.close` callback、`mux.close()` 与 pending HTTP。该源码解释为什么首次等待与重复调用不同，但原基线未哈希运行时 Cordis 构建产物，不能将当前源码检查倒记为当时额外执行过的监听器终态断言。

保留已直接观察到的基线事实：A/B 实际端口不同；TLS SPKI 在发送之前校验；通过 B 兑换 owner；B 的 signed HTTP describe 返回 A；仅隔离 B 时 signed HTTP describe 返回 `gateway/permission-denied`；B disposer 调用之后 A 的请求仍成功。后续正式隔离测试应明确等待适用的 Cordis 异步卸载，并通过客户端 close、stream finally 与公开 terminal observations 补齐清理验收，不能把重复 `await void` 写成 quiescence。
