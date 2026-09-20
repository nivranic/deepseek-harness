import { describe, expect, it, vi } from 'vitest'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { HostDescriptor, HostId } from '@deepseek-ai/dsh-api-host-description/types'
import { LEGACY_DISCOVERY_PROTOCOL_VERSION } from '@deepseek-ai/dsh-api-gateway/protocol'
import { admitHostOperation, createHostPreparation } from '../src/client/host-preparation.ts'

describe('Workspace Files operation capability admission', () => {
  const operations = [
    ['stat', 'workspace-files.stat.v1'], ['list', 'workspace-files.list.v1'],
    ['read', 'workspace-files.read-text.v1'], ['readBytes', 'workspace-files.read-bytes.v1'],
    ['readAll', 'workspace-files.read-all.v1'], ['readRelated', 'workspace-files.read-related.v1'],
    ['changes', 'workspace-files.changes.v1'],
  ] as const
  it.each(operations)('requires independent support for workspaceFiles/%s', (method, capability) => {
    const invoke = (capabilities: string[]) => { admitHostOperation(`workspaceFiles/${method}`, { apiProtocolVersion: 2, capabilities }) }
    expect(() => { invoke(['workspace.follow.v1']) }).toThrow(expect.objectContaining({ code: 'host/capability-unavailable' }))
    expect(() => { invoke([capability]) }).not.toThrow()
    expect(() => { invoke(operations.map(([, id]) => id).filter(id => id !== capability)) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
  })
})

describe('Settings operation capability admission', () => {
  it.each([
    ['describe', 'settings.read.v1'], ['update', 'settings.write.v1'],
    ['replace', 'settings.write.v1'], ['mutate', 'settings.write.v1'],
    ['openSettingsDocument', 'settings.document-open.v1'],
    ['canOpenAgentPresetDirectory', 'settings.agent-preset-directory.v1'],
    ['openAgentPresetDirectory', 'settings.agent-preset-directory.v1'],
  ])('requires the Settings-owned capability for %s', (method, capability) => {
    const invoke = (capabilities: string[]) => { admitHostOperation(`settings/${method}`, { apiProtocolVersion: 2, capabilities }) }
    expect(() => { invoke([]) }).toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
    expect(() => { invoke([capability]) }).not.toThrow()
    expect(() => { invoke(['agent-preset.catalog.v1', 'agent-preset.manage.v1']) }).toThrow(expect.objectContaining({ code: 'host/capability-unavailable' }))
  })
})

describe('Workspace operation capability admission', () => {
  it.each([
    ['follow', 'workspace.follow.v1'],
    ['create', 'workspace.manage.v1'], ['rename', 'workspace.manage.v1'],
    ['delete', 'workspace.manage.v1'], ['insertBefore', 'workspace.manage.v1'],
    ['archiveSession', 'workspace.sessions.v1'], ['insertSessionBefore', 'workspace.sessions.v1'],
  ])('requires independent owner support for workspace/%s', (method, capability) => {
    const invoke = (capabilities: string[]) => { admitHostOperation(`workspace/${method}`, { apiProtocolVersion: 2, capabilities }) }
    expect(() => { invoke(['session.manage.v1']) }).toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
    expect(() => { invoke([capability]) }).not.toThrow()
    expect(() => { invoke(['workspace.follow.v1', 'workspace.manage.v1', 'workspace.sessions.v1'].filter(id => id !== capability)) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable' }))
  })
})

describe('Directory Picker operation capability admission', () => {
  it.each([
    ['pick', 'directory-picker.native.v1'],
    ['list', 'directory-picker.browse.v1'],
    ['createDirectory', 'directory-picker.create.v1'],
  ])('requires independent support for directoryPicker/%s', (method, capability) => {
    const invoke = (capabilities: string[]) => { admitHostOperation(`directoryPicker/${method}`, { apiProtocolVersion: 2, capabilities }) }
    expect(() => { invoke(['workspace.manage.v1']) }).toThrow(expect.objectContaining({ code: 'host/capability-unavailable' }))
    expect(() => { invoke([capability]) }).not.toThrow()
    expect(() => { invoke(['directory-picker.native.v1', 'directory-picker.browse.v1', 'directory-picker.create.v1'].filter(id => id !== capability)) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
  })
})

describe('Agent Preset operation capability admission', () => {
  it.each([
    ['list', 'agent-preset.catalog.v1'], ['read', 'agent-preset.catalog.v1'],
    ['select', 'agent-preset.select.v1'], ['copy', 'agent-preset.manage.v1'],
    ['deletePreset', 'agent-preset.manage.v1'],
  ])('requires the specific operation set for agentPresets/%s', (method, capability) => {
    expect(() =>{  admitHostOperation(`agentPresets/${method}`, { apiProtocolVersion: 2, capabilities: [] }) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
    expect(() =>{  admitHostOperation(`agentPresets/${method}`, { apiProtocolVersion: 2, capabilities: [capability] }) })
      .not.toThrow()
    expect(() =>{  admitHostOperation(`agentPresets/${method}`, { apiProtocolVersion: 2, capabilities: ['session.manage.v1'] }) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable' }))
  })
})

describe('Session operation capability admission', () => {
  it.each([
    ['follow', 'session.follow.v1'], ['page', 'session.follow.v1'],
    ['control', 'session.control.v1'], ['prompt', 'session.control.v1'],
    ['updateQueue', 'session.control.v1'], ['cancel', 'session.control.v1'],
    ['cancelTurn', 'session.cancel-turn.v1'],
    ['renameAt', 'session.rename-at.v1'],
    ['list', 'session.list.v1'], ['create', 'session.manage.v1'],
    ['rename', 'session.manage.v1'], ['fork', 'session.manage.v1'],
    ['search', 'session.search.v1'], ['attachment', 'session.attachment.v1'],
    ['modelCatalog', 'model.catalog.v1'], ['selectModel', 'model.select.v1'],
  ])('requires the advertised capability for session/%s', (method, capability) => {
    expect(() =>{  admitHostOperation(`session/${method}`, { apiProtocolVersion: 2, capabilities: [] }) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
    expect(() =>{  admitHostOperation(`session/${method}`, { apiProtocolVersion: 2, capabilities: [capability] }) })
      .not.toThrow()
  })

  it('does not infer policy for undeclared namespaces', () => {
    expect(() =>{  admitHostOperation('workspace/list', { apiProtocolVersion: 2, capabilities: [] }) }).not.toThrow()
  })
})

const descriptor: HostDescriptor = {
  hostId: '4bf2b376-39e8-4a02-8d94-daf34f8ed6fb' as HostId,
  displayName: 'Fixture Host', productVersion: '0.1.5-rc.2', apiProtocolVersion: LEGACY_DISCOVERY_PROTOCOL_VERSION,
  sessionFormatVersion: 3, platform: 'win32', arch: 'x64', runtimeMode: 'full',
  capabilities: ['host.describe.v1', 'session.follow.v1'], transports: ['desktop-pipe'], serverTime: 1,
}

function contribution(parse: (value: unknown) => unknown): TypertRemoteContribution {
  return {
    package: '@deepseek-ai/dsh-api-host-description',
    descriptors: [{
      id: '@deepseek-ai/dsh-api-host-description#host/describe', service: 'hostDescription',
      namespace: 'host', method: 'describe', invocation: { kind: 'direct' }, parameters: [],
      result: { mode: 'strict', typeSymbol: '@deepseek-ai/dsh-api-host-description/types#HostDescriptor', schema: { parse } },
    }],
  }
}

describe('Host discovery admission', () => {
  it('reports authentication around the Host check and honors cancellation from progress', async () => {
    const phases: string[] = []
    const call = vi.fn(async () => {
      expect(phases).toEqual(['authenticating'])
      return { ok: true as const, value: descriptor }
    })
    const prepare = createHostPreparation(contribution(() => descriptor))
    await prepare({ call }, new AbortController().signal, phase => phases.push(phase))
    expect(phases).toEqual(['authenticating', 'connecting'])
    const abort = new AbortController()
    const cancelledCall = vi.fn()
    await expect(prepare({ call: cancelledCall }, abort.signal, () => { abort.abort(new Error('stopped')) })).rejects.toThrow('stopped')
    expect(cancelledCall).not.toHaveBeenCalled()
  })

  it('uses the existing carrier and generated codec and returns generation facts', async () => {
    const parse = vi.fn(() => descriptor)
    const call = vi.fn(async () => ({ ok: true as const, value: descriptor }))
    const signal = new AbortController().signal
    const prepare = createHostPreparation(contribution(parse))
    await expect(prepare({ call }, signal)).resolves.toEqual({ descriptor, capabilities: descriptor.capabilities,
      apiProtocolVersion: 1, interactionReplyScope: `host:${descriptor.hostId}` })
    expect(call).toHaveBeenCalledExactlyOnceWith('/api', 'host/describe', { args: {} }, signal)
    expect(parse).toHaveBeenCalledExactlyOnceWith(descriptor)
  })

  it('does not use product or disk versions as API compatibility substitutes', async () => {
    const facts = { ...descriptor, productVersion: '80.0.0', sessionFormatVersion: 900 }
    const prepare = createHostPreparation(contribution(() => facts))
    await expect(prepare({ call: async () => ({ ok: true, value: facts }) }, new AbortController().signal))
      .resolves.toEqual({ descriptor: facts, capabilities: facts.capabilities, apiProtocolVersion: 1,
        interactionReplyScope: `host:${facts.hostId}` })
  })

  it('rejects unknown API generations before attempting their result codec', async () => {
    const parse = vi.fn(() => descriptor)
    const prepare = createHostPreparation(contribution(parse))
    await expect(prepare({ call: async () => ({ ok: true, value: { apiProtocolVersion: 2 } }) }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'host/protocol-unsupported', details: { clientProtocolVersion: 2, hostProtocolVersion: 2 } })
    expect(parse).not.toHaveBeenCalled()
  })

  it.each([
    null, {}, { apiProtocolVersion: '1' }, { apiProtocolVersion: 1.5 }, { apiProtocolVersion: 0 },
  ])('rejects a malformed protocol discriminator %j', async (value) => {
    const parse = vi.fn(() => descriptor)
    const prepare = createHostPreparation(contribution(parse))
    await expect(prepare({ call: async () => ({ ok: true, value }) }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'host/description-invalid' })
    expect(parse).not.toHaveBeenCalled()
  })

  it('retains discovery failure codes instead of admitting a partial Host', async () => {
    const prepare = createHostPreparation(contribution(() => descriptor))
    const error = { code: 'gateway/service-unavailable', message: 'discovery removed', details: { endpoint: 'host/describe' } }
    await expect(prepare({ call: async () => ({ ok: false, error }) }, new AbortController().signal))
      .rejects.toMatchObject(error)
  })

  it('rejects a current-generation response rejected by its generated codec', async () => {
    const prepare = createHostPreparation(contribution(() => { throw new Error('missing Host field') }))
    await expect(prepare({ call: async () => ({ ok: true, value: { apiProtocolVersion: 1 } }) }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'host/description-invalid' })
  })

  it('requires the explicit discovery capability', async () => {
    const prepare = createHostPreparation(contribution(() => ({ ...descriptor, capabilities: [] })))
    await expect(prepare({ call: async () => ({ ok: true, value: descriptor }) }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'host/capability-unavailable', details: { capability: 'host.describe.v1' } })
  })

  it('refuses a late response after attempt cancellation', async () => {
    const controller = new AbortController()
    const parse = vi.fn(() => descriptor)
    const prepare = createHostPreparation(contribution(parse))
    const cause = new Error('generation replaced')
    const call = async () => { controller.abort(cause); return { ok: true as const, value: descriptor } }
    await expect(prepare({ call }, controller.signal)).rejects.toBe(cause)
    expect(parse).not.toHaveBeenCalled()
  })

  it('fails assembly when the generated discovery method is missing', () => {
    expect(() => createHostPreparation({ package: '@fixture/missing', descriptors: [] }))
      .toThrow('requires its generated result codec')
  })
})


it.each([
  ['presentedFiles/desktop', 'presented-file.desktop.v1'],
  ['presentedFiles/open', 'presented-file.open.v1'],
  ['presentedFiles/reveal', 'presented-file.reveal.v1'],
  ['fileReferences/list', 'file-reference.list.v1'],
  ['skills/list', 'skill.catalog.v1'],
  ['sessionReferenceResolver/candidates', 'session-reference.candidates.v1'],
  ['credentials/describe', 'credentials.describe.v1'],
  ['credentials/set', 'credentials.write.v1'],
  ['credentials/unset', 'credentials.write.v1'],
  ['llm/listProviders', 'llm.providers.v1'],
  ['llm/listConfigurableProviders', 'llm.providers.v1'],
  ['llm/discoverModels', 'llm.discover-models.v1'],
])('requires the owner capability before %s dispatch', (endpoint, capability) => {
  expect(() => { admitHostOperation(endpoint, { apiProtocolVersion: 2, capabilities: ['settings.write.v1'] }) })
    .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
  expect(() => { admitHostOperation(endpoint, { apiProtocolVersion: 2, capabilities: [capability] }) }).not.toThrow()
})

describe('Host protocol negotiation', () => {
  const discovery = { ...descriptor, supportedApiProtocolVersions: [2, 1], capabilities: ['host.describe.v1', 'host.negotiate.v1'] }
  const selected = { ...discovery, apiProtocolVersion: 2 }

  it('selects protocol 2 before admitting the generation', async () => {
    const call = vi.fn().mockResolvedValueOnce({ ok: true, value: discovery }).mockResolvedValueOnce({ ok: true, value: selected })
    const prepare = createHostPreparation(contribution(value => value))
    const signal = new AbortController().signal
    await expect(prepare({ call }, signal)).resolves.toEqual({
      descriptor: selected, capabilities: selected.capabilities, apiProtocolVersion: 2,
      interactionReplyScope: `host:${selected.hostId}`,
    })
    expect(call).toHaveBeenNthCalledWith(2, '/api', 'host/negotiate', { args: { supportedApiProtocolVersions: [2, 1] } }, signal)
  })

  it.each([
    { ...discovery, supportedApiProtocolVersions: [] },
    { ...discovery, supportedApiProtocolVersions: [1, 1] },
    { ...discovery, supportedApiProtocolVersions: [1.5] },
    { ...discovery, supportedApiProtocolVersions: undefined },
    { ...discovery, capabilities: ['host.describe.v1'] },
  ])('rejects contradictory negotiation metadata before sending offers', async (value) => {
    const call = vi.fn(async () => ({ ok: true as const, value }))
    await expect(createHostPreparation(contribution(value => value))({ call }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'host/description-invalid' })
    expect(call).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...selected, hostId: 'another-host' },
    { ...selected, apiProtocolVersion: 1 },
    { ...selected, apiProtocolVersion: 99 },
    { ...selected, supportedApiProtocolVersions: [2] },
    { ...selected, capabilities: [] },
  ])('rejects changed identity or unsupported negotiation results', async (value) => {
    const call = vi.fn().mockResolvedValueOnce({ ok: true, value: discovery }).mockResolvedValueOnce({ ok: true, value })
    await expect(createHostPreparation(contribution(value => value))({ call }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'host/description-invalid' })
    expect(call).toHaveBeenCalledTimes(2)
  })

  it('preserves negotiation failure without silently downgrading', async () => {
    const error = { code: 'gateway/protocol-unsupported', message: 'no shared protocol', details: { endpoint: 'host/negotiate', supportedApiProtocolVersions: [99] } }
    const call = vi.fn().mockResolvedValueOnce({ ok: true, value: discovery }).mockResolvedValueOnce({ ok: false, error })
    await expect(createHostPreparation(contribution(value => value))({ call }, new AbortController().signal)).rejects.toMatchObject(error)
    expect(call).toHaveBeenCalledTimes(2)
  })
})

describe('Command operation capability admission', () => {
  it.each([
    ['list', 'command.catalog.v1', 'command.execute.v1'],
    ['execute', 'command.execute.v1', 'command.catalog.v1'],
  ])('requires independent support for commands/%s', (method, capability, other) => {
    for (const capabilities of [undefined, [], [other], ['session.control.v1']]) {
      expect(() => { admitHostOperation('commands/' + method, { apiProtocolVersion: 2, ...(capabilities === undefined ? {} : { capabilities }) }) })
        .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
    }
    expect(() => { admitHostOperation('commands/' + method, { apiProtocolVersion: 2, capabilities: [capability] }) }).not.toThrow()
  })
})

describe('Goal operation capability admission', () => {
  const operations = [
    ['get', 'goal.read.v1'], ['create', 'goal.create.v1'], ['edit', 'goal.edit.v1'],
    ['pause', 'goal.pause.v1'], ['resume', 'goal.resume.v1'], ['complete', 'goal.complete.v1'], ['clear', 'goal.clear.v1'],
  ] as const
  it.each(operations)('requires independent support for goals/%s', (method, capability) => {
    const invoke = (capabilities: readonly string[]) => { admitHostOperation('goals/' + method, { apiProtocolVersion: 2, capabilities }) }
    expect(() => { invoke([]) }).toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
    expect(() => { invoke(operations.map(([, id]) => id).filter(id => id !== capability)) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
    expect(() => { invoke([capability]) }).not.toThrow()
  })
})

it.each([
  ['list', 'subagent.catalog.v1'], ['prompt', 'subagent.prompt.v1'], ['interruptByParent', 'subagent.interrupt.v1'],
  ['interruptTurnByParent', 'subagent.interrupt-turn.v1'],
])('requires the independent capability for subagents/%s', (method, capability) => {
  const invoke = (capabilities: readonly string[]) => { admitHostOperation('subagents/' + method, { apiProtocolVersion: 2, capabilities }) }
  expect(() => { invoke(['session.control.v1', 'session.follow.v1']) }).toThrow(expect.objectContaining({
    code: 'host/capability-unavailable', details: { capability },
  }))
  expect(() => { invoke(['subagent.catalog.v1', 'subagent.prompt.v1', 'subagent.interrupt.v1', 'subagent.interrupt-turn.v1'].filter(id => id !== capability)) })
    .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
  expect(() => { invoke([capability]) }).not.toThrow()
})

it.each([
  ['messageFeedback/list', 'feedback.message.read.v1'],
  ['messageFeedback/put', 'feedback.message.put.v1'],
  ['messageFeedback/delete', 'feedback.message.delete.v1'],
  ['sessionFeedback/record', 'feedback.session.record.v1'],
])('requires independent support for %s', (endpoint, capability) => {
  const invoke = (capabilities: readonly string[]) => { admitHostOperation(endpoint, { apiProtocolVersion: 2, capabilities }) }
  expect(() => { invoke(['feedback.message.read.v1', 'feedback.message.put.v1', 'feedback.message.delete.v1', 'feedback.session.record.v1'].filter(id => id !== capability)) })
    .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
  expect(() => { invoke([capability]) }).not.toThrow()
})

it('requires file staging support independently of Session and attachment operations', () => {
  for (const capabilities of [undefined, [], ['session.control.v1', 'session.attachment.v1']]) {
    expect(() => { admitHostOperation('fileUploads/upload', { apiProtocolVersion: 2, ...(capabilities === undefined ? {} : { capabilities }) }) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability: 'file-upload.stage.v1' } }))
  }
  expect(() => { admitHostOperation('fileUploads/upload', { apiProtocolVersion: 2, capabilities: ['file-upload.stage.v1'] }) }).not.toThrow()
})

it('requires plugin inventory support without granting Loader mutation capabilities', () => {
  for (const capabilities of [undefined, [], ['agent-preset.read.v1', 'settings.read.v1']]) {
    expect(() => { admitHostOperation('pluginInventory/list', { apiProtocolVersion: 2, ...(capabilities === undefined ? {} : { capabilities }) }) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability: 'plugin.inventory.v1' } }))
  }
  expect(() => { admitHostOperation('pluginInventory/list', { apiProtocolVersion: 2, capabilities: ['plugin.inventory.v1'] }) }).not.toThrow()
})


it.each([
  ['inventory', 'dynamic-cordis.inventory.v1'],
  ['runHostHalf', 'dynamic-cordis.run.v1'],
  ['getClientCode', 'dynamic-cordis.client-code.v1'],
  ['resolveRequestRun', 'dynamic-cordis.resolve-run.v1'],
  ['settleUserRun', 'dynamic-cordis.settle-run.v1'],
  ['stopFromPanel', 'dynamic-cordis.stop.v1'],
  ['undefineFromPanel', 'dynamic-cordis.undefine.v1'],
  ['syncInspectManifest', 'dynamic-cordis.inspect-manifest.v1'],
  ['resolveInspectQuery', 'dynamic-cordis.inspect-resolve.v1'],
  ['reportRenderFailure', 'dynamic-cordis.report-render.v1'],
  ['reportClientGuardFailure', 'dynamic-cordis.report-guard.v1'],
  ['invoke', 'dynamic-cordis.invoke.v1'],
])('requires independent Dynamic Cordis support for %s', (method, capability) => {
  const endpoint = 'dynamicCordisRunner/' + method
  for (const capabilities of [undefined, [], ['plugin.inventory.v1', 'session.control.v1']]) {
    expect(() => { admitHostOperation(endpoint, { apiProtocolVersion: 2, ...(capabilities === undefined ? {} : { capabilities }) }) })
      .toThrow(expect.objectContaining({ code: 'host/capability-unavailable', details: { capability } }))
  }
  expect(() => { admitHostOperation(endpoint, { apiProtocolVersion: 2, capabilities: [capability] }) }).not.toThrow()
})
