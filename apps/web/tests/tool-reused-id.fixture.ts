/** Replay and private completion observations inside the shipped Web profile. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installLlmReplay } from '@deepseek-ai/dsh-llm-replay'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-agent'

export const name = 'tool-reused-id-fixture'
export const inject = ['llm', 'approval', 'settings', 'connection', 'webServer', 'agents', 'sessions']

/** Recorded model transcript consumed by this profile. */
export interface Config {
  file: string
  browserApproval: boolean
  finalTurn: number
}

export const Config: z<Config> = z.object({ file: z.string(), browserApproval: z.boolean(), finalTurn: z.natural().min(1) })

/**
 * @param ctx - Shipped Web composition with isolated persistence and credentials.
 * @param config - Canonical Session fixture used for keyless model replay.
 */
export function apply(ctx: Context, config: Config): void {
  const replay = installLlmReplay(ctx, {
    file: config.file,
    providers: [{ id: 'deepseek-official', name: 'DeepSeek', models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 128_000 },
    ] }],
  })
  ctx.effect(() => replay.dispose)
  if (!config.browserApproval) ctx.on('approval/request', () => Promise.resolve('allowed-once'), { prepend: true })
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return
    void ctx.agents.get(session.id)!.whenIdle().then(async () => {
      await ctx.sessions.flush(session)
      if (event.data.turn === config.finalTurn) replay.assertConsumed()
      process.send?.({ kind: 'turn/end', turn: event.data.turn, sessionId: session.id })
    }).catch((error: unknown) => {
      process.send?.({ kind: 'failure', error: String(error) })
    })
  })
  void ctx.loader.await().then(async () => {
    await ctx.settings.mutate('ui-onboarding', [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-08-13.1' }])
    // Credential-bearing startup URLs stay on the parent's private IPC channel.
    process.send?.({ kind: 'ready', url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`) })
  })
}
