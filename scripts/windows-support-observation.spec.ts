/** The native verifier receives only the actual Settings request's bounded Connection value. */
import { describe, expect, it } from 'vitest'
import { readConnectionObservation } from './release/windows-support-observation.ts'

function request() {
  return { type: 'client-request', rpcId: 'private-correlation-id', method: 'desktopSupport/export',
    payload: { args: { connection: { state: 'connected', attempts: 1, interruptions: 0, countsSaturated: false } } } }
}

describe('Windows renderer Connection observation', () => {
  it('captures the sent value without exposing wire metadata or later caller changes', () => {
    const input = request()
    const snapshot = readConnectionObservation(input)
    input.payload.args.connection.attempts = 2
    expect(snapshot).toEqual({ state: 'connected', attempts: 1, interruptions: 0, countsSaturated: false })
    expect(JSON.stringify(snapshot)).not.toContain('private')
  })

  it.each(['envelope', 'payload', 'args', 'connection'] as const)('refuses additional %s fields without exposing values', (level) => {
    const input = request()
    const target = { envelope: input, payload: input.payload, args: input.payload.args, connection: input.payload.args.connection }[level]
    Object.assign(target, { private: 'unapproved-content' })
    expect(() => readConnectionObservation(input)).toThrow(/^Windows renderer connection observation was not accepted$/)
  })

  it.each([
    { attempts: -1 }, { attempts: 0.5 }, { attempts: 0x1_0000_0000 }, { attempts: true },
    { interruptions: 2 }, { countsSaturated: true }, { state: 'unrecognized' },
  ])('refuses invalid Connection facts: %j', (change) => {
    const input = request()
    Object.assign(input.payload.args.connection, change)
    expect(() => readConnectionObservation(input)).toThrow(/^Windows renderer connection observation was not accepted$/)
  })
})
