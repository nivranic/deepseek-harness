// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import type { ChatSnapshot, UseChat } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApprovalCommand, commandOf } from '../src/client/chat/ApprovalCommand.tsx'
import { ApprovalTarget, targetOf } from '../src/client/chat/ApprovalTarget.tsx'
import { apply as nodeApply } from '../src/index.ts'

function props(
  nodes: readonly unknown[],
  callId = 'call-1',
): PropsRuntime<'conversation.approval.detail'> {
  const snapshot = {
    nodes: { values: () => nodes },
  } as unknown as ChatSnapshot
  const useChat = ((selector: (value: ChatSnapshot) => unknown) => selector(snapshot)) as UseChat
  return { callId, useChat } as PropsRuntime<'conversation.approval.detail'>
}

function targetProps(
  nodes: readonly unknown[],
  callId = 'call-1',
): PropsRuntime<'conversation.approval.target'> {
  return props(nodes, callId)
}

describe('commandOf', () => {
  it('accepts only a string command from valid JSON arguments', () => {
    expect(commandOf(undefined)).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{"command":42}' })).toBeUndefined()
    expect(commandOf({ callId: 'c1', argsRaw: '{"command":"pnpm test"}' })).toBe('pnpm test')
  })
})

describe('targetOf', () => {
  it('prefers the command, falls back to the path, and rejects everything else', () => {
    expect(targetOf(undefined)).toBeUndefined()
    expect(targetOf({ callId: 'c1', argsRaw: '{' })).toBeUndefined()
    expect(targetOf({ callId: 'c1', argsRaw: '{}' })).toBeUndefined()
    expect(targetOf({ callId: 'c1', argsRaw: '{"path":42}' })).toBeUndefined()
    expect(targetOf({ callId: 'c1', argsRaw: '{"command":"pnpm test"}' })).toBe('pnpm test')
    expect(targetOf({ callId: 'c1', argsRaw: '{"path":"docs/README.md"}' })).toBe('docs/README.md')
    expect(targetOf({ callId: 'c1', argsRaw: '{"command":"ls","path":"/tmp"}' })).toBe('ls')
  })
})

describe('ApprovalTarget', () => {
  it('renders the correlated Tool call path for filesystem targets', () => {
    render(<ApprovalTarget {...targetProps([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: { callId: 'other', argsRaw: '{"path":"wrong.md"}' } } },
      { kind: 'tool-call', data: { root: { callId: 'call-1', argsRaw: '{"path":"docs/README.md"}' } } },
    ] as never)} />)

    expect(screen.getByText('docs/README.md')).toBeTruthy()
  })

  it('omits argument-less correlated calls', () => {
    const { container } = render(<ApprovalTarget {...targetProps([
      { kind: 'tool-call', data: { root: { callId: 'call-1', argsRaw: '{}' } } },
    ] as never)} />)
    expect(container.textContent).toBe('')
  })
})

describe('ApprovalCommand', () => {
  it('renders the running correlated Tool command', () => {
    render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: { callId: 'other', argsRaw: '{"command":"wrong"}' } } },
      { kind: 'tool-call', data: { root: { callId: 'call-1', argsRaw: '{"command":"pnpm test"}' } } },
    ] as never)} />)

    expect(screen.getByText('pnpm test')).toBeTruthy()
  })

  it('omits absent, uncorrelated, and settled Tool calls', () => {
    const { container, rerender } = render(<ApprovalCommand {...props([
      { kind: 'assistant-step', data: {} },
      { kind: 'tool-call', data: { root: undefined } },
      { kind: 'tool-call', data: { root: { callId: 'other', argsRaw: '{}' } } },
      {
        kind: 'tool-call',
        data: { root: { kind: 'tool-result', callId: 'call-1', argsRaw: '{"command":"ignored"}' } },
      },
    ] as never)} />)
    expect(container.textContent).toBe('')

    rerender(<ApprovalCommand {...props([
      { kind: 'tool-call', data: { root: { callId: 'call-1', argsRaw: '{}' } } },
    ] as never)} />)
    expect(container.textContent).toBe('')
  })
})

describe('ui-chat package entries', () => {
  it('keeps the Host half optional', () => {
    const ctx = new Context()
    expect(() => { nodeApply(ctx) }).not.toThrow()
  })
})
