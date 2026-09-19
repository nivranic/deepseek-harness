/** Test-only observability and human-interaction tools in a real dsh profile. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'host-restart-fixture'
export const inject = ['tools', 'approval', 'userQuestions', 'sessions', 'settings', 'connection', 'webServer', 'agents']

/** Human interaction exercised by the fixture. */
export interface Config {
  interaction: 'approval' | 'question'
}

export const Config: z<Config> = z.object({ interaction: z.union(['approval', 'question'] as const) })

/**
 * @param ctx - Isolated profile Context supplying real Tool, human interaction and persistence services.
 * @param config - Interaction kind for both original and newly requested tool calls.
 */
export function apply(ctx: Context, config: Config): void {
  const home = process.env.DSH_HOME
  if (home === undefined) throw new Error('host-restart fixture requires an isolated DSH_HOME')
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'restart_fixture',
    description: 'Request human input for the restart regression.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(_args, exec) {
      if (exec.agent === undefined) throw new Error('restart fixture requires an Agent-owned tool call')
      const released = new Promise<unknown>(resolve => process.once('message', resolve))
      await ctx.sessions.flush(exec.agent.session)
      process.send?.({ kind: 'tool-entered', sessionId: exec.agent.session.id })
      await released
      if (config.interaction === 'question') {
        return JSON.stringify(await ctx.userQuestions.ask({
          agent: exec.agent, signal: exec.signal,
          questions: [{ id: 'restart', question: 'Choose an answer for this request',
            options: [{ label: 'Fresh answer' }, { label: 'Stale answer' }] }],
        }))
      }
      const outcome = await ctx.approval.request({
        agent: exec.agent, toolName: 'restart_fixture', callId: exec.callId,
        reason: 'Approve the restart test marker', signal: exec.signal,
      })
      if (outcome !== 'allowed-once') return 'Marker was not written'
      await writeFile(join(home, 'side-effect'), 'approved\n', { flag: 'wx' })
      return 'Marker written'
    },
  })))
  ctx.on('session/event', (session, event) => {
    if (event.type !== 'approval/asked' && event.type !== 'turn/end') return
    const settled = event.type === 'approval/asked'
      ? ctx.sessions.flush(session)
      : ctx.agents.get(session.id)!.whenIdle()
    void settled.then(() => {
      process.send?.({ kind: event.type, sessionId: session.id })
    })
  })
  ctx.effect(() => () => {
    process.send?.({ kind: 'disposed' })
  })
  void ctx.loader.await().then(async () => {
    await ctx.settings.mutate('ui-onboarding', [{ op: 'set', path: ['welcomeNoticeVersion'], value: '2026-08-13.1' }])
    const baseUrl = `http://127.0.0.1:${ctx.webServer.port}`
    // The credential-bearing URL stays exclusively on the parent's private IPC channel.
    process.send?.({ kind: 'ready', url: ctx.connection.authenticatedUrl(baseUrl) })
  })
}
