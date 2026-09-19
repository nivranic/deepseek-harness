import { describe, expect, it } from 'vitest'
import { RemoteError, classifyRemoteFailure, classifyRemoteFailureCode } from '../src/index.ts'

describe('classifyRemoteFailureCode', () => {
  it('classifies codes with agreed cross-Client semantics', () => {
    expect(classifyRemoteFailureCode('gateway/authentication-required')).toBe('authentication')
    expect(classifyRemoteFailureCode('gateway/permission-denied')).toBe('permission')
    expect(classifyRemoteFailureCode('subagent/unauthorized')).toBe('permission')
    expect(classifyRemoteFailureCode('gateway/host-not-ready')).toBe('host-state')
    expect(classifyRemoteFailureCode('gateway/protocol-unsupported')).toBe('compatibility')
    expect(classifyRemoteFailureCode('host/protocol-unsupported')).toBe('compatibility')
    expect(classifyRemoteFailureCode('host/capability-unavailable')).toBe('compatibility')
    expect(classifyRemoteFailureCode('host/description-invalid')).toBe('carrier-invalid')
    expect(classifyRemoteFailureCode('gateway/preparation-unavailable')).toBe('carrier-invalid')
    expect(classifyRemoteFailureCode('gateway/stream-invalid')).toBe('carrier-invalid')
    expect(classifyRemoteFailureCode('gateway/transport-interrupted')).toBe('transport')
    expect(classifyRemoteFailureCode('gateway/connection-unavailable')).toBe('transport')
    expect(classifyRemoteFailureCode('revision-conflict')).toBe('conflict')
    expect(classifyRemoteFailureCode('session/revision-conflict')).toBe('conflict')
    expect(classifyRemoteFailureCode('session/not-found')).toBe('unavailable')
    expect(classifyRemoteFailureCode('workspace-file/not-found')).toBe('unavailable')
    expect(classifyRemoteFailureCode('presented-file/not-found')).toBe('unavailable')
    expect(classifyRemoteFailureCode('workspace-file/not-regular-file')).toBe('unavailable')
    expect(classifyRemoteFailureCode('session/queue-item-not-found')).toBe('unavailable')
    expect(classifyRemoteFailureCode('session/attachment-invalid')).toBe('invalid-input')
    expect(classifyRemoteFailureCode('subagent/attachment-invalid')).toBe('invalid-input')
    expect(classifyRemoteFailureCode('workspace/invalid-path')).toBe('invalid-input')
  })

  it('keeps merge-extensible vocabulary codes opaque instead of guessing', () => {
    // Codes exist in the declared vocabulary but carry owner-specific semantics
    // until every Client can honor one meaning.
    expect(classifyRemoteFailureCode('gateway/service-unavailable')).toBe('unknown')
    expect(classifyRemoteFailureCode('session/steer-unavailable')).toBe('unknown')
    expect(classifyRemoteFailureCode('interaction-closed')).toBe('unknown')
    // Unknown future codes from a newer Host stay presentable diagnostics.
    expect(classifyRemoteFailureCode('future/some-code')).toBe('unknown')
    expect(classifyRemoteFailureCode('')).toBe('unknown')
  })
})

describe('classifyRemoteFailure', () => {
  it('classifies a RemoteError by its carried code', () => {
    const error = new RemoteError('gateway/host-not-ready', 'not ready', { endpoint: 'a/b', httpStatus: 503 })
    expect(classifyRemoteFailure(error)).toBe('host-state')
  })

  it('resolves non-Remote failures to the opaque class without altering them', () => {
    expect(classifyRemoteFailure(new Error('plain'))).toBe('unknown')
    expect(classifyRemoteFailure(undefined)).toBe('unknown')
    expect(classifyRemoteFailure('gateway/host-not-ready')).toBe('unknown')
  })
})
