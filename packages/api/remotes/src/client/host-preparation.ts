/** Host discovery and protocol admission for the application's selected Remote APIs. */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { AGENT_PRESET_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-agent-presets/capabilities'
import { MESSAGE_FEEDBACK_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-message-feedback/capabilities'
import { SESSION_FEEDBACK_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-command-feedback/capabilities'
import { DYNAMIC_CORDIS_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-cordis-host-runner/capabilities'
import { PLUGIN_INVENTORY_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-host-plugin-inventory/capabilities'
import { DEVICE_TRUST_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-api-device-trust/capabilities'
import { FILE_UPLOAD_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-client-file-upload/capabilities'
import { SUBAGENT_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-subagent/capabilities'
import { GOAL_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-goal/capabilities'
import { COMMAND_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-commands/capabilities'
import { SETTINGS_REMOTE_CAPABILITIES, CREDENTIAL_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-api-settings-controller/capabilities'
import { LLM_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-llm/capabilities'
import { WORKSPACE_REMOTE_CAPABILITIES, DIRECTORY_PICKER_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-api-workspace-controller/capabilities'
import { WORKSPACE_FILES_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-api-workspace-files/capabilities'
import { PRESENTED_FILE_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-client-ui-deliverables/capabilities'
import { SESSION_REFERENCE_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-session-reference/capabilities'
import { SESSION_REMOTE_CAPABILITIES, FILE_REFERENCE_REMOTE_CAPABILITIES, SKILL_CATALOG_REMOTE_CAPABILITIES } from '@deepseek-ai/dsh-api-session-controller/capabilities'
import type { RemotePreparation, RemoteAdmission, RemoteInteractionReplyScope } from '@deepseek-ai/dsh-api-gateway/client'
import { API_PROTOCOL_VERSION, LEGACY_DISCOVERY_PROTOCOL_VERSION, SUPPORTED_REMOTE_PROTOCOL_VERSIONS } from '@deepseek-ai/dsh-api-gateway/protocol'
import type { HostDescriptor } from '@deepseek-ai/dsh-api-host-description/types'

declare module '@deepseek-ai/dsh-client-connection/client' {
  interface ConnectionHostInfo {
    /** Validated discovery for this generation; absent in assemblies without Host discovery. */
    readonly descriptor?: HostDescriptor
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The Host discovery protocol is unsupported by this Client. */
    'host/protocol-unsupported': { readonly clientProtocolVersion: number; readonly hostProtocolVersion: number }
    /** Host discovery or negotiation data is invalid or inconsistent, so admission is suspended. */
    'host/description-invalid': Record<string, never>
  }
}

/**
 * Build mandatory discovery from the Host owner's generated result codec.
 * @param contribution - generated Host description Remote contribution.
 * @returns one cancellable discovery exchange for each Connection attempt.
 */
export function createHostPreparation(contribution: TypertRemoteContribution): RemotePreparation {
  const description = contribution.descriptors.find(item => item.namespace === 'host' && item.method === 'describe')
  const codec = description?.result
  if (codec?.mode !== 'strict') throw new Error('Host discovery requires its generated result codec')
  return async (rpc, signal, progress) => {
    progress?.('authenticating')
    signal.throwIfAborted()
    const result = await rpc.call('/api', 'host/describe', { args: {} }, signal)
    signal.throwIfAborted()
    progress?.('connecting')
    signal.throwIfAborted()
    if (!result.ok) {
      throw new RemoteError(result.error.code as never, result.error.message, result.error.details as never)
    }
    const value = result.value
    const version = typeof value === 'object' && value !== null && 'apiProtocolVersion' in value
      ? value.apiProtocolVersion : undefined
    if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) {
      throw new RemoteError('host/description-invalid', 'Host discovery has no valid API protocol version', {})
    }
    if (version !== LEGACY_DISCOVERY_PROTOCOL_VERSION) {
      throw new RemoteError('host/protocol-unsupported', 'Host and Client API versions are incompatible; update the application', {
        clientProtocolVersion: API_PROTOCOL_VERSION, hostProtocolVersion: version,
      })
    }
    let descriptor: HostDescriptor
    try {
      descriptor = codec.schema.parse(value) as HostDescriptor
    } catch (cause) {
      throw new RemoteError('host/description-invalid', 'Host discovery does not match the supported API', {}, { cause })
    }
    if (!descriptor.capabilities.includes('host.describe.v1')) {
      throw new RemoteError('host/capability-unavailable', 'Host discovery capability is unavailable', { capability: 'host.describe.v1' })
    }
    const offers = descriptor.supportedApiProtocolVersions
    const negotiates = descriptor.capabilities.includes('host.negotiate.v1')
    const interactionReplyScope = `host:${descriptor.hostId}` as RemoteInteractionReplyScope
    if (offers === undefined && !negotiates) {
      return { descriptor, capabilities: descriptor.capabilities, apiProtocolVersion: 1, interactionReplyScope }
    }
    if (!negotiates || offers === undefined || offers.length === 0
      || offers.some(item => !Number.isSafeInteger(item) || item < 1)
      || new Set(offers).size !== offers.length) {
      throw new RemoteError('host/description-invalid', 'Host negotiation metadata is invalid', {})
    }
    const selected = SUPPORTED_REMOTE_PROTOCOL_VERSIONS.find(item => offers.includes(item))
    if (selected === undefined) throw new RemoteError('gateway/protocol-unsupported', 'Host and Client have no shared API protocol; update the application', {
      endpoint: 'host/negotiate', supportedApiProtocolVersions: [...SUPPORTED_REMOTE_PROTOCOL_VERSIONS],
    })
    const negotiated = await rpc.call('/api', 'host/negotiate', {
      args: { supportedApiProtocolVersions: [...SUPPORTED_REMOTE_PROTOCOL_VERSIONS] },
    }, signal)
    signal.throwIfAborted()
    if (!negotiated.ok) throw new RemoteError(negotiated.error.code as never, negotiated.error.message, negotiated.error.details as never)
    let resolved: HostDescriptor
    try {
      resolved = codec.schema.parse(negotiated.value) as HostDescriptor
    } catch (cause) {
      throw new RemoteError('host/description-invalid', 'Host negotiation result is invalid', {}, { cause })
    }
    if (resolved.hostId !== descriptor.hostId || resolved.apiProtocolVersion !== selected
      || !resolved.capabilities.includes('host.negotiate.v1') || !resolved.capabilities.includes('host.describe.v1')
      || resolved.supportedApiProtocolVersions?.length !== offers.length
      || !offers.every(item => resolved.supportedApiProtocolVersions?.includes(item))) {
      throw new RemoteError('host/description-invalid', 'Host identity or protocol changed during negotiation', {})
    }
    return { descriptor: resolved, capabilities: resolved.capabilities, apiProtocolVersion: selected, interactionReplyScope }
  }
}


/**
 * Reject declared operations unless this generation advertises their required capability.
 * @param endpoint - canonical Remote namespace/method.
 * @param facts - admitted application facts for this request's generation.
 */
export const admitHostOperation: RemoteAdmission = (endpoint, facts) => {
  for (const [namespace, capabilities] of [
    ['session', SESSION_REMOTE_CAPABILITIES],
    ['presentedFiles', PRESENTED_FILE_REMOTE_CAPABILITIES],
    ['fileReferences', FILE_REFERENCE_REMOTE_CAPABILITIES],
    ['skills', SKILL_CATALOG_REMOTE_CAPABILITIES],
    ['sessionReferenceResolver', SESSION_REFERENCE_REMOTE_CAPABILITIES],
    ['agentPresets', AGENT_PRESET_REMOTE_CAPABILITIES],
    ['commands', COMMAND_REMOTE_CAPABILITIES],
    ['goals', GOAL_REMOTE_CAPABILITIES],
    ['messageFeedback', MESSAGE_FEEDBACK_REMOTE_CAPABILITIES],
    ['sessionFeedback', SESSION_FEEDBACK_REMOTE_CAPABILITIES],
    ['dynamicCordisRunner', DYNAMIC_CORDIS_REMOTE_CAPABILITIES],
    ['pluginInventory', PLUGIN_INVENTORY_REMOTE_CAPABILITIES],
    ['deviceTrust', DEVICE_TRUST_REMOTE_CAPABILITIES],
    ['fileUploads', FILE_UPLOAD_REMOTE_CAPABILITIES],
    ['subagents', SUBAGENT_REMOTE_CAPABILITIES],
    ['settings', SETTINGS_REMOTE_CAPABILITIES],
    ['credentials', CREDENTIAL_REMOTE_CAPABILITIES],
    ['llm', LLM_REMOTE_CAPABILITIES],
    ['workspace', WORKSPACE_REMOTE_CAPABILITIES],
    ['directoryPicker', DIRECTORY_PICKER_REMOTE_CAPABILITIES],
    ['workspaceFiles', WORKSPACE_FILES_REMOTE_CAPABILITIES],
  ] as const) {
    for (const capability of capabilities) {
      if (capability.methods.some(method => endpoint === `${namespace}/${method}`)
        && facts.capabilities?.includes(capability.id) !== true) {
        throw new RemoteError('host/capability-unavailable', 'Host does not advertise the required operation capability', { capability: capability.id })
      }
    }
  }
}
