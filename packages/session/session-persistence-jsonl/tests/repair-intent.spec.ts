import { stat } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createSessionFormatCatalogWithChildren } from '@deepseek-ai/dsh-session-format-catalog'
import { parseRepairIntent, repairIntentRevision, restoreWithRepairIntent } from '../src/repair-intent.ts'

vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, stat: vi.fn(fs.stat) }
})

afterEach(() => { vi.mocked(stat).mockReset() })

const id = SessionId('repair-record')
const first = { type: 'turn/start', seq: 0, time: 2, data: { turn: 1 } }
const last = { type: 'turn/end', seq: 1, time: 3, data: { turn: 1, reason: { kind: 'completed' } } }
const header = { type: 'session', version: 3, id, createdAt: 1, isSeeded: false, delegationDepth: 0 }
const catalog = createSessionFormatCatalogWithChildren([])
const document = (events: unknown[]) => Buffer.from(JSON.stringify({ version: 1, id, truncateTo: 0, events }))

describe('recovery document admission', () => {
  it.each([
    [null], [[]], [{ seq: '0' }], [{ seq: -1 }], [{ seq: 0.5 }], [{ seq: Number.MAX_SAFE_INTEGER + 1 }],
    [{ seq: 0 }, { seq: 2 }],
  ])('refuses malformed or non-contiguous stored sequence numbers: %j', (...events) => {
    expect(() => parseRepairIntent(document(events), id)).toThrow('invalid repair intent')
  })

  it('propagates recovery-file observation failures rather than reporting absence', async () => {
    const failure = Object.assign(new Error('recovery metadata denied'), { code: 'EACCES' })
    vi.mocked(stat).mockRejectedValueOnce(failure)
    await expect(repairIntentRevision('session.v4.jsonl.zstd')).rejects.toBe(failure)
  })
})

describe('source-format recovery before migration', () => {
  it('validates identical source overlap and appends only the missing records', () => {
    const restore = catalog.createRestore(header, { recovery: 'recoverable', validation: 'current' })
    const recovered = restoreWithRepairIntent(restore, header, 3, document([first, last]))
    recovered.decodeRow(first)
    expect(recovered.finish().events).toEqual([first, last])
  })

  it.each([
    ['conflicting overlap', [{ ...first, time: 10 }]],
    ['sequence gap', [{ ...last, seq: 2 }]],
  ] as const)('refuses %s in historical recovery state', (_label, events) => {
    const restore = catalog.createRestore(header, { recovery: 'recoverable', validation: 'current' })
    const recovered = restoreWithRepairIntent(restore, header, 3, document([...events]))
    recovered.decodeRow(first)
    expect(() => recovered.finish()).toThrow(/repair intent/)
  })

  it('refuses recovery documents for source generations that never defined them', () => {
    const source = { type: 'session', version: 0, id, createdAt: 1, delegationDepth: 0 }
    const restore = catalog.createRestore(source, { recovery: 'recoverable', validation: 'current' })
    expect(() => restoreWithRepairIntent(restore, source, 0, document([first])))
      .toThrow('repair intents are unsupported for Session v0')
  })
})
