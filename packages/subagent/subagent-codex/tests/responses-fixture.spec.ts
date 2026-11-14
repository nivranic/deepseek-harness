import { afterEach, expect, it } from 'vitest'
import { startResponsesFixture, type ResponsesFixture } from './responses-fixture.ts'

const fixtures: ResponsesFixture[] = []
const command = { kind: 'functionCall', name: 'exec_command', arguments: { cmd: 'fixture command' } } as const
const functions = ['exec_command', 'write_stdin'].map(name => ({ type: 'function', name }))

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.close()))
})

async function start(script: Parameters<typeof startResponsesFixture>[0]): Promise<ResponsesFixture> {
  const fixture = await startResponsesFixture(script)
  fixtures.push(fixture)
  return fixture
}

async function post(fixture: ResponsesFixture, input: unknown[] = [], tools = functions) {
  const response = await fetch(`${fixture.baseUrl}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input, tools }),
  })
  const text = await response.text()
  const events = response.ok
    ? text.split('\n').filter(line => line.startsWith('data: {'))
      .map(line => JSON.parse(line.slice(6)) as Record<string, unknown>)
    : []
  const completed = events.find(event => event.type === 'response.completed')?.response as {
    output: { type: string; call_id?: string; name?: string; arguments?: string; content?: { text: string }[] }[]
  } | undefined
  return { status: response.status, text, item: completed?.output[0] }
}

function output(callId: string, text: string) {
  return { type: 'function_call_output', call_id: callId, output: text }
}

it('assigns a unique call id to each emitted function call', async () => {
  const fixture = await start([command, command])
  const first = await post(fixture)
  const second = await post(fixture)
  expect(first.item?.call_id).toBeTruthy()
  expect(second.item?.call_id).toBeTruthy()
  expect(second.item?.call_id).not.toBe(first.item?.call_id)
})

it.for(['Process exited with code 0', 'Exit code: 0'])('completes only after the matching command reports %s', async (status) => {
  const fixture = await start([command, { kind: 'completeAfterCommand', text: 'finished' }])
  const first = await post(fixture)
  const completed = await post(fixture, [output(first.item!.call_id!, `Wall time: 0.1 seconds\n${status}\nFinal output:\nvalue`)])
  expect(completed.status).toBe(200)
  expect(completed.item?.content).toEqual([expect.objectContaining({ text: 'finished' })])
})

it('follows repeated yielded sessions using each new call id before completing', async () => {
  const fixture = await start([command, { kind: 'completeAfterCommand', text: 'finished' }])
  const first = await post(fixture)
  const history = [output(first.item!.call_id!, 'Wall time: 0.1 seconds\nProcess running with session ID 42\nFinal output:\npartial')]
  const poll = await post(fixture, history)
  expect(poll.item?.name).toBe('write_stdin')
  expect(JSON.parse(poll.item!.arguments!)).toEqual({ session_id: 42, chars: '', yield_time_ms: 1000 })
  expect(poll.item?.call_id).not.toBe(first.item?.call_id)
  history.push(output(poll.item!.call_id!, 'Wall time: 1 seconds\nProcess running with session ID 42\nFinal output:\n'))
  const secondPoll = await post(fixture, history)
  expect(secondPoll.item?.name).toBe('write_stdin')
  expect(secondPoll.item?.call_id).not.toBe(poll.item?.call_id)
  history.push(output(secondPoll.item!.call_id!, 'Wall time: 0.1 seconds\r\nProcess exited with code 0\r\nFinal output:\r\ndone'))
  const completed = await post(fixture, history)
  expect(completed.item?.content).toEqual([expect.objectContaining({ text: 'finished' })])
})

it.for([
  'Process exited with code 7\nFinal output:\nProcess exited with code 0',
  'Process exited with code 00\nFinal output:\n',
  'Process exited with code 0abc\nFinal output:\n',
  'Process exited with code -1\nFinal output:\n',
  'Wall time: 1 seconds\nFinal output:\nExit code: 0',
  'Process running with session ID 42\nProcess exited with code 0\nFinal output:\n',
  'Process running with session ID 9007199254740993\nFinal output:\n',
  'command still pending',
])('rejects incomplete or unsuccessful command metadata: %s', async (text) => {
  const fixture = await start([command, { kind: 'completeAfterCommand', text: 'false success' }])
  const first = await post(fixture)
  const result = await post(fixture, [output(first.item!.call_id!, text)])
  expect(result.status).toBe(400)
  expect(result.text).toContain('no successful terminal result')
})

it('rejects a yielded command when write_stdin is not advertised', async () => {
  const fixture = await start([command, { kind: 'completeAfterCommand', text: 'false success' }])
  const first = await post(fixture)
  const result = await post(fixture, [output(first.item!.call_id!, 'Process running with session ID 42\nFinal output:\n')], [])
  expect(result.status).toBe(400)
})

it.for(['missing', 'foreign', 'duplicate'] as const)('rejects %s output for the emitted command', async (mode) => {
  const fixture = await start([command, { kind: 'completeAfterCommand', text: 'false success' }])
  const first = await post(fixture)
  const item = output(mode === 'foreign' ? 'unrelated' : first.item!.call_id!, 'Exit code: 0\nOutput:\n')
  const result = await post(fixture, mode === 'missing' ? [] : mode === 'duplicate' ? [item, item] : [item])
  expect(result.status).toBe(400)
})

it('rejects completion without a preceding function call', async () => {
  const fixture = await start([{ kind: 'completeAfterCommand', text: 'false success' }])
  const result = await post(fixture, [output('unrelated', 'Exit code: 0\nOutput:\n')])
  expect(result.status).toBe(400)
})
