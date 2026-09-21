/**
 * Client projection of generated Typert Remote descriptors. Contributions
 * install traced `remote.<namespace>` services; no JavaScript Proxy
 * participates in method lookup, invocation, or type exposure.
 */

import { encodeRemotePayload } from '../protocol.ts'
import { Service } from '@deepseek-ai/cordis'
import { RemoteError, classifyRemoteFailure, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { ConnectionHttpError } from '@deepseek-ai/dsh-client-connection/client'
export type { TypertGatewayFaultDetails } from '../remote-error-codes.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ConnectionHandle,
  ConnectionHostInfo,
} from '@deepseek-ai/dsh-client-connection/client'
import type {
  InvocationDescriptor,
  TypertClientEventListener,
  TypertClientRemote,
  RemoteFailure,
  RemoteResult,
  TypertCodec,
  TypertDisposer,
  TypertRemoteContribution,
  TypertRemoteEvent,
} from '@deepseek-ai/dsh-typert-protocol'
import {
  RemoteStreamCarrierError,
  RemoteStreamMuxClient,
} from './stream-client.ts'
import { ClientRemoteEvents } from './remote-events.ts'
import { ClientRemotePreparation, type RemotePreparation, type RemoteAdmission } from './preparation.ts'
export type { RemotePreparation, RemotePreparationFacts, RemoteAdmission, RemoteInteractionReplyScope } from './preparation.ts'
import {
  RemoteStream,
  type RemoteStreamOptions,
} from './remote-stream.ts'

export { RemoteStreamCarrierError } from './stream-client.ts'
export { RemoteJournalStream } from './journal-stream.ts'
export type {
  RemoteJournalChange,
  RemoteJournalFrame,
  RemoteJournalStreamOptions,
  RemoteStreamFactory,
} from './journal-stream.ts'
export { RemoteStream } from './remote-stream.ts'
export type { RemoteStreamItem, RemoteStreamOptions } from './remote-stream.ts'
export { RemoteSnapshotStream } from './snapshot-stream.ts'
export type { RemoteSnapshotStreamOptions } from './snapshot-stream.ts'

interface MountToken {
  active: boolean
  readonly abort: AbortController
}

interface ScopedProjection {
  readonly context: string
  readonly wire: string
  readonly codec: TypertCodec
  readonly parameterIndex?: number
}

interface DirectMethod {
  readonly descriptor: InvocationDescriptor
  readonly token: MountToken
}

interface ScopedMethod extends DirectMethod {
  readonly projection: ScopedProjection
}

interface RemoteMethodRecord {
  direct?: DirectMethod
  scoped?: ScopedMethod
}

interface BoundContextIdentity {
  readonly value: unknown
}

interface PreparedClientInvocation {
  readonly endpoint: string
  readonly args: Readonly<Record<string, unknown>>
  readonly signal: AbortSignal
}

interface RemoteNamespaceHandle {
  readonly service: RemoteNamespaceService
  readonly dispose: TypertDisposer
}

interface LoaderReadiness {
  await(): Promise<unknown>
}

/** One descriptor's mounted variants, for the group disposer to unwind. */
interface InstalledMethod {
  readonly descriptor: InvocationDescriptor
  readonly token: MountToken
  direct: boolean
  scoped: boolean
}

/** Typed Remote service augmented by generated direct namespaces and Gateway stream supervision. */
export interface ClientRemote extends TypertClientRemote {
  /**
   * Install application discovery before mounting selected business namespaces.
   * @param prepare - first unary exchange and compatibility validation for each attempt.
   * @param admission - optional application operation policy checked before carrier dispatch.
   * @returns disposer withdrawing admission until another owner is registered.
   */
  $prepare(prepare: RemotePreparation, admission?: RemoteAdmission): () => Promise<void>
  /**
   * Create one independently cancellable, reconnecting logical stream.
   * @param options - domain-owned opener and generation-end classification.
   * @returns a single-consumer stream annotated with physical generation ids.
   */
  $stream<Item>(options: RemoteStreamOptions<Item>): RemoteStream<Item>
  /**
   * Current admitted Host facts as plain reads. Generation loss clears the facts;
   * consumers subscribe through Connection when they need change notifications.
   */
  readonly $host: RemoteHostFacts
}

/** The admitted generation's Host facts exposed on `ctx.remote.$host`. */
export interface RemoteHostFacts extends Omit<ConnectionHostInfo, 'home' | 'platform'> {
  /** Host home directory from the ready frame, undefined before it. */
  readonly home: string | undefined
  /** Host Node.js platform from the ready frame, undefined before it. */
  readonly platform: string | undefined
  /** Whether the carrier connects to the local Host. */
  readonly isLoopback: boolean
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by the Client assembly. */
    remote: ClientRemote
  }
}

/** Required Client services: the Typert registry and the existing Connection carrier. */
export const inject = ['typert', 'connection']

/**
 * Install the typed Client Remote service.
 * @param ctx - Client Cordis root.
 */
export function apply(ctx: Context): void {
  new ClientRemoteService(ctx)
}

class ClientRemoteService extends Service implements ClientRemote {
  private readonly ownerCtx: Context
  private readonly connection: ConnectionHandle
  private readonly namespaces = new Map<string, RemoteNamespaceHandle>()
  private hostFacts: RemoteHostFacts | undefined
  private readonly streams = new RemoteStreamMuxClient()
  private readonly events: ClientRemoteEvents
  private readonly preparation: ClientRemotePreparation
  private hostGeneration: ConnectionHostInfo | undefined
  private mutations = Promise.resolve()

  constructor(ctx: Context) {
    super(ctx, 'remote')
    this.ownerCtx = ctx
    const connection = ctx.get('connection') as ConnectionHandle
    this.connection = connection
    this.preparation = new ClientRemotePreparation(connection)
    this.events = new ClientRemoteEvents(
      ctx,
      connection,
      (endpoint, payload, signal) => this.openRemoteStream(endpoint, payload, signal),
      (signal, progress) => this.preparation.run(signal, progress),
    )
    if (connection.rpc.open === undefined) this.streams.start()
    let disposed = false
    let loop: ReturnType<ConnectionHandle['start']> | undefined
    const start = (): void => {
      if (disposed) return
      if (connection.rpc.open === undefined) this.streams.start()
      loop = connection.start({
        onConnected: () => { this.ownerCtx.emit('connection/reset') },
        classifyFailure: (error) => {
          // Device admissions answer with identity verdicts the Connection
          // surface must confirm instead of retrying: a revoked grant blocks
          // as device-revoked, an identity the Host no longer holds or a key
          // it no longer matches blocks as identity-changed (re-pair). The
          // code comparison is a plain string match because the client face
          // does not link the device-trust package's details-map declaration;
          // the vocabulary is merge-extensible over the wire. Only
          // generation-terminal classes select a phase; the remaining classes
          // keep the default reconnect behavior of the generation loop.
          const remote = remoteErrorOf(error)
          const code: string | undefined = remote?.code
          if (code === 'device/already-revoked') return 'device-revoked'
          if (code === 'device/not-found' || code === 'device/key-invalid') return 'identity-changed'
          switch (classifyRemoteFailure(error)) {
            case 'compatibility': return 'incompatible'
            case 'carrier-invalid': return 'fatal'
            default: return undefined
          }
        },
        onReconnectRequested: () => {
          if (connection.rpc.open === undefined) this.streams.reconnect()
        },
      })
    }
    const loader = ctx.get('loader') as LoaderReadiness | undefined
    if (loader === undefined) start()
    else void loader.await().then(start, () => {})
    ctx.effect(() => async () => {
      disposed = true
      loop?.stop()
      await this.events.dispose()
      await this.streams.close()
    }, 'api-gateway.client.transport')
  }

  $stream<Item>(options: RemoteStreamOptions<Item>): RemoteStream<Item> {
    return new RemoteStream(this.connection, options)
  }

  $prepare(prepare: RemotePreparation, admission?: RemoteAdmission): () => Promise<void> {
    const dispose = this.ctx.effect(() => this.preparation.register(prepare, admission), 'api-gateway.client.preparation')
    return async () => { await dispose() }
  }

  get $host(): RemoteHostFacts {
    // Snapshot identity follows the admitted generation; isLoopback is page-local.
    const host = this.connection.generation.getSnapshot()?.host
    if (this.hostFacts === undefined || this.hostGeneration !== host) {
      this.hostGeneration = host
      this.hostFacts = { ...host, home: host?.home, platform: host?.platform, isLoopback: this.connection.isLoopback }
    }
    return this.hostFacts
  }

  async $mount(contribution: TypertRemoteContribution): ReturnType<TypertClientRemote['$mount']> {
    const callerCtx = this.ctx
    const owned = callerCtx.effect(async () => {
      const dispose = await this.enqueue(() => this.mountContribution(callerCtx, contribution))
      return () => this.enqueue(dispose)
    }, `api-gateway.client.$mount(${JSON.stringify(contribution.package)})`)
    await owned
    return async () => { await owned() }
  }

  $on<Event extends TypertRemoteEvent>(
    event: Event,
    listener: TypertClientEventListener<Event>,
  ): () => void {
    return this.events.subscribe(this.ctx, event, listener)
  }

  /** Open one Remote stream and normalize a worker-local carrier's structural failures. */
  private openRemoteStream(
    endpoint: string,
    payload: unknown,
    signal: AbortSignal,
    noConnection = `client api: ${endpoint} has no active Connection`,
  ): AsyncIterable<unknown> {
    const connection = this.ownerCtx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error(noConnection)
    const local = connection.rpc.open?.('/api', endpoint, payload, signal)
    return local === undefined
      ? this.streams.open(endpoint, payload, signal)
      : normalizeConnectionStream(local)
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const result = this.mutations.then(operation, operation)
    this.mutations = result.then(() => undefined, () => undefined)
    return result
  }

  private async mountContribution(
    callerCtx: Context,
    contribution: TypertRemoteContribution,
  ): Promise<TypertDisposer> {
    this.validateContribution(contribution)
    const disposeRemote = callerCtx.typert.remotes.register(contribution)
    const groups = new Map<string, InvocationDescriptor[]>()
    for (const descriptor of contribution.descriptors) {
      const group = groups.get(descriptor.namespace)
      if (group === undefined) groups.set(descriptor.namespace, [descriptor])
      else group.push(descriptor)
    }
    const installed: TypertDisposer[] = []
    try {
      for (const [namespace, descriptors] of groups) {
        installed.push(await this.installNamespace(namespace, descriptors))
      }
    } catch (error) {
      for (const dispose of installed.reverse()) await dispose()
      await disposeRemote()
      throw error
    }
    return async () => {
      for (const dispose of installed.reverse()) await dispose()
      await disposeRemote()
    }
  }

  private validateContribution(contribution: TypertRemoteContribution): void {
    const direct = new Map<string, Set<string>>()
    const scoped = new Map<string, Set<string>>()
    const add = (
      table: Map<string, Set<string>>,
      descriptor: InvocationDescriptor,
      kind: 'direct' | 'scoped',
    ): void => {
      const methods = table.get(descriptor.namespace) ?? new Set<string>()
      if (methods.has(descriptor.method)) {
        throw new Error(`client api: contribution repeats ${kind} method ${endpointOf(descriptor)}`)
      }
      methods.add(descriptor.method)
      table.set(descriptor.namespace, methods)
      const namespace = this.namespaces.get(descriptor.namespace)?.service
      if (namespace?.has(kind, descriptor.method) === true) {
        throw new Error(`client api: ${kind} method ${endpointOf(descriptor)} is already mounted`)
      }
    }
    for (const descriptor of contribution.descriptors) {
      requireStrictDescriptor(descriptor)
      if (descriptor.invocation.kind === 'direct') add(direct, descriptor, 'direct')
      if (scopedProjection(descriptor) !== undefined) add(scoped, descriptor, 'scoped')
    }
    const namespaces = new Set([...direct.keys(), ...scoped.keys()])
    for (const namespace of namespaces) {
      const service = this.namespaces.get(namespace)?.service
      if (service === undefined) {
        if (namespace in this) {
          throw new Error(`client api: namespace ${JSON.stringify(namespace)} conflicts with the Remote service`)
        }
        const serviceKey = remoteServiceKey(namespace)
        const property = this.ownerCtx.reflect.props[serviceKey]
        if (property?.type === 'accessor' || this.ownerCtx.get(serviceKey) !== undefined) {
          throw new Error(`client api: namespace ${JSON.stringify(namespace)} conflicts with an existing Remote namespace`)
        }
      }
      for (const method of new Set([...(direct.get(namespace) ?? []), ...(scoped.get(namespace) ?? [])])) {
        if (service === undefined) RemoteNamespaceService.assertMethodAvailable(namespace, method)
        else service.assertMethodAvailable(method)
      }
    }
  }

  /**
   * Mount one namespace's descriptor group with no visibility gap: a fresh
   * namespace installs its whole group synchronously inside its fiber's
   * apply, so a plugin parked on the namespace service never observes it
   * without the methods the same contribution carries; an existing namespace
   * takes the group in one synchronous step.
   * @param name - Remote namespace.
   * @param descriptors - Every contribution descriptor naming that namespace.
   * @returns disposer unmounting the group and the namespace once empty.
   */
  private async installNamespace(
    name: string,
    descriptors: readonly InvocationDescriptor[],
  ): Promise<TypertDisposer> {
    let namespace = this.namespaces.get(name)
    let installed: InstalledMethod[]
    if (namespace === undefined) {
      ({ namespace, installed } = await this.createNamespace(name, descriptors))
    } else {
      installed = installMethods(namespace.service, descriptors)
    }
    const handle = namespace
    return async () => {
      for (const method of [...installed].reverse()) {
        /* v8 ignore next -- Cordis effect disposers are idempotent and invoke this cleanup at most once. */
        if (!method.token.active) continue
        method.token.active = false
        method.token.abort.abort()
        if (method.scoped) handle.service.remove('scoped', method.descriptor.method, method.token)
        if (method.direct) handle.service.remove('direct', method.descriptor.method, method.token)
      }
      await this.disposeNamespace(name, handle)
    }
  }

  private async createNamespace(
    name: string,
    descriptors: readonly InvocationDescriptor[],
  ): Promise<{ namespace: RemoteNamespaceHandle; installed: InstalledMethod[] }> {
    let service: RemoteNamespaceService | undefined
    let installed: InstalledMethod[] | undefined
    const fiber = this.ownerCtx.plugin({
      name: remoteServiceKey(name),
      apply: (ctx: Context) => {
        service = new RemoteNamespaceService(
          ctx,
          name,
          (direct, scoped, caller, args) => this.invokeMethod(direct, scoped, caller, args),
        )
        // Same synchronous window as the service registration: a dependent the
        // new service unparks runs only after the methods exist.
        installed = installMethods(service, descriptors)
      },
    })
    try {
      await fiber
    } catch (error) {
      await fiber.dispose()
      throw error
    }
    /* v8 ignore next 3 -- a settled namespace fiber synchronously constructs its Service and installs the group. */
    if (service === undefined || installed === undefined) {
      throw new Error(`client api: namespace ${JSON.stringify(name)} did not start`)
    }
    const namespace = { service, dispose: fiber.dispose }
    this.namespaces.set(name, namespace)
    return { namespace, installed }
  }

  private async disposeNamespace(name: string, namespace: RemoteNamespaceHandle): Promise<void> {
    if (!namespace.service.empty || this.namespaces.get(name) !== namespace) return
    this.namespaces.delete(name)
    await namespace.dispose()
  }

  private invokeMethod(
    direct: DirectMethod | undefined,
    scoped: ScopedMethod | undefined,
    callerCtx: Context,
    values: readonly unknown[],
  ): Promise<RemoteResult<unknown>> | AsyncIterable<unknown> {
    if (scoped !== undefined) {
      const adapter = this.ownerCtx.typert.contexts.getClient(scoped.projection.context)
      const identity = adapter?.identity(callerCtx)
      if (identity !== undefined) {
        return this.invokeSelected(
          scoped.descriptor,
          scoped.projection,
          scoped.token,
          callerCtx,
          values,
          { value: identity },
        )
      }
    }
    if (direct !== undefined) {
      return this.invokeSelected(direct.descriptor, undefined, direct.token, callerCtx, values)
    }
    if (scoped !== undefined) {
      return this.invokeSelected(scoped.descriptor, scoped.projection, scoped.token, callerCtx, values)
    }
    throw new Error('client api: Remote method is no longer mounted')
  }

  private invokeSelected(
    descriptor: InvocationDescriptor,
    projection: ScopedProjection | undefined,
    token: MountToken,
    callerCtx: Context,
    values: readonly unknown[],
    boundIdentity?: BoundContextIdentity,
  ): Promise<RemoteResult<unknown>> | AsyncIterable<unknown> {
    if (descriptor.mode === 'stream') {
      return this.invokeStream(descriptor, projection, token, callerCtx, values, boundIdentity)
    }
    return this.invoke(descriptor, projection, token, callerCtx, values, boundIdentity)
  }

  private async invoke(
    descriptor: InvocationDescriptor,
    projection: ScopedProjection | undefined,
    token: MountToken,
    callerCtx: Context,
    values: readonly unknown[],
    boundIdentity?: BoundContextIdentity,
  ): Promise<RemoteResult<unknown>> {
    const endpoint = endpointOf(descriptor)
    if (!token.active) return withdrawn(endpoint)
    const prepared = this.prepareInvocation(descriptor, projection, token, callerCtx, values, boundIdentity)
    const connection = this.ownerCtx.get('connection') as ConnectionHandle | undefined
    if (connection === undefined) throw new Error(`client api: ${endpoint} has no active Connection`)
    let signal = prepared.signal
    try {
      const admission = await this.preparation.admit(signal, endpoint)
      signal = admission.signal
      signal.throwIfAborted()
      const result = await connection.rpc.call('/api', endpoint, encodeRemotePayload(prepared.args, admission.version), signal)
      if (!mountActive(token)) return withdrawn(endpoint)
      signal.throwIfAborted()
      if (!result.ok) return { ok: false, error: rebuiltFailure(result.error) }
      return { ok: true, value: result.value }
    } catch (error) {
      // Caller or contribution cancellation wins over a received HTTP failure.
      // HTTP 401 can itself cancel the admitted generation; that cancellation
      // must not hide the request's authentication failure.
      if (prepared.signal.aborted) return cancelledFailure(endpoint, error)
      if (connectionHttpErrorOf(error) !== undefined) return carrierFailure(endpoint, error)
      if (signal.aborted) return cancelledFailure(endpoint, error)
      const remoteFailure = remoteErrorOf(error)
      if (remoteFailure !== undefined) return { ok: false, error: remoteFailure }
      return carrierFailure(endpoint, error)
    }
  }

  private async *invokeStream(
    descriptor: InvocationDescriptor,
    projection: ScopedProjection | undefined,
    token: MountToken,
    callerCtx: Context,
    values: readonly unknown[],
    boundIdentity?: BoundContextIdentity,
  ): AsyncGenerator {
    const endpoint = endpointOf(descriptor)
    if (!token.active) throw new Error(withdrawn(endpoint).error.message)
    const prepared = this.prepareInvocation(descriptor, projection, token, callerCtx, values, boundIdentity)
    const admission = await this.preparation.admit(prepared.signal, endpoint)
    const signal = admission.signal
    try {
      signal.throwIfAborted()
      const stream = this.openRemoteStream(endpoint, encodeRemotePayload(prepared.args, admission.version), signal)
      for await (const value of stream) {
        if (!mountActive(token)) throw new Error(withdrawn(endpoint).error.message)
        yield value
      }
    } catch (cause) {
      if (signal.aborted && !prepared.signal.aborted) {
        throw new RemoteStreamCarrierError('api gateway: admitted Host generation ended', { cause })
      }
      throw cause
    }
  }

  private prepareInvocation(
    descriptor: InvocationDescriptor,
    projection: ScopedProjection | undefined,
    token: MountToken,
    callerCtx: Context,
    values: readonly unknown[],
    boundIdentity?: BoundContextIdentity,
  ): PreparedClientInvocation {
    const endpoint = endpointOf(descriptor)
    const expected = descriptor.parameters.length - (projection?.parameterIndex === undefined ? 0 : 1)
    const hasCallerSignal = descriptor.cancellation !== undefined && values.length === expected + 1
    if (values.length !== expected && !hasCallerSignal) {
      const contract = descriptor.cancellation === undefined
        ? `${String(expected)} argument(s)`
        : `${String(expected)} business argument(s) plus an optional AbortSignal`
      throw new Error(
        `client api: ${endpoint} expected ${contract}, got ${String(values.length)}`,
      )
    }
    const args = Object.create(null) as Record<string, unknown>
    if (projection !== undefined) {
      const adapter = boundIdentity === undefined
        ? this.ownerCtx.typert.contexts.getClient(projection.context)
        : undefined
      if (boundIdentity === undefined && adapter === undefined) {
        throw new Error(`client api: ${endpoint} has no Client Context adapter for ${JSON.stringify(projection.context)}`)
      }
      const identity = boundIdentity === undefined
        ? adapter?.identity(callerCtx)
        : boundIdentity.value
      if (identity === undefined) {
        throw new Error(`client api: ${endpoint} requires a ${JSON.stringify(projection.context)} Context`)
      }
      args[projection.wire] = parseInput(projection.codec, identity, endpoint, projection.wire)
    }
    let valueIndex = 0
    descriptor.parameters.forEach((parameter, parameterIndex) => {
      if (parameterIndex === projection?.parameterIndex) return
      const value = parseInput(parameter.codec, values[valueIndex], endpoint, parameter.wire)
      if (value !== undefined) args[parameter.wire] = value
      valueIndex += 1
    })
    const callerSignal = hasCallerSignal ? values[expected] as AbortSignal | undefined : undefined
    const signal = callerSignal === undefined
      ? token.abort.signal
      : AbortSignal.any([token.abort.signal, callerSignal])
    return { endpoint, args, signal }
  }
}

type InvokeRemote = (
  direct: DirectMethod | undefined,
  scoped: ScopedMethod | undefined,
  callerCtx: Context,
  args: readonly unknown[],
) => Promise<RemoteResult<unknown>> | AsyncIterable<unknown>

class RemoteNamespaceService extends Service {
  private readonly methods = new Map<string, RemoteMethodRecord>()
  private readonly namespace: string

  static assertMethodAvailable(namespace: string, method: string): void {
    if (REMOTE_NAMESPACE_FIELDS.has(method) || method in RemoteNamespaceService.prototype) {
      throw new Error(`client api: method ${JSON.stringify(`${namespace}/${method}`)} conflicts with its namespace service`)
    }
  }

  constructor(
    ctx: Context,
    name: string,
    private readonly invokeRemote: InvokeRemote,
  ) {
    super(ctx, remoteServiceKey(name))
    this.namespace = name
  }

  assertMethodAvailable(method: string): void {
    RemoteNamespaceService.assertMethodAvailable(this.namespace, method)
    if (method in this && !this.methods.has(method)) {
      throw new Error(`client api: method ${JSON.stringify(`${this.namespace}/${method}`)} conflicts with its namespace service`)
    }
  }

  get empty(): boolean {
    return this.methods.size === 0
  }

  has(kind: 'direct' | 'scoped', method: string): boolean {
    return this.methods.get(method)?.[kind] !== undefined
  }

  installDirect(descriptor: InvocationDescriptor, token: MountToken): void {
    this.install(descriptor.method, 'direct', { descriptor, token })
  }

  installScoped(descriptor: InvocationDescriptor, projection: ScopedProjection, token: MountToken): void {
    this.install(descriptor.method, 'scoped', { descriptor, projection, token })
  }

  private install(method: string, kind: 'direct', value: DirectMethod): void
  private install(method: string, kind: 'scoped', value: ScopedMethod): void
  private install(method: string, kind: 'direct' | 'scoped', value: DirectMethod | ScopedMethod): void {
    this.assertMethodAvailable(method)
    let record = this.methods.get(method)
    const fresh = record === undefined
    record ??= {}
    if (fresh) {
      Object.defineProperty(this, method, {
        configurable: true,
        enumerable: true,
        get: function (this: RemoteNamespaceService): (...args: unknown[]) => unknown {
          const callerCtx = this.ctx
          const current = this.methods.get(method)
          const direct = current?.direct
          const scoped = current?.scoped
          return (...args: unknown[]) => {
            return this.invokeRemote(direct, scoped, callerCtx, args)
          }
        },
      })
      this.methods.set(method, record)
    }
    if (kind === 'direct') record.direct = value
    else record.scoped = value as ScopedMethod
  }

  remove(kind: 'direct' | 'scoped', method: string, token: MountToken): void {
    const record = this.methods.get(method)
    const current = record?.[kind]
    /* v8 ignore next -- duplicate live variants are rejected before installation, so no newer token can replace this one. */
    if (record === undefined || current?.token !== token) return
    if (kind === 'direct') delete record.direct
    else delete record.scoped
    if (record.direct !== undefined || record.scoped !== undefined) return
    this.methods.delete(method)
    Reflect.deleteProperty(this, method)
  }
}

/**
 * Install one descriptor group on a namespace service, unwinding the partial
 * group when a descriptor is refused.
 * @param service - Namespace service taking the methods.
 * @param descriptors - Descriptor group of one contribution.
 * @returns per-descriptor records for the group disposer.
 */
function installMethods(
  service: RemoteNamespaceService,
  descriptors: readonly InvocationDescriptor[],
): InstalledMethod[] {
  const installed: InstalledMethod[] = []
  try {
    for (const descriptor of descriptors) {
      const method: InstalledMethod = {
        descriptor,
        token: { active: true, abort: new AbortController() },
        direct: false,
        scoped: false,
      }
      installed.push(method)
      if (descriptor.invocation.kind === 'direct') {
        service.installDirect(descriptor, method.token)
        method.direct = true
      }
      const projection = scopedProjection(descriptor)
      if (projection !== undefined) {
        service.installScoped(descriptor, projection, method.token)
        method.scoped = true
      }
    }
  } catch (error) {
    for (const method of [...installed].reverse()) {
      method.token.active = false
      method.token.abort.abort()
      if (method.scoped) service.remove('scoped', method.descriptor.method, method.token)
      if (method.direct) service.remove('direct', method.descriptor.method, method.token)
    }
    throw error
  }
  return installed
}

const REMOTE_NAMESPACE_FIELDS = new Set(['ctx', 'empty', 'invokeRemote', 'methods', 'name', 'namespace'])

function remoteServiceKey(namespace: string): string {
  return `remote.${namespace}`
}

function endpointOf(descriptor: Pick<InvocationDescriptor, 'namespace' | 'method'>): string {
  return `${descriptor.namespace}/${descriptor.method}`
}

function mountActive(token: MountToken): boolean {
  return token.active
}

function scopedProjection(descriptor: InvocationDescriptor): ScopedProjection | undefined {
  if (descriptor.invocation.kind === 'context') {
    return {
      context: descriptor.invocation.context,
      wire: descriptor.invocation.wire,
      codec: descriptor.invocation.codec,
    }
  }
  if (descriptor.scope === undefined) return undefined
  const lookupParameters = descriptor.parameters
    .map((parameter, index) => ({ parameter, index }))
    .filter(candidate => candidate.parameter.source === 'lookup')
  const selected = lookupParameters.length === 1 ? lookupParameters[0] : undefined
  if (selected === undefined
    || selected.parameter.wire !== descriptor.scope.wire
    || selected.parameter.lookup !== descriptor.scope.context) {
    throw new Error(
      `client api: generated Remote ${endpointOf(descriptor)} scope must select its only lookup parameter`,
    )
  }
  return {
    context: descriptor.scope.context,
    wire: descriptor.scope.wire,
    codec: selected.parameter.codec,
    parameterIndex: selected.index,
  }
}

function requireStrictDescriptor(descriptor: InvocationDescriptor): void {
  const endpoint = endpointOf(descriptor)
  for (const parameter of descriptor.parameters) {
    requireStrictCodec(parameter.codec, endpoint, parameter.wire)
  }
  if (descriptor.invocation.kind === 'context') {
    requireStrictCodec(descriptor.invocation.codec, endpoint, descriptor.invocation.wire)
  }
}

function requireStrictCodec(codec: TypertCodec, endpoint: string, field: string): void {
  if (codec.mode !== 'strict') {
    throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`)
  }
}

function parseInput(codec: TypertCodec, value: unknown, endpoint: string, field: string): unknown {
  if (codec.mode !== 'strict') {
    throw new Error(`client api: generated Remote ${endpoint} field ${JSON.stringify(field)} has no strict codec`)
  }
  try {
    return codec.schema.parse(value)
  } catch (cause) {
    throw new Error(`client api: ${endpoint} rejected ${JSON.stringify(field)}`, { cause })
  }
}

/** The namespace retired before or during the call, so no request outcome exists. */
function withdrawn(endpoint: string): Extract<RemoteResult<never>, { readonly ok: false }> {
  return internalFailure(`client api: Remote method ${endpoint} is no longer mounted`)
}

/**
 * Normalize an identified HTTP rejection or transport interruption without changing business errors.
 * Unknown carrier exceptions retain `gateway/internal`. Exported so fixture carriers fold identically.
 * @param endpoint - `<namespace>/<method>` that was called.
 * @param error - what the carrier threw.
 * @returns the failed result.
 */
export function carrierFailure(endpoint: string, error: unknown): Extract<RemoteResult<never>, { readonly ok: false }> {
  const http = connectionHttpErrorOf(error)
  if (http !== undefined) {
    const details = { endpoint, httpStatus: http.status }
    const failure = http.status === 401 ? new RemoteError('gateway/authentication-required', http.message, details)
      : http.status === 403 ? new RemoteError('gateway/permission-denied', http.message, details)
        : http.status === 503 ? new RemoteError('gateway/host-not-ready', http.message, details)
          : new RemoteError('gateway/transport-interrupted', http.message, details)
    return { ok: false, error: failure }
  }
  if (typeof error === 'object' && error !== null
    && (error as { isDSHConnectionTransportError?: unknown }).isDSHConnectionTransportError === true) {
    return { ok: false, error: new RemoteError('gateway/transport-interrupted',
      `client api: ${endpoint} transport interrupted`, { endpoint }, { cause: error }) }
  }
  return internalFailure(`client api: ${endpoint} failed: ${error instanceof Error ? error.message : String(error)}`)
}

/** Connection bundles share transport error fields, never prototype identity. */
function connectionHttpErrorOf(value: unknown): ConnectionHttpError | undefined {
  if (typeof value === 'object' && value !== null
    && (value as { isDSHConnectionHttpError?: unknown }).isDSHConnectionHttpError === true
    && typeof (value as { status?: unknown }).status === 'number') return value as ConnectionHttpError
  return undefined
}

/**
 * The error branch a call aborted by its caller folds into: `gateway/cancelled` with the carrier's throw as `cause`.
 * @param endpoint - `<namespace>/<method>` that was called.
 * @param cause - what the carrier threw when the signal aborted.
 * @returns the failed result.
 */
export function cancelledFailure(endpoint: string, cause: unknown): Extract<RemoteResult<never>, { readonly ok: false }> {
  return {
    ok: false,
    error: new RemoteError('gateway/cancelled', `client api: Remote invocation "${endpoint}" was aborted`, {}, { cause }),
  }
}

function internalFailure(message: string): Extract<RemoteResult<never>, { readonly ok: false }> {
  return { ok: false, error: new RemoteError('gateway/internal', message, {}) }
}

/**
 * Whether a caught value is a Remote failure this face delivered or threw.
 * The one consumer-facing discrimination point: marked instances carry a
 * Remote failure code; anything else is a local fault the caller should let crash.
 * @param error - a caught value.
 * @returns true when the value narrows to RemoteFailure.
 */
export function isRemoteFailure(error: unknown): error is RemoteFailure {
  return remoteErrorOf(error) !== undefined
}

/**
 * Rebuild the wire failure as a local RemoteError instance so the error branch
 * carries a real Error and `throw result.error` keeps throw semantics. The code
 * is passed through verbatim without runtime validation: a code outside this
 * Client's merged map still surfaces as-is, so a newer Host stays readable.
 */
function rebuiltFailure(error: { code: string; message: string; details: object }): RemoteFailure {
  return new RemoteError(error.code as never, error.message, error.details as never)
}

type MarkedConnectionStreamFailure = Error & {
  readonly dshRemoteStreamFailure?:
    | { readonly kind: 'remote'; readonly code: string; readonly details: object }
    | { readonly kind: 'carrier' }
}

/** Preserve Gateway error classes across a worker transport's separately bundled page half. */
async function *normalizeConnectionStream(source: AsyncIterable<unknown>): AsyncGenerator {
  try {
    yield * source
  } catch (error) {
    if (!(error instanceof Error)) throw error
    const marker = (error as MarkedConnectionStreamFailure).dshRemoteStreamFailure
    if (marker?.kind === 'remote') {
      throw new RemoteError(marker.code as never, error.message, marker.details as never)
    }
    if (marker?.kind === 'carrier') {
      throw new RemoteStreamCarrierError(error.message, { cause: error })
    }
    throw error
  }
}
