/** Bundled-file fixture and explicit managed-process double for support-export tests. */
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { vi, type Mock } from 'vitest'
import { Config } from '../src/support.ts'

export const POLICY = Config.parse({ scanMilliseconds: 1000, shutdownMilliseconds: 100 })

export interface ScannerStep {
  readonly output?: string
  readonly code?: number | null
  readonly signal?: NodeJS.Signals | null
  readonly lossy?: boolean
  readonly done?: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>
  readonly join?: () => Promise<boolean>
}

type ScannerHandle = Omit<SubprocessHandle, 'terminate' | 'waitForExit'> & {
  terminate: Mock<SubprocessHandle['terminate']>
  waitForExit: Mock<SubprocessHandle['waitForExit']>
}

export async function supportFixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-support-test-'))
  const directory = join(root, 'SupportScanner')
  await mkdir(directory)
  const executable = join(directory, process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks')
  const binary = Buffer.from('test scanner executable; process execution is provided by the explicit double')
  const license = Buffer.from('fixture license\n')
  const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex')
  const identity = {
    schemaVersion: 1, version: '8.30.1', archiveSha256: 'a'.repeat(64),
    originalBinarySha256: hash(binary), binarySha256: hash(binary), licenseSha256: hash(license),
  }
  await writeFile(executable, binary)
  await writeFile(join(directory, 'LICENSE'), license)
  await writeFile(join(directory, 'scanner.json'), JSON.stringify(identity))
  const calls: SubprocessSpawnSpec[] = []
  const handles: ScannerHandle[] = []
  let next: ((spec: SubprocessSpawnSpec, index: number) => ScannerStep) | undefined
  const runtime = {
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const index = calls.push(spec) - 1
      const step = next?.(spec, index) ?? {}
      const input = typeof spec.stdio.stdin === 'object' ? spec.stdio.stdin.data : ''
      const canary = input.startsWith('GITHUB_TOKEN=')
      const output = step.output ?? (spec.argv.at(-1) === 'version' ? '8.30.1\n' : canary ? '[{"RuleID":"github-pat","Secret":"REDACTED"}]' : '[]')
      const handle: ScannerHandle = {
        pid: 123, stdin: undefined, stdout: undefined, stderr: undefined,
        collected: { stdout: { readFrom: () => ({ text: output, nextOffset: Buffer.byteLength(output), lossy: step.lossy ?? false }) } },
        done: step.done ?? Promise.resolve({ exitCode: step.code === undefined ? canary ? 1 : 0 : step.code, signal: step.signal ?? null }),
        terminate: vi.fn(),
        waitForExit: vi.fn(step.join ?? (() => Promise.resolve(true))),
      }
      handles.push(handle)
      return handle
    },
  }
  return { root, directory, executable, identity, runtime, calls, handles,
    script: (callback: (spec: SubprocessSpawnSpec, index: number) => ScannerStep) => { next = callback } }
}
