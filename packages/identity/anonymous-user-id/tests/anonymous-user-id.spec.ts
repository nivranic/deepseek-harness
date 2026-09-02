import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn, type ChildProcess } from 'node:child_process'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANONYMOUS_USER_ID_FILE_NAME,
  getOrCreateAnonymousIdentity,
  getOrCreateAnonymousUserId,
} from '../src/index.ts'

const dirs: string[] = []
const ZERO_SEED = Buffer.alloc(32)
const ONE_SEED = Buffer.alloc(32, 1)
const ZERO_RECORD = `v1:${ZERO_SEED.toString('hex')}\n`
const USER_ID = '646b6fa2-5ccd-4e8a-802e-9be522f1b1b5'
const SESSION_PSEUDONYM = 'f928a3ca018b679624894ca694fb2327964a369045b2b28bd09ced7d9e2b8651'
const ONE_RECORD = `v1:${ONE_SEED.toString('hex')}\n`
const originalGetuid = Object.getOwnPropertyDescriptor(process, 'getuid')
const ROTATION_RACE_WORKER = fileURLToPath(new URL('./fixtures/rotation-race-worker.ts', import.meta.url))

const state = vi.hoisted(() => ({
  afterRename: undefined as ((path: string) => void) | undefined,
  defaultFstatMode: undefined as bigint | undefined,
  failNextClose: false,
  fstatFailuresRemaining: 0,
  failNextFstat: false,
  failNextFsync: false,
  failNextRename: false,
  failRotationTargetLstatAfterClaim: false,
  fstatCalls: new Map<string, number>(),
  fstatModes: new Map<string, bigint[]>(),
  fstatUids: new Map<string, bigint[]>(),
  descriptorPaths: new Map<number, string>(),
  descriptorReadCalls: new Map<string, number>(),
  linkErrorCode: undefined as string | undefined,
  lstatErrorPath: undefined as string | undefined,
  failNextTempLstat: false,
  mismatchFstatPath: undefined as string | undefined,
  mismatchNextTempLstat: false,
  nonRegularTemp: false,
  openErrorPath: undefined as string | undefined,
  readErrorPath: undefined as string | undefined,
  replaceRotationClaimAfterLink: undefined as { claim: string; final?: string } | undefined,
  replaceTempAfterLink: false,
  renameThenReportMissing: false,
  unlinkErrorSuffix: undefined as string | undefined,
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const fail = (code: string) => Object.assign(new Error(`injected ${code}`), { code })
  return {
    ...actual,
    closeSync: (fd: number) => {
      try {
        actual.closeSync(fd)
        if (state.failNextClose) {
          state.failNextClose = false
          throw fail('EIO')
        }
      } finally {
        state.descriptorPaths.delete(fd)
      }
    },
    fstatSync: ((...args: Parameters<typeof actual.fstatSync>) => {
      if (state.fstatFailuresRemaining > 0) {
        state.fstatFailuresRemaining -= 1
        throw fail('EIO')
      }
      if (state.failNextFstat) {
        state.failNextFstat = false
        throw fail('EIO')
      }
      const stat = actual.fstatSync(...args)
      const path = state.descriptorPaths.get(args[0])
      if (path === undefined) return stat
      const call = (state.fstatCalls.get(path) ?? 0) + 1
      state.fstatCalls.set(path, call)
      const mode = state.fstatModes.get(path)?.[call - 1] ?? state.defaultFstatMode
      const uid = state.fstatUids.get(path)?.[call - 1]
      const nonRegular = state.nonRegularTemp && path.endsWith('.tmp') && call === 2
      const mismatch = state.mismatchFstatPath === path
      if (mismatch) state.mismatchFstatPath = undefined
      if (mode === undefined && uid === undefined && !nonRegular && !mismatch) return stat
      return new Proxy<import('node:fs').BigIntStats>(stat as import('node:fs').BigIntStats, {
        get(target, property) {
          if (property === 'mode' && mode !== undefined) return mode
          if (property === 'uid' && uid !== undefined) return uid
          if (property === 'ino' && mismatch) return target.ino + 1n
          if (property === 'isFile') return nonRegular ? () => false : () => target.isFile()
          return Reflect.get(target, property, target) as unknown
        },
      })
    }) as typeof actual.fstatSync,
    fsyncSync: (fd: number) => {
      if (state.failNextFsync) {
        state.failNextFsync = false
        throw fail('EIO')
      }
      actual.fsyncSync(fd)
    },
    linkSync: (...args: Parameters<typeof actual.linkSync>) => {
      if (state.linkErrorCode !== undefined) {
        const code = state.linkErrorCode
        state.linkErrorCode = undefined
        throw fail(code)
      }
      actual.linkSync(...args)
      if (state.failRotationTargetLstatAfterClaim && String(args[1]).endsWith('.rotate')) {
        state.failRotationTargetLstatAfterClaim = false
        state.lstatErrorPath = String(args[1]).slice(0, -'.rotate'.length)
      }
      const replacement = state.replaceRotationClaimAfterLink
      if (replacement !== undefined && String(args[1]).endsWith('.rotate')) {
        state.replaceRotationClaimAfterLink = undefined
        actual.unlinkSync(args[1])
        actual.writeFileSync(args[1], replacement.claim, { mode: 0o600 })
        if (replacement.final !== undefined) {
          actual.writeFileSync(String(args[1]).slice(0, -'.rotate'.length), replacement.final, { mode: 0o600 })
        }
      }
      if (state.replaceTempAfterLink) {
        state.replaceTempAfterLink = false
        actual.unlinkSync(args[0])
        actual.writeFileSync(args[0], 'replacement\n')
      }
    },
    lstatSync: ((...args: Parameters<typeof actual.lstatSync>) => {
      if (state.failNextTempLstat && String(args[0]).endsWith('.tmp')) {
        state.failNextTempLstat = false
        throw fail('EIO')
      }
      if (state.lstatErrorPath === String(args[0])) {
        state.lstatErrorPath = undefined
        throw fail('EACCES')
      }
      const stat = actual.lstatSync(...args)
      if (state.mismatchNextTempLstat && String(args[0]).endsWith('.tmp')) {
        state.mismatchNextTempLstat = false
        return new Proxy<import('node:fs').BigIntStats>(stat as import('node:fs').BigIntStats, {
          get(target, property) {
            if (property === 'ino') return target.ino + 1n
            return Reflect.get(target, property, target) as unknown
          },
        })
      }
      return stat
    }) as typeof actual.lstatSync,
    openSync: (...args: Parameters<typeof actual.openSync>) => {
      if (state.openErrorPath === String(args[0])) {
        state.openErrorPath = undefined
        throw fail('EACCES')
      }
      const fd = actual.openSync(...args)
      state.descriptorPaths.set(fd, String(args[0]))
      return fd
    },
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (typeof args[0] === 'number') {
        const path = state.descriptorPaths.get(args[0])
        if (path !== undefined) {
          state.descriptorReadCalls.set(path, (state.descriptorReadCalls.get(path) ?? 0) + 1)
        }
        if (state.readErrorPath === path) {
          state.readErrorPath = undefined
          throw fail('EIO')
        }
      }
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (state.failNextRename) {
        state.failNextRename = false
        throw fail('EACCES')
      }
      actual.renameSync(...args)
      if (state.renameThenReportMissing) {
        state.renameThenReportMissing = false
        throw fail('ENOENT')
      }
      state.afterRename?.(String(args[1]))
    },
    unlinkSync: (...args: Parameters<typeof actual.unlinkSync>) => {
      if (state.unlinkErrorSuffix !== undefined && String(args[0]).endsWith(state.unlinkErrorSuffix)) {
        state.unlinkErrorSuffix = undefined
        throw fail('EIO')
      }
      actual.unlinkSync(...args)
    },
  }
})

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-userid-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  state.afterRename = undefined
  state.defaultFstatMode = undefined
  state.failNextClose = false
  state.fstatFailuresRemaining = 0
  state.failNextFstat = false
  state.failNextFsync = false
  state.failNextRename = false
  state.failRotationTargetLstatAfterClaim = false
  state.fstatCalls.clear()
  state.fstatModes.clear()
  state.fstatUids.clear()
  state.descriptorPaths.clear()
  state.descriptorReadCalls.clear()
  state.linkErrorCode = undefined
  state.lstatErrorPath = undefined
  state.failNextTempLstat = false
  state.mismatchFstatPath = undefined
  state.mismatchNextTempLstat = false
  state.nonRegularTemp = false
  state.openErrorPath = undefined
  state.readErrorPath = undefined
  state.replaceRotationClaimAfterLink = undefined
  state.replaceTempAfterLink = false
  state.renameThenReportMissing = false
  state.unlinkErrorSuffix = undefined
  vi.restoreAllMocks()
  if (originalGetuid === undefined) delete (process as { getuid?: () => number }).getuid
  else Object.defineProperty(process, 'getuid', originalGetuid)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function writePrivate(file: string, content: string): void {
  writeFileSync(file, content, { mode: 0o600 })
  if (process.platform !== 'win32') chmodSync(file, 0o600)
}

function setGetuid(uid: number): void {
  Object.defineProperty(process, 'getuid', {
    configurable: true,
    value: () => uid,
    writable: true,
  })
}

interface RaceWorker {
  readonly child: ChildProcess
  readonly result: Promise<string>
}

function startRaceWorker(home: string, seedByte: number, role: 'holder' | 'contender', ...paths: string[]): RaceWorker {
  const child = spawn(process.execPath, [
    '--import', import.meta.resolve('tsx/esm'), ROTATION_RACE_WORKER,
    home, String(seedByte), role, ...paths,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { stdout += chunk })
  child.stderr?.on('data', (chunk: string) => { stderr += chunk })
  const result = new Promise<string>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`rotation race worker exited with code ${String(code)} and signal ${String(signal)}: ${stderr.trim()}`))
    })
  })
  return { child, result }
}

async function waitForFile(file: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (existsSync(file)) return
    await delay(10)
  }
  throw new Error(`timed out waiting for ${file}`)
}

async function stopRaceWorkers(workers: Array<RaceWorker | undefined>): Promise<void> {
  for (const worker of workers) {
    if (worker?.child.exitCode === null && worker.child.signalCode === null) worker.child.kill()
  }
  await Promise.allSettled(workers.flatMap(worker => worker === undefined ? [] : [worker.result]))
}

describe('anonymous identity', () => {
  it('persists one private root and derives stable domain-separated vectors', () => {
    const home = tempHome()
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(ZERO_RECORD)
    expect(identity.userId).toBe(USER_ID)
    expect(identity.pseudonymizeSessionId('session-1')).toBe(SESSION_PSEUDONYM)
    expect(identity.pseudonymizeSessionId('session-1')).not.toBe(identity.userId)
    expect(JSON.stringify(identity)).not.toContain(ZERO_SEED.toString('hex'))
  })

  it('creates a missing home and memoizes one opaque identity per path', () => {
    const home = join(tempHome(), 'nested', 'home')
    const first = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })
    const second = getOrCreateAnonymousIdentity({ env: { DSH_HOME: home } })

    expect(second).toBe(first)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(ZERO_RECORD)
  })

  it('uses cryptographic randomness when no generator seam is supplied', () => {
    const home = tempHome()
    const identity = getOrCreateAnonymousIdentity({ env: { DSH_HOME: home } })

    expect(identity.userId).toMatch(/^[0-9a-f-]{36}$/)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8'))
      .toMatch(/^v1:[0-9a-f]{64}\n$/)
  })

  it('loads the persisted root across a fresh resolved home lookup', () => {
    const home = tempHome()
    writePrivate(join(home, ANONYMOUS_USER_ID_FILE_NAME), ZERO_RECORD)
    const identity = getOrCreateAnonymousIdentity({ env: { DSH_HOME: home } })

    expect(identity.userId).toBe(USER_ID)
    expect(identity.pseudonymizeSessionId('session-1')).toBe(SESSION_PSEUDONYM)
  })

  it('keeps an in-memory root when closing a securely inspected seed fails', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, ZERO_RECORD)
    state.failNextClose = true

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ONE_SEED,
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
  })

  it('rotates an oversized private root without reading its contents', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'x'.repeat(1_024))

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
    expect(state.descriptorReadCalls.get(file)).toBe(1)
  })

  it.each(['lstat', 'open', 'read'] as const)('keeps an in-memory root when secure %s inspection fails', (step) => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, ZERO_RECORD)
    if (step === 'lstat') state.lstatErrorPath = file
    else if (step === 'open') state.openErrorPath = file
    else state.readErrorPath = file

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ONE_SEED,
      platform: process.platform,
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
  })

  it('does not read or replace a file whose descriptor identity changed', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, ZERO_RECORD)
    state.mismatchFstatPath = file

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ONE_SEED,
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
  })

  it('rotates a legacy exported UUID instead of reusing it as secret material', () => {
    const home = tempHome()
    const legacy = '01234567-89ab-4cde-8f01-23456789abcd'
    writePrivate(join(home, ANONYMOUS_USER_ID_FILE_NAME), `${legacy}\n`)
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(identity.userId).not.toBe(legacy)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(ZERO_RECORD)
  })

  it('replaces corrupt material with a fresh private root', () => {
    const home = tempHome()
    writePrivate(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'not-a-seed\n')
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(ZERO_RECORD)
  })

  it('adopts a concurrent winner after exclusive creation loses', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => {
        const winner = join(home, 'winner')
        writePrivate(winner, ONE_RECORD)
        renameSync(winner, file)
        return ZERO_SEED
      },
    })

    expect(readFileSync(file, 'utf8')).toBe(ONE_RECORD)
    expect(identity.userId).not.toBe(USER_ID)
  })

  it('rotates a corrupt first-create winner instead of writing its inode in place', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => {
        writePrivate(file, 'concurrent-corrupt\n')
        return ZERO_SEED
      },
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
  })

  it('adopts a concurrent winner that completes an existing-file rotation', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => {
        const winner = join(home, 'winner')
        writePrivate(winner, ONE_RECORD)
        renameSync(winner, file)
        return ZERO_SEED
      },
    })

    expect(readFileSync(file, 'utf8')).toBe(ONE_RECORD)
    expect(identity.userId).not.toBe(USER_ID)
  })

  it('adopts a first-create winner even when loser temp cleanup fails', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    state.unlinkErrorSuffix = '.tmp'
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => {
        writePrivate(file, ONE_RECORD)
        return ZERO_SEED
      },
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ONE_RECORD)
    expect(readdirSync(home).some(entry => entry.endsWith('.tmp'))).toBe(true)
  })

  it('adopts an existing valid rotation claim', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    writePrivate(`${file}.rotate`, ONE_RECORD)

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ONE_RECORD)
    expect(existsSync(`${file}.rotate`)).toBe(false)
  })

  it('keeps an adopted claim after rename fails instead of using its proposed seed', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    writePrivate(`${file}.rotate`, ONE_RECORD)
    state.failNextRename = true
    state.unlinkErrorSuffix = '.tmp'

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe('legacy-corrupt\n')
    expect(readFileSync(`${file}.rotate`, 'utf8')).toBe(ONE_RECORD)
    expect(readdirSync(home).some(entry => entry.endsWith('.tmp'))).toBe(true)
  })

  it('leaves an invalid existing rotation claim and target unchanged', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    writePrivate(`${file}.rotate`, 'invalid-claim\n')

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe('legacy-corrupt\n')
    expect(readFileSync(`${file}.rotate`, 'utf8')).toBe('invalid-claim\n')
  })

  it('adopts a valid final root when its new rotation claim is replaced', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    state.replaceRotationClaimAfterLink = { claim: 'replacement\n', final: ONE_RECORD }

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ONE_RECORD)
    expect(readFileSync(`${file}.rotate`, 'utf8')).toBe('replacement\n')
  })

  it('keeps an in-memory root when rotation claim publication fails', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    state.linkErrorCode = 'EACCES'

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe('legacy-corrupt\n')
    expect(readdirSync(home)).toEqual([ANONYMOUS_USER_ID_FILE_NAME])
  })

  it('adopts the claim published by a concurrent rename reported as missing', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    state.renameThenReportMissing = true

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
    expect(existsSync(`${file}.rotate`)).toBe(false)
  })

  it('retains and uses its claim when the target cannot be rechecked', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, 'legacy-corrupt\n')
    state.failRotationTargetLstatAfterClaim = true

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe('legacy-corrupt\n')
    expect(readFileSync(`${file}.rotate`, 'utf8')).toBe(ZERO_RECORD)
  })

  it('shares one rotation claim across competing processes', async () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const holderReady = join(home, 'holder-ready')
    const holderRelease = join(home, 'holder-release')
    writePrivate(file, 'legacy-corrupt\n')
    const holder = startRaceWorker(home, 0, 'holder', holderReady, holderRelease)
    let contender: RaceWorker | undefined
    try {
      await Promise.race([
        waitForFile(holderReady),
        holder.result.then((id) => { throw new Error(`rotation holder exited before readiness: ${id}`) }),
      ])
      contender = startRaceWorker(home, 1, 'contender')
      const contenderId = await contender.result
      writeFileSync(holderRelease, 'release\n', { flag: 'wx' })
      const holderId = await holder.result

      expect(holderId).toBe(USER_ID)
      expect(contenderId).toBe(USER_ID)
      expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
      expect(readdirSync(home).filter(entry => entry.endsWith('.tmp') || entry.endsWith('.rotate'))).toEqual([])
    } finally {
      if (!existsSync(holderRelease)) writeFileSync(holderRelease, 'release\n')
      await stopRaceWorkers([contender, holder])
    }
  }, 15_000)

  it('returns a process-stable secret identity when the home cannot contain files', () => {
    const home = tempHome()
    const blocked = join(home, 'blocked')
    writeFileSync(blocked, 'occupied\n')
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: blocked },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(existsSync(join(blocked, ANONYMOUS_USER_ID_FILE_NAME))).toBe(false)
    expect(getOrCreateAnonymousIdentity({ env: { DSH_HOME: blocked } })).toBe(identity)
  })

  it('rejects a generator that does not return 32 bytes', () => {
    expect(() => getOrCreateAnonymousIdentity({
      env: { DSH_HOME: tempHome() },
      randomBytes: () => Buffer.alloc(31),
    })).toThrow('anonymous identity randomBytes must return 32 bytes')
  })

  it('rotates a root exposed by POSIX permission bits before reading it', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, ZERO_RECORD)
    if (process.platform !== 'win32') chmodSync(file, 0o644)
    setGetuid(Number(lstatSync(file, { bigint: true }).uid))
    state.defaultFstatMode = 0o600n
    state.fstatModes.set(file, [0o644n, 0o600n])

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ONE_SEED,
      platform: 'linux',
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ONE_RECORD)
    if (process.platform !== 'win32') expect(lstatSync(file).mode & 0o777).toBe(0o600)
  })

  it('rotates a root not owned by the current POSIX user', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, ZERO_RECORD)
    const uid = lstatSync(file, { bigint: true }).uid
    setGetuid(Number(uid))
    state.defaultFstatMode = 0o600n
    state.fstatUids.set(file, [uid + 1n, uid])

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ONE_SEED,
      platform: 'linux',
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ONE_RECORD)
  })

  it('fails closed when POSIX ownership cannot be resolved', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    writePrivate(file, ZERO_RECORD)
    delete (process as { getuid?: () => number }).getuid
    state.defaultFstatMode = 0o600n

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ONE_SEED,
      platform: 'linux',
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(ZERO_RECORD)
  })

  it('does not follow or replace a symlinked identity path', () => {
    const home = tempHome()
    const victim = join(home, 'victim')
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const victimContent = process.platform === 'win32' ? join(victim, 'content') : victim
    if (process.platform === 'win32') mkdirSync(victim)
    writePrivate(victimContent, ZERO_RECORD)
    symlinkSync(victim, file, process.platform === 'win32' ? 'junction' : 'file')

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ONE_SEED,
    })

    expect(identity.userId).not.toBe(USER_ID)
    expect(lstatSync(file).isSymbolicLink()).toBe(true)
    expect(readFileSync(victimContent, 'utf8')).toBe(ZERO_RECORD)
  })

  it('does not replace a non-regular identity path', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    mkdirSync(file)

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(lstatSync(file).isDirectory()).toBe(true)
    expect(readdirSync(file)).toEqual([])
  })

  it('does not overwrite a path changed to a symlink before rotation', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const victim = join(home, 'victim')
    const victimContent = process.platform === 'win32' ? join(victim, 'content') : victim
    writePrivate(file, 'legacy-corrupt\n')
    if (process.platform === 'win32') mkdirSync(victim)
    writePrivate(victimContent, ONE_RECORD)

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => {
        rmSync(file)
        symlinkSync(victim, file, process.platform === 'win32' ? 'junction' : 'file')
        return ZERO_SEED
      },
    })

    expect(identity.userId).toBe(USER_ID)
    expect(lstatSync(file).isSymbolicLink()).toBe(true)
    expect(readFileSync(victimContent, 'utf8')).toBe(ONE_RECORD)
  })

  it('leaves the old root intact and retains a recoverable claim when atomic rotation fails', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const old = 'legacy-corrupt\n'
    writePrivate(file, old)
    state.failNextRename = true

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(readFileSync(file, 'utf8')).toBe(old)
    expect(readFileSync(`${file}.rotate`, 'utf8')).toBe(ZERO_RECORD)
  })

  it.each([
    'fstat',
    'temp-lstat',
    'temp-lstat-mismatch',
    'close',
    'fsync',
    'link',
    'non-regular-temp',
  ] as const)(
    'keeps an in-memory root and removes residue after a %s publication failure',
    (failure) => {
      const home = tempHome()
      if (failure === 'fstat') state.failNextFstat = true
      else if (failure === 'temp-lstat') state.failNextTempLstat = true
      else if (failure === 'temp-lstat-mismatch') state.mismatchNextTempLstat = true
      else if (failure === 'close') state.failNextClose = true
      else if (failure === 'fsync') state.failNextFsync = true
      else if (failure === 'link') state.linkErrorCode = 'EACCES'
      else state.nonRegularTemp = true

      const identity = getOrCreateAnonymousIdentity({
        env: { DSH_HOME: home },
        randomBytes: () => ZERO_SEED,
      })

      expect(identity.userId).toBe(USER_ID)
      expect(readdirSync(home)).toEqual([])
    },
  )

  it('leaves only an empty unverified sibling when descriptor inspection persistently fails', () => {
    const home = tempHome()
    state.fstatFailuresRemaining = 2

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    const files = readdirSync(home)
    expect(identity.userId).toBe(USER_ID)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^\.anonymous-user-id\.[0-9a-f]{24}\.tmp$/)
    expect(readFileSync(join(home, files[0]!), 'utf8')).toBe('')
  })

  it('does not unlink a random temp path replaced after no-replace publication', () => {
    const home = tempHome()
    state.replaceTempAfterLink = true

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    const files = readdirSync(home)
    const replacement = files.find(entry => entry.endsWith('.tmp'))
    expect(identity.userId).toBe(USER_ID)
    expect(files).toContain(ANONYMOUS_USER_ID_FILE_NAME)
    expect(replacement).toBeDefined()
    expect(readFileSync(join(home, replacement!), 'utf8')).toBe('replacement\n')
  })

  it('does not replace a link-shaped first-create winner', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const victim = join(home, 'victim')
    const victimContent = process.platform === 'win32' ? join(victim, 'content') : victim
    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => {
        if (process.platform === 'win32') mkdirSync(victim)
        writePrivate(victimContent, ONE_RECORD)
        symlinkSync(victim, file, process.platform === 'win32' ? 'junction' : 'file')
        return ZERO_SEED
      },
    })

    expect(identity.userId).toBe(USER_ID)
    expect(lstatSync(file).isSymbolicLink()).toBe(true)
    expect(readFileSync(victimContent, 'utf8')).toBe(ONE_RECORD)
  })

  it('falls back without replacing a link-shaped path published after atomic rotation', () => {
    const home = tempHome()
    const file = join(home, ANONYMOUS_USER_ID_FILE_NAME)
    const victim = join(home, 'victim')
    const victimContent = process.platform === 'win32' ? join(victim, 'content') : victim
    writePrivate(file, 'legacy-corrupt\n')
    state.afterRename = () => {
      rmSync(file)
      if (process.platform === 'win32') mkdirSync(victim)
      writePrivate(victimContent, ONE_RECORD)
      symlinkSync(victim, file, process.platform === 'win32' ? 'junction' : 'file')
    }

    const identity = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })

    expect(identity.userId).toBe(USER_ID)
    expect(lstatSync(file).isSymbolicLink()).toBe(true)
    expect(readFileSync(victimContent, 'utf8')).toBe(ONE_RECORD)
  })

  it('keeps independently seeded homes and raw Session ids unlinkable', () => {
    const a = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: tempHome() },
      randomBytes: () => ZERO_SEED,
    })
    const b = getOrCreateAnonymousIdentity({
      env: { DSH_HOME: tempHome() },
      randomBytes: () => ONE_SEED,
    })

    expect(a.userId).not.toBe(b.userId)
    expect(a.pseudonymizeSessionId('same')).not.toBe(b.pseudonymizeSessionId('same'))
    expect(a.pseudonymizeSessionId('one')).not.toBe(a.pseudonymizeSessionId('two'))
  })

  it('keeps getOrCreateAnonymousUserId as the public-id wrapper', () => {
    const home = tempHome()
    expect(getOrCreateAnonymousUserId({
      env: { DSH_HOME: home },
      randomBytes: () => ZERO_SEED,
    })).toBe(USER_ID)
  })

  it('reads process.env by default', () => {
    const home = tempHome()
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      const id = getOrCreateAnonymousUserId({ randomBytes: () => ZERO_SEED })
      expect(id).toBe(USER_ID)
      expect(readFileSync(join(home, ANONYMOUS_USER_ID_FILE_NAME), 'utf8')).toBe(ZERO_RECORD)
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })
})
