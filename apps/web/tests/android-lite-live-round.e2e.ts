/** Live multi-round Lite request-shape round (specification §31) against the real DeepSeek API through the production Kotlin loop. */
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { startAndroidGatewayDriver } from './android-gateway-driver.ts'

/** One folded conversation row as the driver's liteRound op emits it. */
interface RoundRow { role: string; text: string }

/** One folded tool invocation as the driver's liteRound op emits it. */
interface RoundToolCall { name: string; arguments: string; phase: string; resultText: string }

/** The liteRound summary: the folded state of one driven turn plus the request-face facts it assembled from the bundled documents. */
interface LiteRoundSummary {
  presetId: string
  systemPrompt: string
  toolSchemaNames: string[]
  conversation: RoundRow[]
  toolCalls: RoundToolCall[]
  lastTurnEnd: string
  errors: Array<{ kind: string; code: string; message: string }>
  pendingHandoff: string
}

// Double-gated owner-local lane: the real API credential (repo e2e convention,
// self-skip without it) plus the Java 17 executable that runs the compiled
// Kotlin driver (android-tool-catalog.e2e.ts precedent). CI never sets either.
it.skipIf(!process.env.DEEPSEEK_API_KEY || !process.env.DSH_ANDROID_JAVA)('the real DeepSeek API accepts the Lite multi-round request shape and answers a closed calculator turn', async () => {
  // The bundled-preset fidelity references: the same projection documents the
  // APK freezes, read from the repo sources the build bundles.
  const presets = JSON.parse(await readFile(
    fileURLToPath(new URL('../../../packages/preset/agent-presets/lite-preset-descriptors.json', import.meta.url)), 'utf8'),
  ) as { presets: Array<{ id: string; order: number; assembledSystemPrompt: string }> }
  const hostSchemas = JSON.parse(await readFile(
    fileURLToPath(new URL('../../../packages/core/tools/lite-tool-schemas.json', import.meta.url)), 'utf8'),
  ) as { tools: Array<{ name: string }> }
  const deviceSchemas = JSON.parse(await readFile(
    fileURLToPath(new URL('../../../apps/android/app/lite/lite-device-tool-schemas.json', import.meta.url)), 'utf8'),
  ) as { tools: Array<{ name: string }> }
  const defaultPreset = presets.presets.reduce((a, b) => (a.order <= b.order ? a : b))

  const driver = await startAndroidGatewayDriver(process.env.DSH_ANDROID_JAVA!)
  try {
    // One driven turn over the real endpoint: the driver assembles the session
    // from the APK-bundled documents and submits a prompt whose tool use the
    // model cannot reasonably skip. A live model round outlives the driver
    // helper's 15-second default, so the wait stretches to two minutes.
    const round = await driver.request({
      op: 'liteRound',
      endpoint: `${process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'}/chat/completions`,
      apiKey: process.env.DEEPSEEK_API_KEY!,
      model: 'deepseek-v4-flash',
      prompt: '请使用 calculator 工具计算 17*23，然后用一句话告诉我结果。',
    }, 120_000)
    expect(round.type).toBe('ok')
    const summary = round.value as LiteRoundSummary

    // The request face assembled from the APK-frozen bytes: the default
    // preset's assembled system prompt and the host+device schema union in
    // bundle order (the host projection ahead of the device document).
    expect(summary.presetId).toBe(defaultPreset.id)
    expect(summary.systemPrompt).toBe(defaultPreset.assembledSystemPrompt)
    expect(summary.toolSchemaNames).toEqual([...hostSchemas.tools.map(tool => tool.name), ...deviceSchemas.tools.map(tool => tool.name)])

    // The multi-round closure on the real API. The loop lands exactly one
    // assistant row per completed request and only issues the next request
    // when a round finished `tool_calls`, so two or more assistant rows on a
    // completed turn prove the continuation request — the one replaying the
    // assistant tool_calls row and its role:tool result rows as history —
    // was served, not refused as a malformed request.
    expect(summary.conversation[0]?.role).toBe('user')
    const assistantRows = summary.conversation.filter(row => row.role === 'assistant')
    expect(assistantRows.length).toBeGreaterThanOrEqual(2)
    const finalText = assistantRows.at(-1)?.text ?? ''
    expect(finalText.length).toBeGreaterThan(0)

    // At least one calculator call completed through the on-device executor,
    // and the answer value rode the exact calculator result or the model's
    // final text — no verbatim assertions over model prose (17*23 = 391).
    const calculatorCalls = summary.toolCalls.filter(call => call.name === 'calculator' && call.phase === 'completed')
    expect(calculatorCalls.length).toBeGreaterThanOrEqual(1)
    expect(calculatorCalls.some(call => call.resultText === '391') || finalText.includes('391')).toBe(true)

    // Zero provider/network failure classifications (timeout, unreachable,
    // dropped, HTTP refusals all fold into errors) and no handoff marker: the
    // whole turn closed clean.
    expect(summary.lastTurnEnd).toBe('completed')
    expect(summary.errors).toEqual([])
    expect(summary.pendingHandoff).toBe('')
    expect(await driver.stop()).toBe(0)
  } finally {
    await driver.kill()
  }
}, 150_000)
