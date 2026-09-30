/** Host-side IPC bridge for the Android Host-restart acceptance e2e. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'

export const name = 'android-host-restart-fixture'
export const inject = ['nativeRemote', 'deviceTrust', 'hostDescription', 'sessionController', 'sessions']

/** No deployment-varying choices; this plugin exists only for private test IPC. */
export interface Config {}

export const Config: z<Config> = z.object({})

/** One request from the owning test process; every response echoes `rid`. */
type IpcRequest =
  | { kind: 'issuePairing'; rid: number }
  | { kind: 'describe'; rid: number }
  | { kind: 'createSession'; rid: number; cwd?: string }
  | { kind: 'observe'; rid: number; sessionId?: string }
  | { kind: 'flush'; rid: number; sessionId?: string }

/** Public identity facts of this Host process, read from the live services. */
function hostFacts(ctx: Context): {
  pid: number
  nativePort: number
  spkiFingerprint: string
  hostId: string
  displayName: string
  capabilities: readonly string[]
  devices: number
} {
  const native = ctx.nativeRemote.describe()
  const host = ctx.hostDescription.describe()
  return {
    pid: process.pid,
    nativePort: native.port,
    spkiFingerprint: native.spkiFingerprint,
    hostId: host.hostId,
    displayName: host.displayName,
    capabilities: host.capabilities,
    devices: ctx.deviceTrust.listDevices().length,
  }
}

/**
 * @param ctx - Isolated profile Context supplying the native listener, device trust, and Session services.
 * @param _config - Accepted and ignored; the driver owns every scenario choice.
 */
export function apply(ctx: Context, _config: Config): void {
  if (process.env.DSH_HOME === undefined) throw new Error('android host-restart fixture requires an isolated DSH_HOME')
  let observed: SessionId | undefined
  const send = (message: object): void => {
    process.send?.(message)
  }
  process.on('message', (request: IpcRequest) => {
    void (async () => {
      try {
        switch (request.kind) {
          case 'issuePairing': {
            const issued = ctx.deviceTrust.issuePairing('collaborator')
            send({ kind: 'pairing', rid: request.rid, code: issued.code, expiresAt: issued.expiresAt, role: issued.role })
            break
          }
          case 'describe': {
            send({ kind: 'describe', rid: request.rid, ...hostFacts(ctx) })
            break
          }
          case 'createSession': {
            const { sessionId } = await ctx.sessionController.create({ cwd: request.cwd ?? process.cwd() })
            observed = sessionId
            send({ kind: 'session', rid: request.rid, sessionId })
            break
          }
          case 'observe': {
            if (request.sessionId === undefined) throw new Error('observe requires sessionId')
            observed = request.sessionId as SessionId
            send({ kind: 'observed', rid: request.rid })
            break
          }
          case 'flush': {
            if (request.sessionId === undefined) throw new Error('flush requires sessionId')
            const session = ctx.sessions.get(request.sessionId as SessionId)
            if (session === undefined) throw new Error(`session ${request.sessionId} is not live in this Host process`)
            const flushed = await ctx.sessions.flush(session)
            send({ kind: 'flushed', rid: request.rid, flushed })
            break
          }
          default: {
            const exhaustive: never = request
            throw new Error(`unsupported IPC request ${JSON.stringify(exhaustive)}`)
          }
        }
      } catch (error) {
        send({ kind: 'error', rid: request.rid, message: String(error) })
      }
    })()
  })
  ctx.on('session/event', (session, event: SessionEvent) => {
    if (observed === undefined || session.id !== observed) return
    if (event.type === 'user/message') {
      const message = event.data
      send({ kind: 'session-event', type: 'user/message', seq: event.seq, source: message.source.kind })
    } else if (event.type === 'turn/end') {
      const end = event.data
      send({ kind: 'session-event', type: 'turn/end', turn: end.turn, reason: end.reason.kind })
    }
  })
  void ctx.loader.await().then(() => {
    send({ kind: 'ready', ...hostFacts(ctx) })
  })
}
