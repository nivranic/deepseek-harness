/** §45 failure-copy: class routing, raw fallback, and dictionary completeness. */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import {
  remoteFailureClassCopy, remoteFailureCopy, type FailureCopyKey,
} from '../src/client/failure-copy.ts'
import { zh } from '../src/locales/zh.ts'
import { en } from '../src/locales/en.ts'

/** Stub translate exposing the key it served (copy correctness is the dictionaries' own case). */
const keyEcho = (key: FailureCopyKey): string => key
const echo = (key: FailureCopyKey, params?: Record<string, unknown>): string =>
  params === undefined ? keyEcho(key) : `${keyEcho(key)}:${JSON.stringify(params)}`

describe('remote failure copy', () => {
  it('routes every classified class to its common key', () => {
    expect(remoteFailureClassCopy('authentication', 'ignored', echo)).toBe('failure.authentication')
    expect(remoteFailureClassCopy('permission', 'ignored', echo)).toBe('failure.permission')
    expect(remoteFailureClassCopy('compatibility', 'ignored', echo)).toBe('failure.compatibility')
    expect(remoteFailureClassCopy('conflict', 'ignored', echo)).toBe('failure.conflict')
    expect(remoteFailureClassCopy('host-state', 'ignored', echo)).toBe('failure.host-state')
    expect(remoteFailureClassCopy('carrier-invalid', 'ignored', echo)).toBe('failure.carrier-invalid')
    expect(remoteFailureClassCopy('transport', 'ignored', echo)).toBe('failure.transport')
    expect(remoteFailureClassCopy('unavailable', 'ignored', echo)).toBe('failure.unavailable')
  })

  it('keeps the raw diagnostic for the unknown class through the raw template', () => {
    expect(remoteFailureClassCopy('unknown', 'provider said no', echo))
      .toBe('failure.raw:{"message":"provider said no"}')
  })

  it('classifies a caught Remote failure and keeps non-Remote failures raw', () => {
    expect(remoteFailureCopy(new RemoteError('gateway/permission-denied', 'denied body', { endpoint: 'session/prompt', reason: 'device-identity' }), echo))
      .toBe('failure.permission')
    expect(remoteFailureCopy(new RemoteError('gateway/transport-interrupted', 'cut off', { stream: 'session' }), echo))
      .toBe('failure.transport')
    expect(remoteFailureCopy(new Error('plain local failure'), echo))
      .toBe('failure.raw:{"message":"plain local failure"}')
    expect(remoteFailureCopy('a string failure', echo))
      .toBe('failure.raw:{"message":"a string failure"}')
    expect(remoteFailureCopy({ code: 'goal-context-changed', message: 'a wire-shaped local failure' }, echo))
      .toBe('failure.raw:{"message":"a wire-shaped local failure"}')
  })

  it('carries every failure key in both common dictionaries with interpolatable raw templates', () => {
    const keys: readonly FailureCopyKey[] = [
      'failure.authentication', 'failure.permission', 'failure.compatibility', 'failure.conflict',
      'failure.host-state', 'failure.carrier-invalid', 'failure.transport', 'failure.unavailable',
      'failure.raw',
    ]
    for (const key of keys) {
      expect(zh[key], `zh ${key}`).toMatch(/\S/u)
      expect(en[key], `en ${key}`).toMatch(/\S/u)
    }
    expect(zh['failure.raw']).toContain('{message}')
    expect(en['failure.raw']).toContain('{message}')
  })
})
