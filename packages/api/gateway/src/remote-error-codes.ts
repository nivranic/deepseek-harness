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
    /** More than one active Remote declaration owns the requested endpoint. */
    'gateway/ambiguous-endpoint': TypertGatewayFaultDetails
    /** Named request arguments do not match the endpoint descriptor. */
    'gateway/arguments-invalid': TypertGatewayFaultDetails
    /** The service has no valid Remote binding for the selected endpoint. */
    'gateway/binding-invalid': TypertGatewayFaultDetails
    /** A Context resolver threw an unclassified failure before business invocation. */
    'gateway/context-failed': TypertGatewayFaultDetails
    /** The Context resolver found no receiver for the requested identity. */
    'gateway/context-not-found': TypertGatewayFaultDetails
    /** The required scoped Context provider is not available. */
    'gateway/context-unavailable': TypertGatewayFaultDetails
    /** The Client connection is not ready to admit this operation; reconnect does not automatically resubmit it. */
    'gateway/connection-unavailable': TypertGatewayFaultDetails
    /** The selected Remote method has no available reflection definition. */
    'gateway/definition-unavailable': TypertGatewayFaultDetails
    /** A supplied wire value fails its codec or interaction delivery metadata requirements. */
    'gateway/input-invalid': TypertGatewayFaultDetails
    /** No active Remote method exports the requested endpoint. */
    'gateway/invocation-unavailable': TypertGatewayFaultDetails
    /** An object lookup provider threw an unclassified failure before business invocation. */
    'gateway/lookup-failed': TypertGatewayFaultDetails
    /** The object lookup provider found no value for the requested identity. */
    'gateway/lookup-not-found': TypertGatewayFaultDetails
    /** A required object lookup provider or provider key is unavailable. */
    'gateway/lookup-unavailable': TypertGatewayFaultDetails
    /** The selected provider has no callable implementation of the requested Remote method. */
    'gateway/method-unavailable': TypertGatewayFaultDetails
    /** A live provider does not match the declared owner, wire field or strict type identity. */
    'gateway/provider-mismatch': TypertGatewayFaultDetails
    /** Required application preparation was withdrawn and has no replacement owner. */
    'gateway/preparation-unavailable': TypertGatewayFaultDetails
    /** The supplied or negotiated API protocol is unsupported; update the application before reconnecting. */
    'gateway/protocol-unsupported': {
      readonly endpoint: string
      readonly supportedApiProtocolVersions: readonly number[]
    }
    /** A stream Remote method returned neither Iterable nor AsyncIterable. */
    'gateway/result-invalid': TypertGatewayFaultDetails
    /** The service required by the Remote endpoint is unavailable. */
    'gateway/service-unavailable': TypertGatewayFaultDetails
    /** The Remote signature or invocation mode is incompatible with the selected dispatch path. */
    'gateway/signature-invalid': TypertGatewayFaultDetails
  }
}
