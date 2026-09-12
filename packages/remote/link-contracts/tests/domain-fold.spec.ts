/** Companion and Lite projection behavior for incomplete and interrupted wire records. */
import { describe, expect, it } from 'vitest'
import { foldCompanionDomain, type CompanionRecord } from '../src/companion-fold.ts'
import { emptyLiteDomain, foldLiteDomain, type LiteEvent } from '../src/lite-spec.ts'

function record(type: string, data: unknown, seq = 1): CompanionRecord {
  return { type: 'event', event: { type, data, seq } }
}

describe('companion wire projections', () => {
  it.each([
    ['aborted', '已中止'], ['blocked', '被阻断'], ['error', '出错'],
    ['max-tokens', '达到输出上限'], ['interrupted', '因中断收尾'], ['future-reason', ''],
  ])('renders the %s turn outcome', (kind, label) => {
    const state = foldCompanionDomain([record('turn/end', { turn: 2, reason: { kind } })])
    expect(state.items[0]!.text).toBe(label === '' ? '' : `第 2 轮${label}`)
  })

  it.each([null, { id: 42, status: 'ready' }])('keeps malformed artifact statuses as marker rows: %j', (data) => {
    const state = foldCompanionDomain([record('artifact/status', data)])
    expect(state.artifacts).toEqual([])
    expect(state.items).toEqual([{ seq: 1, kind: 'artifact/status', text: '' }])
  })

  it('renders pending artifact status without inventing a missing reference', () => {
    const state = foldCompanionDomain([record('artifact/status', { id: 'missing', status: 'pending' })])
    expect(state.items[0]!.text).toBe('工件 missing：待定')
    expect(state.artifacts).toEqual([])
  })

  it('deduplicates nested image references and supplies missing display metadata', () => {
    const state = foldCompanionDomain([
      record('user/message', { content: [
        { type: 'image', attachment: { attachmentId: 'image-1' } },
        { type: 'image', attachment: { attachmentId: 'image-1', name: 'duplicate' } },
        { type: 'tool-result', content: [
          { type: 'image', attachment: { attachmentId: 'image-2', mediaType: 'image/png', width: 2, height: 3, name: 'second' } },
          { type: 'future-block' },
        ] },
      ] }),
    ])
    expect(state.images).toEqual([
      { attachmentId: 'image-1', mediaType: '', width: 0, height: 0 },
      { attachmentId: 'image-2', mediaType: 'image/png', width: 2, height: 3, name: 'second' },
    ])
    expect(state.items[0]!.text).toBe('图片（，0×0）\n图片 duplicate（，0×0）\n图片 second（image/png，2×3）')
  })

  it.each([
    [{ type: 'text', text: 'prefix' }, 'prefix'],
    [{ type: 'usage' }, ''],
    [{ type: 'future', text: 7 }, ''],
  ])('renders only textual assistant chunks: %j', (chunk, expected) => {
    expect(foldCompanionDomain([record('assistant/chunk', { chunk })]).items[0]!.text).toBe(expected)
  })

  it('marks delivered interrupted text and retains empty assistant and tool chunk rows', () => {
    const state = foldCompanionDomain([
      record('assistant/message', { interrupted: true, message: { content: [{ type: 'text', text: 'prefix' }] } }),
      record('assistant/message', { interrupted: true, message: { content: [] } }, 2),
      record('chunkrow/tool-call-chunks', {}, 3),
      record('tool/result', { message: { content: [] } }, 4),
    ])
    expect(state.items.map(item => item.text)).toEqual(['prefix（已中断）', '', '', ''])
    expect(state.toolCalls).toEqual([])
    expect(state.cursor).toBe(4)
  })
})

describe('Lite partial sequences', () => {
  it('starts with the same empty state for each projection', () => {
    expect(emptyLiteDomain()).toEqual(foldLiteDomain([]))
    expect(emptyLiteDomain().conversation).not.toBe(emptyLiteDomain().conversation)
  })

  it.each<LiteEvent[]>([
    [],
    [{ type: 'stream/reasoning', text: 'thinking' }],
  ])('cancels without adding an empty assistant message: %j', (...events) => {
    const state = foldLiteDomain([...events, { type: 'turn/cancelled', reason: 'user' }])
    expect(state.conversation).toEqual([])
    expect(state.interrupted).toBe(false)
    expect(state.lastTurnEnd).toBe('cancelled')
    expect(state.streaming).toEqual({ active: false, partialText: '', partialReasoning: '' })
  })

  it('ignores orphan tool results and artifact statuses', () => {
    expect(foldLiteDomain([
      { type: 'tool/result', id: 'missing', ok: false, text: 'error' },
      { type: 'artifact/status', id: 'missing', status: 'failed' },
    ])).toEqual(emptyLiteDomain())
  })
})
