/** Shared native follow requests against the shipped Host's generated validator and opening snapshots. */
import { readFile, readdir, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { isTypertRemoteMethod } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import { launchWebScaffold } from './scaffold.ts'

it('accepts shared native opening envelopes and returns a full bounded window on every follow', async () => {
  const scaffold = await launchWebScaffold()
  onTestFinished(async () => { await scaffold.close() })
  const descriptor = scaffold.ctx.typert.local.get('session/follow')
  if (descriptor === undefined || !isTypertRemoteMethod(descriptor)) throw new Error('Session follow has no generated input validator')
  const input = descriptor.input({ strict: true }).create()
  const fixtures = fileURLToPath(new URL('../../apple/contract/fixtures/native-follow-resume/', import.meta.url))
  for (const name of await readdir(fixtures)) {
    if (name.startsWith('invalid-')) continue
    const fixture = JSON.parse(await readFile(join(fixtures, name), 'utf8')) as { body: unknown }
    expect(input.parse(fixture.body), name).toEqual(fixture.body)
  }
  const request = { address: { kind: 'session', sessionId: 'fixture' }, maxMessages: 3 }
  expect(() => input.parse({ request: { ...request, fromSeq: 0 } })).toThrow()
  expect(() => input.parse({ request: {
    ...request, address: { kind: 'subagent', parentSessionId: 'parent', childSessionId: 'child', mode: 'timeline' },
  } })).toThrow()

  const path = join(scaffold.workspaceCwd, 'native-follow')
  await mkdir(path, { recursive: true })
  const { workspace } = await scaffold.ctx.workspaceController.create({ path })
  const { sessionId } = await scaffold.ctx.sessionController.create({ workspaceId: workspace.workspaceId })
  const agent = scaffold.ctx.agents.get(sessionId)
  if (agent === undefined) throw new Error('Native follow fixture has no Agent')
  const append = (text: string): void => {
    agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })
  }
  for (let index = 0; index < 8; index++) append(`before-${index}`)
  const opening = async () => {
    const abort = new AbortController()
    const iterator = scaffold.ctx.sessionController.follow({
      address: { kind: 'session', sessionId }, maxMessages: 3,
    }, abort.signal)[Symbol.asyncIterator]()
    try {
      const frame = await iterator.next()
      if (frame.done === true || frame.value.type !== 'snapshot') throw new Error('Follow must start with a snapshot')
      return frame.value
    } finally {
      abort.abort()
      await iterator.return?.()
    }
  }
  const first = await opening()
  append('after-1')
  append('after-2')
  const second = await opening()
  const firstMessages = first.records.filter(record => record.event.type === 'user/message')
  const secondMessages = second.records.filter(record => record.event.type === 'user/message')
  expect(firstMessages).toHaveLength(3)
  expect(secondMessages).toHaveLength(3)
  expect(secondMessages[0]).toEqual(firstMessages.at(-1))
  expect(secondMessages.slice(1).map(record => record.event.data)).toMatchObject([
    { content: [{ type: 'text', text: 'after-1' }] },
    { content: [{ type: 'text', text: 'after-2' }] },
  ])
  expect(second.cursor).toBe(second.records.at(-1)?.event.seq)
  expect(second.cursor).toBeGreaterThan(first.cursor)
  expect(second.hasMore).toBe(true)
})
