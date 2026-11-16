import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DESKTOP_HOST_PROTOCOL_VERSION } from '../src/host-protocol.ts'
import { verifyDesktopRuntime, writeDesktopRuntime } from '../src/runtime-tree.ts'
import {
  DESKTOP_BUILD_REVISION_FILE,
  resolveDesktopBuildRevision,
  writeDesktopBuildRevisionStamp,
} from '../scripts/build-revision.ts'
import { writePackage } from './runtime-fixture.ts'

const REVISION = '0123456789abcdef0123456789abcdef01234567'

function clientBuildRecord(commit: string): string {
  return `${JSON.stringify({
    formatVersion: 1,
    environment: { DSH_CLIENT_COMMIT_HASH: commit, DSH_CLIENT_VERSION: '1.0.0' },
    artifacts: { fileCount: 1, sha256: '0'.repeat(64) },
  })}\n`
}

describe('desktop build revision', () => {
  it('uses an explicit 40-character DSH_BUILD_REVISION without consulting Git', () => {
    expect(resolveDesktopBuildRevision(
      { DSH_BUILD_REVISION: REVISION },
      () => { throw new Error('git must not run when the revision is pinned') },
      () => undefined,
    )).toBe(REVISION)
  })

  it('rejects a malformed DSH_BUILD_REVISION instead of falling back to Git', () => {
    for (const value of [REVISION.slice(0, 7), 'X'.repeat(40), REVISION.toUpperCase(), '']) {
      expect(() => resolveDesktopBuildRevision({ DSH_BUILD_REVISION: value }, () => REVISION, () => undefined))
        .toThrow(/DSH_BUILD_REVISION/u)
    }
  })

  it('reads git rev-parse HEAD when the environment does not pin a revision', () => {
    expect(resolveDesktopBuildRevision({}, () => `${REVISION}\n`, () => undefined)).toBe(REVISION)
  })

  it('rejects git output that is not a complete lowercase commit hash', () => {
    expect(() => resolveDesktopBuildRevision({}, () => REVISION.slice(0, 7), () => undefined)).toThrow(/git rev-parse/u)
    expect(() => resolveDesktopBuildRevision({}, () => REVISION.toUpperCase(), () => undefined)).toThrow(/git rev-parse/u)
  })

  it('accepts a client build record committed to the packaged revision', () => {
    expect(resolveDesktopBuildRevision({}, () => REVISION, () => clientBuildRecord(REVISION.slice(0, 7))))
      .toBe(REVISION)
    expect(resolveDesktopBuildRevision(
      { DSH_BUILD_REVISION: REVISION },
      () => { throw new Error('unused') },
      () => clientBuildRecord(REVISION),
    )).toBe(REVISION)
  })

  it('fails packaging when the client build record commits a different revision', () => {
    const diverged = 'fedcba9876543210fedcba9876543210fedcba98'
    expect(() => resolveDesktopBuildRevision({}, () => REVISION, () => clientBuildRecord(diverged.slice(0, 7))))
      .toThrow(/client build record commits/u)
    expect(() => resolveDesktopBuildRevision(
      { DSH_BUILD_REVISION: REVISION },
      () => { throw new Error('unused') },
      () => clientBuildRecord(diverged.slice(0, 7)),
    )).toThrow(/client build record commits/u)
  })

  it('rejects a client build record without a usable commit', () => {
    expect(() => resolveDesktopBuildRevision({}, () => REVISION, () => '{"formatVersion":1}\n'))
      .toThrow(/DSH_CLIENT_COMMIT_HASH/u)
    expect(() => resolveDesktopBuildRevision({}, () => REVISION, () => 'not json'))
      .toThrow(/invalid JSON/u)
  })

  it('seals the one-line revision stamp into the runtime manifest inventory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-build-revision-'))
    try {
      const names = ['@deepseek-ai/dsh', '@deepseek-ai/dsh-desktop-host']
      for (const name of names) writePackage(join(root, 'node_modules'), name)
      writeDesktopBuildRevisionStamp(root, REVISION)
      const release = {
        schemaVersion: 1 as const, version: '1.0.0', nodeVersion: '24.17.0',
        pnpmVersion: '11.7.0', hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
      }
      const descriptor = writeDesktopRuntime(root, release, names)
      const stamp = `${JSON.stringify({ revision: REVISION })}\n`
      expect(readFileSync(join(root, DESKTOP_BUILD_REVISION_FILE), 'utf8')).toBe(stamp)
      expect(descriptor.files.find(file => file.path === DESKTOP_BUILD_REVISION_FILE)?.bytes)
        .toBe(Buffer.byteLength(stamp))
      await expect(verifyDesktopRuntime(root, '1.0.0')).resolves.toBeDefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses to stamp anything but a complete lowercase commit hash', () => {
    const root = mkdtempSync(join(tmpdir(), 'desktop-build-revision-'))
    try {
      expect(() => { writeDesktopBuildRevisionStamp(root, REVISION.slice(0, 7)) }).toThrow(/40-character/u)
      expect(existsSync(join(root, DESKTOP_BUILD_REVISION_FILE))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
