/** Session-log download command and Host-owned streaming route. */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-attachment'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  flushLiveSessionLog,
  readSessionLogText,
  sessionLogExportDeps,
  sessionLogZipFilename,
  streamSessionLogZip,
  type SessionLogCompressionLevel,
  type SessionLogExportReady,
} from './archive.ts'

export {
  DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
  flushLiveSessionLog,
  readSessionLogText,
  serializeSessionLog,
  SESSION_LOG_FILENAME,
  SESSION_LOG_ZIP_MTIME,
  sessionLogExportDeps,
  sessionLogZipEntries,
  sessionLogZipFilename,
  streamSessionLogZip,
} from './archive.ts'
export type {
  SessionLogCompressionLevel,
  SessionLogExportDeps,
  SessionLogExportReady,
  SessionLogZipEntry,
} from './archive.ts'

export const name = 'session-log-download'
export const inject = ['commands', 'connection']

/** Stable browser download path retained across the transport migration. */
export const SESSION_LOG_EXPORT_PATH = '/api/session.export'

/** Session-log archive policy. */
export interface Config {
  /** DEFLATE level for each ZIP entry. @default 6 */
  readonly compressionLevel?: SessionLogCompressionLevel
}

/** Validate Session-log archive configuration. */
export const Config: Schema<Config> = Schema.object({
  compressionLevel: Schema.number().step(1).min(0).max(9)
    .default(DEFAULT_SESSION_LOG_COMPRESSION_LEVEL) as Schema<SessionLogCompressionLevel>,
})

interface SessionLogConnection {
  readonly fetch: {
    register(route: {
      readonly path: string
      readonly methods: readonly ('GET' | 'HEAD')[]
      readonly requestBody: 'buffered'
      readonly fetch: (request: Request) => Promise<Response>
    }): () => Promise<void>
  }
}

const REQUESTED: CommandResult = {
  kind: 'success',
  text: 'Session log download requested.',
}

/**
 * Register the Web-only `/export` command and the authenticated ZIP download
 * route, which serves deterministic archives with HTTP byte-range resume.
 * @param ctx - Host context carrying the human-command registry.
 * @param config - resolved compression policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  ctx.effect(() => ctx.commands.register({
    definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-session-log-export'),
    name: 'export',
    description: 'Download this Session log as a ZIP archive',
    risk: 'moderate' as const,
    handler: invocation => Promise.resolve(invocation.rawInput.trim() === ''
      ? REQUESTED
      : { kind: 'error', text: 'The Web /export command does not accept a path.' }),
  }), 'session-log-download: command')
  connectionOf(ctx).fetch.register({
    path: SESSION_LOG_EXPORT_PATH,
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const response = await sessionLogExportResponse(
        ctx,
        request,
        config.compressionLevel ?? DEFAULT_SESSION_LOG_COMPRESSION_LEVEL,
      )
      if (request.method === 'GET') return response
      await response.body?.cancel()
      return new Response(null, { status: response.status, headers: response.headers })
    },
  })
}

function connectionOf(ctx: Context): SessionLogConnection {
  return Reflect.get(ctx, 'connection') as SessionLogConnection
}

/** Byte-range forms this route serves: `bytes=N-` and `bytes=N-M`, digits only. */
const RANGE_REQUEST = /^bytes=(\d+)-(\d*)$/

/** One satisfiable-looking `bytes=` range request. */
interface ByteRangeRequest {
  /** First byte position requested. */
  readonly start: number
  /** Last byte position requested; undefined when the client sent `N-`. */
  readonly end: number | undefined
}

/**
 * Parse one Range header into the `bytes=N-`/`bytes=N-M` form this route
 * serves. Suffix ranges, multi-ranges, other units, and a last byte before
 * the first are not errors: HTTP requires ignoring such headers, and the
 * caller then serves the whole archive.
 * @param header - the raw Range header value.
 * @returns the parsed range, or undefined when the header is not one single
 * well-formed ascending byte range.
 */
function parseRangeRequest(header: string): ByteRangeRequest | undefined {
  const match = header.match(RANGE_REQUEST)
  if (match === null) return undefined
  const start = Number(match[1])
  const end = match[2] === '' ? undefined : Number(match[2])
  if (end !== undefined && end < start) return undefined
  return { start, end }
}

/**
 * Measure one archive generation's total byte length.
 * @param ready - the mounted export services.
 * @param rootContent - the already-serialized root log.
 * @param sessionId - the root session id.
 * @param includeDescendants - whether to include every subagent descendant.
 * @param compressionLevel - the resolved DEFLATE level.
 * @param request - the driving request; aborts propagate, failures map to 500.
 * @returns the total bytes, or undefined when generation fails mid-archive.
 */
async function measureArchiveBytes(
  ready: SessionLogExportReady,
  rootContent: string,
  sessionId: SessionId,
  includeDescendants: boolean,
  compressionLevel: SessionLogCompressionLevel,
  request: Request,
): Promise<number | undefined> {
  try {
    let totalBytes = 0
    for await (const chunk of streamSessionLogZip(
      ready, rootContent, sessionId, includeDescendants, compressionLevel, request.signal,
    )) {
      totalBytes += chunk.byteLength
    }
    return totalBytes
  } catch {
    request.signal.throwIfAborted()
    // A mid-archive failure (missing descendant log, attachment read error)
    // maps to the caller's 500, which does not echo the error because it may
    // carry absolute host paths into the browser error bar.
    return undefined
  }
}

/**
 * Re-emit a deterministic archive stream starting at `start` for `length`
 * bytes; source chunks past the range drain through without re-emission.
 * @param stream - the freshly generated archive stream.
 * @param start - first byte to emit.
 * @param length - how many bytes to emit.
 * @returns the sliced stream; it closes when the source archive ends.
 */
function sliceByteRange(
  stream: ReadableStream<Uint8Array>,
  start: number,
  length: number,
): ReadableStream<Uint8Array> {
  let skipped = 0
  let emitted = 0
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (emitted >= length) return
      let view = chunk
      if (skipped < start) {
        const toSkip = start - skipped
        if (chunk.byteLength <= toSkip) {
          skipped += chunk.byteLength
          return
        }
        skipped = start
        view = chunk.subarray(toSkip)
      }
      const room = length - emitted
      if (view.byteLength > room) view = view.subarray(0, room)
      emitted += view.byteLength
      controller.enqueue(view)
    },
  }))
}

async function sessionLogExportResponse(
  ctx: Context,
  request: Request,
  compressionLevel: SessionLogCompressionLevel,
): Promise<Response> {
  const url = new URL(request.url)
  const query = Object.fromEntries(url.searchParams)
  const sessionIdValue = query['sessionId']
  const descendantsValue = query['includeDescendants']
  if (sessionIdValue === undefined || sessionIdValue.length === 0
    || (descendantsValue !== undefined && descendantsValue !== 'true' && descendantsValue !== 'false')) {
    return new Response('missing or invalid sessionId query parameter', { status: 400 })
  }
  const sessionId = brandString<SessionId>(sessionIdValue)
  const deps = sessionLogExportDeps(ctx)
  if (deps.sessionQuery === undefined
    || deps.sessionPersistence === undefined
    || deps.attachments === undefined) {
    return new Response(
      'session log export is unavailable: missing session-query, session-persistence, or attachments service',
      { status: 500 },
    )
  }
  const ready: SessionLogExportReady = {
    sessionQuery: deps.sessionQuery,
    sessionPersistence: deps.sessionPersistence,
    attachments: deps.attachments,
    sessions: deps.sessions,
  }
  let rootContent: string | undefined
  try {
    await flushLiveSessionLog(deps, sessionId, request.signal)
    rootContent = await readSessionLogText(deps.sessionPersistence, sessionId, request.signal)
    request.signal.throwIfAborted()
  } catch {
    request.signal.throwIfAborted()
    // Root preparation failure (flush, open, or read): answer 500 without
    // echoing the error, which may carry absolute host paths into the
    // browser error bar.
    return new Response('session log export failed to read the stored log', { status: 500 })
  }
  if (rootContent === undefined) {
    return new Response('session not found', { status: 404 })
  }
  const includeDescendants = descendantsValue === 'true'
  const headers = new Headers({
    'content-type': 'application/zip',
    'content-disposition': `attachment; filename="${sessionLogZipFilename(sessionId)}"`,
    'accept-ranges': 'bytes',
  })
  // HEAD reports the archive's exact length without streaming a body. HTTP
  // requires ignoring a Range header received with any method other than GET,
  // so HEAD measures one generation and stops.
  if (request.method === 'HEAD') {
    const totalBytes = await measureArchiveBytes(
      ready, rootContent, sessionId, includeDescendants, compressionLevel, request,
    )
    if (totalBytes === undefined) {
      return new Response('session log export failed to read the stored log', { status: 500 })
    }
    headers.set('content-length', String(totalBytes))
    return new Response(null, { status: 200, headers })
  }
  const rangeHeader = request.headers.get('range')
  const range = rangeHeader === null ? undefined : parseRangeRequest(rangeHeader)
  // A plain download streams one generation and carries no Content-Length:
  // the archive's compressed size is unknown without generating it, and the
  // browser download continues from a later 206's Content-Range anyway.
  if (range === undefined) {
    return new Response(
      streamSessionLogZip(
        ready, rootContent, sessionId, includeDescendants, compressionLevel, request.signal,
      ),
      { status: 200, headers },
    )
  }
  // A range request needs the archive's total length before the first byte
  // ships: the first streaming pass measures it, and the fixed entry mtime
  // makes the second pass byte-identical, so the measured length describes
  // the served bytes. Only resume requests pay the second generation.
  const totalBytes = await measureArchiveBytes(
    ready, rootContent, sessionId, includeDescendants, compressionLevel, request,
  )
  if (totalBytes === undefined) {
    return new Response('session log export failed to read the stored log', { status: 500 })
  }
  if (range.start >= totalBytes) {
    headers.set('content-range', `bytes */${totalBytes}`)
    return new Response(null, { status: 416, headers })
  }
  const end = Math.min(range.end ?? (totalBytes - 1), totalBytes - 1)
  const length = end - range.start + 1
  headers.set('content-range', `bytes ${range.start}-${end}/${totalBytes}`)
  headers.set('content-length', String(length))
  return new Response(
    sliceByteRange(
      streamSessionLogZip(
        ready, rootContent, sessionId, includeDescendants, compressionLevel, request.signal,
      ),
      range.start,
      length,
    ),
    { status: 206, headers },
  )
}
