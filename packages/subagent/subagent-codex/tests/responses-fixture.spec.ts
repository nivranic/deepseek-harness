/** Scripted model responses wait for yielded commands before declaring completion. */
import { afterEach, expect, it } from 'vitest'
import { startResponsesFixture, type ResponsesFixture } from './responses-fixture.ts'

let fixture: ResponsesFixture | undefined
afterEach(async () => { await fixture?.close() })

async function output(text: string, advertiseWait = true) {
  const response = await fetch(`${fixture!.baseUrl}/responses`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tools: advertiseWait ? [{ type: 'function', name: 'write_stdin' }] : [],
      input: [{ type: 'function_call_output', output: text }] }),
  })
  return { status: response.status, body: await response.text() }
}

it('follows each yielded session ID and completes only after successful exit', async () => {
  fixture = await startResponsesFixture([{ kind: 'completeAfterCommand', text: 'done' }])
  const first = await output('Process running with session ID 42\nOutput:\n')
  expect(first.body).toContain('write_stdin')
  expect(first.body).toContain('session_id\\":42')
  expect(first.body).not.toContain('output_text.delta')
  const second = await output('Process running with session ID 42\nOutput:\n')
  expect(second.body).toContain('call_fixture_2')
  const final = await output('Process exited with code 0\nFinal output:\n')
  expect(final.body).toContain('output_text.delta')
  expect(final.body).toContain('done')
})

it.each(['Exit code: 1', 'Process exited with code 10', 'unrecognized output'])('rejects %s instead of claiming success', async (text) => {
  fixture = await startResponsesFixture([{ kind: 'completeAfterCommand', text: 'done' }])
  expect((await output(text)).status).toBe(400)
})

it('refuses an active command when the product did not advertise its wait tool', async () => {
  fixture = await startResponsesFixture([{ kind: 'completeAfterCommand', text: 'done' }])
  expect((await output('Process running with session ID 42', false)).status).toBe(400)
})

it('accepts a synchronous shell command exit', async () => {
  fixture = await startResponsesFixture([{ kind: 'completeAfterCommand', text: 'done' }])
  expect((await output('Exit code: 0\nOutput:')).body).toContain('done')
})
