import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyBuildRevisionStamp } from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function emptyRuntime(): string {
  const runtime = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-stamp-'))
  roots.push(runtime)
  return runtime
}

function runtimeWithStamp(contents: string): string {
  const runtime = emptyRuntime()
  writeFileSync(join(runtime, 'build-revision.json'), contents)
  return runtime
}

function withRevisionEnv(run: () => void, value?: string): void {
  const previous = process.env.DSH_BUILD_REVISION
  try {
    if (value === undefined) delete process.env.DSH_BUILD_REVISION
    else process.env.DSH_BUILD_REVISION = value
    run()
  } finally {
    if (previous === undefined) delete process.env.DSH_BUILD_REVISION
    else process.env.DSH_BUILD_REVISION = previous
  }
}

describe('build revision stamp', () => {
  it('sets DSH_BUILD_REVISION from a valid packaged stamp', () => {
    const runtime = runtimeWithStamp('{ "revision": "0123456789abcdef0123456789abcdef01234567" }\n')
    withRevisionEnv(() => {
      applyBuildRevisionStamp(runtime)
      expect(process.env.DSH_BUILD_REVISION).toBe('0123456789abcdef0123456789abcdef01234567')
    })
  })

  it('keeps an explicitly inherited DSH_BUILD_REVISION over the stamp', () => {
    const runtime = runtimeWithStamp('{ "revision": "0123456789abcdef0123456789abcdef01234567" }\n')
    withRevisionEnv(() => {
      applyBuildRevisionStamp(runtime)
      expect(process.env.DSH_BUILD_REVISION).toBe('ffffffffffffffffffffffffffffffffffffffff')
    }, 'ffffffffffffffffffffffffffffffffffffffff')
  })

  it('leaves the environment untouched when no stamp is packaged', () => {
    const runtime = emptyRuntime()
    withRevisionEnv(() => {
      applyBuildRevisionStamp(runtime)
      expect(process.env.DSH_BUILD_REVISION).toBeUndefined()
    })
  })

  it('fails loud when the stamp is corrupt: invalid JSON, malformed revision, or an unreadable file', () => {
    withRevisionEnv(() => {
      expect(() => { applyBuildRevisionStamp(runtimeWithStamp('{ "revision": ')) }).toThrow(/is not valid JSON/u)
      expect(() => {
        applyBuildRevisionStamp(runtimeWithStamp('{ "revision": "0123456789ABCDEF0123456789ABCDEF01234567" }\n'))
      }).toThrow(/must carry/u)
      expect(() => { applyBuildRevisionStamp(runtimeWithStamp('{ "revision": 7 }\n')) }).toThrow(/must carry/u)
      const unreadable = emptyRuntime()
      mkdirSync(join(unreadable, 'build-revision.json'))
      expect(() => { applyBuildRevisionStamp(unreadable) }).toThrow(/is unreadable/u)
      expect(process.env.DSH_BUILD_REVISION).toBeUndefined()
    })
  })
})
