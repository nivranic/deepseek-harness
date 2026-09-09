/** Immutable support documents admitted by the bundled Gitleaks executable before native saving. */
import { createHash, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessOutputReader } from '@deepseek-ai/dsh-subprocess'
import { z } from 'zod'
import type { DesktopSupportFailure, DesktopSupportPolicy } from './types.ts'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const scannerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  version: z.string().max(32).regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
  archiveSha256: digestSchema,
  originalBinarySha256: digestSchema,
  binarySha256: digestSchema,
  licenseSha256: digestSchema,
})

/** Fixed scanner refusals preserve failure categories without exposing native diagnostics. */
export class SupportExportError extends Error {
  /** Public refusal category, without the underlying native exception. */
  readonly reason: DesktopSupportFailure
  /**
   * Construct a public failure category, without retaining the underlying exception.
   * @param reason - closed support-export failure category.
   */
  constructor(reason: DesktopSupportFailure) {
    super(reason)
    this.reason = reason
  }
}

function digest(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Read a bounded regular file, rejecting links and replacement using full-width file identifiers. */
async function regularFile(path: string, maximumBytes: number): Promise<Buffer> {
  const before = await lstat(path, { bigint: true })
  if (!before.isFile() || before.size === 0n || before.size > BigInt(maximumBytes)) throw new SupportExportError('invalid-scanner')
  const noFollow = (constants as { readonly O_NOFOLLOW?: number }).O_NOFOLLOW ?? 0
  const handle = await open(path, constants.O_RDONLY | noFollow)
  try {
    const after = await handle.stat({ bigint: true })
    if (!after.isFile() || before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size) {
      throw new SupportExportError('invalid-scanner')
    }
    const size = Number(after.size)
    const data = Buffer.alloc(size + 1)
    let offset = 0
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, null)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== size) throw new SupportExportError('invalid-scanner')
    return data.subarray(0, offset)
  } finally {
    await handle.close()
  }
}

async function scannerIdentity(directory: string): Promise<z.infer<typeof scannerSchema>> {
  try {
    const root = await lstat(directory)
    if (!root.isDirectory()) throw new SupportExportError('invalid-scanner')
    const executable = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks'
    const expected = [executable, 'LICENSE', 'scanner.json'].sort()
    if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(expected)) {
      throw new SupportExportError('invalid-scanner')
    }
    const identity = scannerSchema.parse(JSON.parse((await regularFile(join(directory, 'scanner.json'), 4096)).toString('utf8')))
    const binary = await regularFile(join(directory, executable), 128 * 1024 * 1024)
    const license = await regularFile(join(directory, 'LICENSE'), 1024 * 1024)
    if (digest(binary) !== identity.binarySha256 || digest(license) !== identity.licenseSha256
      || (process.platform === 'win32' && identity.binarySha256 !== identity.originalBinarySha256)) {
      throw new SupportExportError('invalid-scanner')
    }
    return identity
  } catch {
    // All failures here concern bundled files or their parsed receipt, never caller callbacks.
    throw new SupportExportError('invalid-scanner')
  }
}

/**
 * Replace every ambient entry with a tombstone before adding the fixed scanner configuration.
 * @returns explicit subprocess environment entries; no ambient home, proxy or Gitleaks configuration survives.
 */
export function supportScannerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
  if (process.platform === 'win32') env.SystemRoot = process.env.SystemRoot
  env.LANG = 'C'
  env.LC_ALL = 'C'
  env.GITLEAKS_CONFIG_TOML = '[extend]\nuseDefault = true\n'
  return env
}

async function quiesce(child: SubprocessHandle): Promise<void> {
  child.terminate()
  // Even launch failure or an interrupted stdin write must join the provider-owned tree.
  await child.done.catch(() => undefined)
  if (!await child.waitForExit()) throw new SupportExportError('cleanup-failed')
}

async function runScanner(
  runtime: Pick<SubprocessRuntime, 'spawn'>, directory: string, input: string | undefined,
  policy: DesktopSupportPolicy, signal: AbortSignal,
): Promise<{ readonly code: number | null; readonly output: string }> {
  signal.throwIfAborted()
  const deadline = new AbortController()
  const combined = AbortSignal.any([signal, deadline.signal])
  const timer = setTimeout(() => { deadline.abort() }, policy.scanMilliseconds)
  const executable = join(directory, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks')
  let child: SubprocessHandle | undefined
  let result: { readonly code: number | null; readonly output: string }
  try {
    child = runtime.spawn({
      argv: input === undefined ? [executable, 'version'] : [
        executable, 'stdin', '--report-format', 'json', '--report-path', '-', '--redact=100',
        '--no-banner', '--no-color', '--log-level', 'fatal', '--ignore-gitleaks-allow',
        '--gitleaks-ignore-path', process.platform === 'win32' ? 'NUL' : '/dev/null',
      ],
      cwd: directory,
      env: supportScannerEnvironment(),
      stdio: {
        stdin: input === undefined ? 'ignore' : { data: input },
        stdout: { maxBytes: policy.maximumReportBytes },
        stderr: { maxBytes: 1024 },
      },
      signal: combined,
      graceMs: policy.shutdownMilliseconds,
    })
    const outcome = await child.done
    if (signal.aborted) signal.throwIfAborted()
    if (deadline.signal.aborted) throw new SupportExportError('timed-out')
    // The spawn's stdout collect spec requires the provider to return this reader.
    const output = (child.collected.stdout as SubprocessOutputReader).readFrom(0)
    if (output.lossy || outcome.signal !== null) throw new SupportExportError('scan-failed')
    result = { code: outcome.exitCode, output: output.text }
  } catch (error) {
    if (signal.aborted) signal.throwIfAborted()
    if (deadline.signal.aborted) throw new SupportExportError('timed-out')
    if (error instanceof SupportExportError) throw error
    throw new SupportExportError('scan-failed')
  } finally {
    try {
      if (child !== undefined) await quiesce(child)
    } catch {
      // Process-service cleanup failed; raw native errors cannot enter the exported result.
      throw new SupportExportError('cleanup-failed')
    } finally {
      clearTimeout(timer)
    }
  }
  signal.throwIfAborted()
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- abort state can change during asynchronous tree cleanup.
  if (deadline.signal.aborted) throw new SupportExportError('timed-out')
  return result
}

function report(result: { readonly code: number | null; readonly output: string }): readonly Record<string, unknown>[] {
  let rows: unknown
  try { rows = JSON.parse(result.output) as unknown }
  catch { throw new SupportExportError('scan-failed') }
  if (!Array.isArray(rows) || rows.some(row => row === null || typeof row !== 'object' || Array.isArray(row))
    || !((result.code === 0 && rows.length === 0) || (result.code === 1 && rows.length > 0))) {
    throw new SupportExportError('scan-failed')
  }
  return rows as Record<string, unknown>[]
}

/** Immutable scanned bytes; construction and atomic saving share the same private document. */
export class ApprovedSupportDocument {
  private constructor(private readonly json: string) {}

  /** Number of UTF-8 bytes that will be saved. */
  get bytes(): number { return Buffer.byteLength(this.json) }

  /** SHA-256 of exactly the bytes that will be saved. */
  get sha256(): string { return digest(this.json) }

  /**
   * Serialize a fixed-field snapshot and admit it only after version, real canary and zero-findings scans.
   * @param runtime - managed subprocess provider owning scanner termination.
   * @param directory - the application's sealed SupportScanner directory.
   * @param snapshot - fixed fields selected by the desktop collector before scanning.
   * @param policy - validated document, report and process limits.
   * @param signal - cancellation that must join each scanner tree before returning.
   * @returns an immutable document; no support payload or scanner report is written to scratch storage.
   */
  static async prepare(
    runtime: Pick<SubprocessRuntime, 'spawn'>, directory: string, snapshot: Readonly<Record<string, unknown>>,
    policy: DesktopSupportPolicy, signal: AbortSignal,
  ): Promise<ApprovedSupportDocument> {
    signal.throwIfAborted()
    const frozen = JSON.stringify(snapshot)
    if (Buffer.byteLength(frozen) > policy.maximumBytes) throw new SupportExportError('oversized')
    const scanner = await scannerIdentity(directory)
    const json = `${JSON.stringify({ ...JSON.parse(frozen) as Record<string, unknown>, scanner }, null, 2)}\n`
    if (Buffer.byteLength(json) > policy.maximumBytes) throw new SupportExportError('oversized')
    const version = await runScanner(runtime, directory, undefined, policy, signal)
    if (version.code !== 0 || version.output.trim() !== scanner.version) throw new SupportExportError('invalid-scanner')
    const token = `ghp_${randomBytes(18).toString('hex')}`
    const proof = await runScanner(runtime, directory, `GITHUB_TOKEN=${token} # gitleaks:allow\n`, policy, signal)
    if (!report(proof).some(row => row.RuleID === 'github-pat') || proof.output.includes(token)) {
      throw new SupportExportError('invalid-scanner')
    }
    if (report(await runScanner(runtime, directory, json, policy, signal)).length > 0) {
      throw new SupportExportError('secrets-detected')
    }
    if (JSON.stringify(await scannerIdentity(directory)) !== JSON.stringify(scanner)) {
      throw new SupportExportError('invalid-scanner')
    }
    signal.throwIfAborted()
    return new ApprovedSupportDocument(json)
  }

  /**
   * Atomically save the approved bytes at a user-selected destination. Cancellation before rename refuses saving;
   * once rename commits, the operation reports saved even if cancellation arrives immediately afterward.
   * @param destination - exact path approved by the native save dialog.
   * @param signal - cancellation before the atomic commit.
   */
  async save(destination: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const temporary = join(dirname(destination), `.dsh-support-${randomBytes(16).toString('hex')}.tmp`)
    let created = false
    try {
      const handle = await open(temporary, 'wx', 0o600)
      created = true
      try {
        await handle.writeFile(this.json, { encoding: 'utf8', signal })
        await handle.sync()
      } finally {
        await handle.close()
      }
      signal.throwIfAborted()
      await rename(temporary, destination)
      created = false
    } catch {
      if (signal.aborted) signal.throwIfAborted()
      throw new SupportExportError('save-failed')
    } finally {
      if (created) {
        try { await unlink(temporary) }
        catch { throw new SupportExportError('cleanup-failed') }
      }
    }
  }
}
