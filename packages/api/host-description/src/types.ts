/** Host identity, version, and capability facts carried by the shared Remote API. */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Persistent identity of one Harness home; not an authentication credential. */
export type HostId = Branded<'HostId'>

/** Physical carriers provided by the Host composition. */
export type HostTransport = 'http' | 'websocket' | 'desktop-pipe'

/** Authenticated discovery result for the currently running Host. */
export interface HostDescriptor {
  /** Stable across launches sharing the same configured identity file. */
  readonly hostId: HostId
  /** Operator-configured label; never used to resolve Host identity. */
  readonly displayName: string
  /** Installed Harness package release, independent of protocol generations. */
  readonly productVersion: string
  /** Selected response generation; describe uses the protocol-1 discovery representation. */
  readonly apiProtocolVersion: number
  /** Offered request codecs; absent on Hosts without negotiation. */
  readonly supportedApiProtocolVersions?: readonly number[]
  /** Session writer generation; Clients do not parse the corresponding disk format. */
  readonly sessionFormatVersion: number
  /** Host Node.js platform value. */
  readonly platform: string
  /** Host Node.js architecture value. */
  readonly arch: string
  /** This implementation runs the full Harness; Lite is a separate runtime. */
  readonly runtimeMode: 'full'
  /** Explicit versioned operation sets supported by live Remote owners, sorted by id. */
  readonly capabilities: readonly string[]
  /** Carriers configured by the application that hosts this service. */
  readonly transports: readonly HostTransport[]
  /** Host UTC clock at description time, in milliseconds since the Unix epoch. */
  readonly serverTime: number
}
