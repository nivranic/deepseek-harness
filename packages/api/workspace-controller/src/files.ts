/**
 * Host workspace-files Remote owner: read-only directory browse and text
 * read over one registered Workspace's tree, confined to the Workspace root
 * (nativization plan chapter 54). Containment is canonical — the fs
 * capability resolves both the root and the request, then `contains` decides
 * — so neither string normalization nor traversal attempts can name anything
 * outside the registered root. The child stays pending until a filesystem
 * backend is composed, mirroring the directory-picking child.
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import { FsError } from '@deepseek-ai/dsh-fs'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { Remote, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import type { WorkspaceFilesListValue, WorkspaceFilesReadValue } from './types.ts'

/**
 * Default byte cap one read accepts before range requests become mandatory.
 * Deployment compositions raise or lower it through the plugin config.
 */
export const DEFAULT_WORKSPACE_FILE_MAX_BYTES = 256 * 1024

/** Plugin configuration. */
export interface Config {
  /** Inclusive byte cap a single read accepts before rejecting with `file-too-large`. */
  maxReadBytes?: number
}

const listRequestSchema = zod.object({
  workspaceId: zod.string().min(1),
  path: zod.string().optional(),
})

const readRequestSchema = zod.object({
  workspaceId: zod.string().min(1),
  path: zod.string().min(1),
  offset: zod.number().int().nonnegative().optional(),
  limit: zod.number().int().positive().optional(),
})

/**
 * Media types for the extensions a companion commonly renders; a file that
 * decoded as text but has no known extension reports `text/plain`.
 */
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  css: 'text/css',
  csv: 'text/csv',
  html: 'text/html',
  htm: 'text/html',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  mts: 'text/typescript',
  cts: 'text/typescript',
  tsx: 'text/typescript',
  json: 'application/json',
  jsonc: 'application/json',
  md: 'text/markdown',
  mdx: 'text/markdown',
  py: 'text/x-python',
  rs: 'text/x-rust',
  go: 'text/x-go',
  java: 'text/x-java',
  kt: 'text/x-kotlin',
  swift: 'text/x-swift',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  hpp: 'text/x-c++',
  cs: 'text/x-csharp',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
  zsh: 'text/x-shellscript',
  fish: 'text/x-shellscript',
  ps1: 'text/x-powershell',
  psm1: 'text/x-powershell',
  bat: 'text/x-batch',
  cmd: 'text/x-batch',
  sql: 'application/sql',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  toml: 'text/x-toml',
  ini: 'text/plain',
  cfg: 'text/plain',
  conf: 'text/plain',
  txt: 'text/plain',
  log: 'text/plain',
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host read-only Workspace file-browse Remote namespace owner. */
    workspaceFiles: WorkspaceFiles
  }
}

/**
 * Host service backing the generated `ctx.remote.workspaceFiles` namespace.
 * Every verb resolves the registered root canonically and confines the
 * request under it before touching the backend; content reads are text-only
 * with a byte cap and a UTF-16 range.
 */
export class WorkspaceFiles extends TypertRemoteService {
  static inject = ['fs', 'workspaceRegistry']

  static Config: z<Config> = z.object({
    maxReadBytes: z.number().default(DEFAULT_WORKSPACE_FILE_MAX_BYTES),
  })

  private readonly maxReadBytes: number

  /**
   * @param ctx - Host context carrying the filesystem backend and Workspace registry.
   * @param config - read-cap policy.
   */
  constructor(ctx: Context, config: Config) {
    super(ctx, 'workspaceFiles', { namespace: 'workspaceFiles' })
    this.maxReadBytes = config.maxReadBytes ?? DEFAULT_WORKSPACE_FILE_MAX_BYTES
  }

  /**
   * List one directory level inside a registered Workspace.
   * @param workspaceId - registered Workspace identity.
   * @param path - relative directory path; absent lists the root.
   * @param signal - caller cancellation.
   * @returns the level's normalized relative path and its children.
   */
  @Remote('list')
  async list(
    workspaceId: string,
    path: string | undefined,
    signal?: AbortSignal,
  ): Promise<WorkspaceFilesListValue> {
    const parsed = listRequestSchema.safeParse(
      path === undefined ? { workspaceId } : { workspaceId, path },
    )
    if (!parsed.success) throw badRequest(parsed.error.issues)
    signal?.throwIfAborted()
    const { root } = await this.workspaceRoot(parsed.data.workspaceId)
    const relative = normalizeRelative(parsed.data.path ?? '')
    const target = await this.confined(root, parsed.data.workspaceId, relative)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw filesFailure('file-not-found', `no such directory "${relative}"`, { path: relative })
    if (info.type === 'file') {
      throw filesFailure('not-a-directory', `"${relative}" is a regular file`, { path: relative })
    }
    if (info.type !== 'directory') {
      throw filesFailure('not-a-directory', `"${relative}" is not a directory`, { path: relative })
    }
    const entries = await this.ctx.fs.listDir(target, signal)
    return {
      path: relative,
      entries: entries.map(entry => ({
        name: entry.name,
        type: entry.type,
        ...entry.size === undefined ? {} : { size: entry.size },
      })),
    }
  }

  /**
   * Read one text file inside a registered Workspace as a UTF-16 range.
   * @param workspaceId - registered Workspace identity.
   * @param path - relative file path.
   * @param offset - range start in UTF-16 code units; absent starts at zero.
   * @param limit - maximum returned code units; absent reads through the end.
   * @param signal - caller cancellation.
   * @returns the decoded range with its media type and total size.
   */
  @Remote('read')
  async read(
    workspaceId: string,
    path: string,
    offset: number | undefined,
    limit: number | undefined,
    signal?: AbortSignal,
  ): Promise<WorkspaceFilesReadValue> {
    const parsed = readRequestSchema.safeParse({
      workspaceId,
      path,
      ...(offset === undefined ? {} : { offset }),
      ...(limit === undefined ? {} : { limit }),
    })
    if (!parsed.success) throw badRequest(parsed.error.issues)
    signal?.throwIfAborted()
    const { root } = await this.workspaceRoot(parsed.data.workspaceId)
    const relative = normalizeRelative(parsed.data.path)
    const target = await this.confined(root, parsed.data.workspaceId, relative)
    const info = await this.ctx.fs.stat(target, signal)
    if (info === undefined) throw filesFailure('file-not-found', `no such file "${relative}"`, { path: relative })
    if (info.type !== 'file') {
      throw filesFailure('not-a-regular-file', `"${relative}" is not a regular file`, { path: relative })
    }
    const start = parsed.data.offset ?? 0
    // An explicitly bounded page may exceed the cap's file size: paging is
    // how a companion reads a large file. Only an unbounded read demands the
    // whole remaining file fit the cap.
    const bounded = parsed.data.limit !== undefined && parsed.data.limit <= this.maxReadBytes
    if (!bounded && info.size !== undefined && info.size > this.maxReadBytes) {
      throw filesFailure(
        'file-too-large',
        `"${relative}" is ${info.size} bytes; read it in ranges or raise the cap of ${this.maxReadBytes}`,
        { path: relative, size: info.size, maxBytes: this.maxReadBytes },
      )
    }
    let content: string
    try {
      content = await this.ctx.fs.readText(target, signal)
    } catch (error) {
      throw readFailure(error, relative, this.maxReadBytes)
    }
    const end = parsed.data.limit === undefined ? content.length : Math.min(start + parsed.data.limit, content.length)
    if (end - start > this.maxReadBytes) {
      throw filesFailure(
        'file-too-large',
        `the requested range of "${relative}" exceeds the cap of ${this.maxReadBytes} code units`,
        { path: relative, size: content.length, maxBytes: this.maxReadBytes },
      )
    }
    const sliced = start === 0 && end === content.length ? content : content.slice(start, end)
    return {
      content: sliced,
      truncated: end < content.length,
      size: content.length,
      mediaType: mediaTypeOf(relative),
    }
  }

  /** Resolve the registered Workspace's canonical root target. */
  private async workspaceRoot(workspaceId: string): Promise<{ root: FsTarget }> {
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) {
      throw filesFailure('workspace-not-found', `Workspace "${workspaceId}" not found`, { workspaceId })
    }
    return { root: await this.ctx.fs.resolve(workspace.path) }
  }

  /** Resolve a normalized relative path under the root and prove containment. */
  private async confined(root: FsTarget, workspaceId: string, relative: string): Promise<FsTarget> {
    if (relative === ROOT_ESCAPE) {
      throw outside(workspaceId, relative)
    }
    const target = await this.ctx.fs.resolve(relative === '' ? '.' : relative, { cwd: this.ctx.fs.processPath(root) })
    if (!this.ctx.fs.contains(root, target)) throw outside(workspaceId, relative)
    return target
  }
}

/** Sentinel a normalization that climbed above the root produces. */
const ROOT_ESCAPE = '\0escape'

/**
 * Normalize one relative path: POSIX separators, no `.` segments, `..`
 * resolved against the stack. Climbing above the root yields the escape
 * sentinel the caller rejects before touching the backend.
 * @param path - caller-supplied relative path.
 * @returns the normalized relative path; '' names the root.
 */
function normalizeRelative(path: string): string {
  const stack: string[] = []
  for (const segment of path.split(/[/\\]/u)) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (stack.length === 0) return ROOT_ESCAPE
      stack.pop()
      continue
    }
    stack.push(segment)
  }
  return stack.join('/')
}

function outside(workspaceId: string, path: string): TypertRemoteFailure {
  return filesFailure(
    'path-outside-workspace',
    `"${path}" escapes the Workspace root`,
    { workspaceId, path },
  )
}

function badRequest(issues: ReadonlyArray<{ message: string }>): TypertRemoteFailure {
  return filesFailure('bad-request', 'invalid workspaceFiles payload', { issues: issues.map(issue => ({ message: issue.message })) })
}

function mediaTypeOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
  return MEDIA_TYPES[extension] ?? 'text/plain'
}

/**
 * Classify a text-read rejection: the backend's binary and size codes carry
 * the file they are about; anything else stays an infrastructure failure.
 * @param error - the backend's rejection.
 * @param path - the relative path being read.
 * @returns the failure to throw across the Remote boundary.
 */
function readFailure(error: unknown, path: string, maxReadBytes: number): TypertRemoteFailure {
  if (error instanceof FsError) {
    if (error.code === 'FS_NOT_TEXT') {
      return filesFailure('file-binary', `"${path}" is not decodable text`, { path })
    }
    if (error.code === 'FS_TOO_LARGE') {
      // A backend that caps reads without reporting sizes leaves the concrete
      // size unknown; only the cap it enforced is knowable here.
      return filesFailure(
        'file-too-large',
        `"${path}" exceeds the backend read cap`,
        { path, maxBytes: maxReadBytes },
      )
    }
  }
  return filesFailure('internal', error instanceof Error ? error.message : String(error), {})
}

/**
 * Raise one entry of the file-browse wire failure vocabulary.
 * @param code - the failure code a caller discriminates on.
 * @param message - operator-facing description.
 * @param details - the payload this code carries.
 * @returns the failure to throw across the Remote boundary.
 */
function filesFailure(code: string, message: string, details: object): TypertRemoteFailure {
  return new TypertRemoteFailure({ code, message, details })
}
