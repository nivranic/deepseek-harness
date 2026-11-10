/**
 * Gateway infrastructure failure codes merged into the shared Remote failure
 * vocabulary. Face-neutral: the Host face and the Client face each import this
 * module so both programs see the same map entries.
 */

import type { RemoteEventId } from './stream-protocol.ts'

/** Wire details every Gateway infrastructure failure carries. */
export interface TypertGatewayFaultDetails {
  /** Canonical `<namespace>/<method>` endpoint. */
  readonly endpoint: string
  /** Affected wire field when the failure is field-specific. */
  readonly field?: string
}

/** HTTP rejection preserved when no Remote response envelope was available. */
export interface TypertGatewayHttpFaultDetails {
  /** Canonical `<namespace>/<method>` endpoint. */
  readonly endpoint: string
  /** Actual response status, independent of the normalized failure code. */
  readonly httpStatus: number
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The admitted Host lacks a capability required by discovery or the requested operation. */
    'host/capability-unavailable': { readonly capability: string }
    /** The HTTP carrier returned 401; authenticate with the Host before explicitly retrying the operation. */
    'gateway/authentication-required': TypertGatewayHttpFaultDetails
    /**
     * The HTTP carrier returned 403, or a device-identified request was
     * refused; the refusal does not establish that a device was revoked.
     */
    'gateway/permission-denied':
      | TypertGatewayHttpFaultDetails
      | { readonly endpoint: string; readonly role: string; readonly reason: 'undeclared' }
      | { readonly endpoint: string; readonly role: string; readonly required: string }
      | { readonly endpoint: string; readonly reason: 'device-identity' }
    /** The HTTP carrier returned 503 for this request; it does not invalidate an otherwise ready generation. */
    'gateway/host-not-ready': TypertGatewayHttpFaultDetails
    /**
     * The request transport was interrupted, a logical stream exhausted carrier retries,
     * or an otherwise unclassified HTTP failure occurred; mutation acceptance may be unknown.
     */
    'gateway/transport-interrupted':
      | { readonly endpoint: string; readonly httpStatus?: number }
      | { readonly stream: string }
    /** Received stream data failed validation; event-generation failure suspends automatic reconnect until explicit recovery. */
    'gateway/stream-invalid': { readonly stream: string }
    /** The Client connection is not ready to admit this operation; reconnect does not automatically resubmit it. */
    'gateway/connection-unavailable': TypertGatewayFaultDetails
    /** This delivery can no longer accept an answer; it does not identify which Client settled the interaction. */
    'interaction-closed': { readonly eventId: RemoteEventId }
    /** The Host deadline elapsed before the pending interaction was settled. */
    'interaction-expired': { readonly eventId: RemoteEventId }
    /** An interaction answer does not match the pending revision; the answer is not accepted. */
    'revision-conflict': {
      readonly eventId: RemoteEventId
      readonly expectedRevision: number
      readonly receivedRevision: number
    }
    'gateway/ambiguous-endpoint': TypertGatewayFaultDetails
    'gateway/arguments-invalid': TypertGatewayFaultDetails
    'gateway/binding-invalid': TypertGatewayFaultDetails
    'gateway/context-failed': TypertGatewayFaultDetails
    'gateway/context-not-found': TypertGatewayFaultDetails
    'gateway/context-unavailable': TypertGatewayFaultDetails
    'gateway/definition-unavailable': TypertGatewayFaultDetails
    'gateway/input-invalid': TypertGatewayFaultDetails
    'gateway/interactions-forbidden': TypertGatewayFaultDetails
    'gateway/invocation-unavailable': TypertGatewayFaultDetails
    'gateway/lookup-failed': TypertGatewayFaultDetails
    'gateway/lookup-not-found': TypertGatewayFaultDetails
    'gateway/lookup-unavailable': TypertGatewayFaultDetails
    'gateway/method-unavailable': TypertGatewayFaultDetails
    'gateway/peer-disposed': TypertGatewayFaultDetails
    'gateway/preparation-unavailable': TypertGatewayFaultDetails
    'gateway/protocol': TypertGatewayFaultDetails
    /** The supplied or negotiated API protocol is unsupported; update the application before reconnecting. */
    'gateway/protocol-unsupported': {
      readonly endpoint: string
      readonly supportedApiProtocolVersions: readonly number[]
    }
    'gateway/provider-mismatch': TypertGatewayFaultDetails
    'gateway/result-invalid': TypertGatewayFaultDetails
    'gateway/service-unavailable': TypertGatewayFaultDetails
    'gateway/signature-invalid': TypertGatewayFaultDetails
    'gateway/uplink-overflow': TypertGatewayFaultDetails
  }
}
