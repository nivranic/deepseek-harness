/** Keyless wire diagnostics from the shipped Web Loader composition. */
import { mkdir, writeFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import type { ServerResponse } from '@deepseek-ai/dsh-client-connection'
import { launchWebScaffold } from './scaffold.ts'

it('returns portable validation diagnostics without accepting invalid operations', async () => {
  const scaffold = await launchWebScaffold()
  const observations: unknown[] = []
  let userMessages = 0
  scaffold.ctx.on('session/event', (_session, event) => {
    if (event.type === 'user/message') userMessages++
  })
  try {
    const requests = [
      { method: 'credentials/describe', args: { refs: ['invalid reference'] } },
      { method: 'settings/update', args: { ns: '', patch: {} } },
      { method: 'subagents/list', args: { parentSessionId: '' } },
      { method: 'directoryPicker/createDirectory', args: { path: scaffold.workspaceCwd, name: '' } },
    ]
    for (const request of requests) {
      const response = await scaffold.hostFetch(`/api/${request.method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'validation', method: request.method,
          payload: { args: request.args } }),
      })
      expect(response.status, request.method).toBe(200)
      const envelope = await response.json() as ServerResponse
      expect(envelope.result.ok).toBe(false)
      if (envelope.result.ok) throw new Error('invalid request was accepted')
      expect(envelope.result.error.code).toBe('gateway/bad-request')
      const details = envelope.result.error.details as { issues: Record<string, unknown>[] }
      expect(details.issues.length).toBeGreaterThan(0)
      for (const issue of details.issues) expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path'])
      observations.push({ method: request.method, error: envelope.result.error })
    }
    const malformed = await scaffold.hostFetch('/api/credentials/describe', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rpcId: 'malformed' }),
    })
    const envelope = await malformed.json() as ServerResponse
    expect(envelope.result.ok).toBe(false)
    if (envelope.result.ok) throw new Error('malformed envelope was accepted')
    expect(envelope.result.error.code).toBe('gateway/bad-request')
    const details = envelope.result.error.details as { issues: Record<string, unknown>[] }
    expect(details.issues.length).toBeGreaterThan(0)
    for (const issue of details.issues) expect(Object.keys(issue).sort()).toEqual(['code', 'message', 'path'])
    observations.push({ method: 'invalid-envelope', error: envelope.result.error })
    expect(userMessages).toBe(0)
    expect(observations).toMatchSnapshot()
    await mkdir('.artifacts', { recursive: true })
    await writeFile('.artifacts/remote-validation-details-host.json', JSON.stringify({ observations, userMessages }, null, 2) + '\n')
  } finally {
    await scaffold.close()
  }
})
