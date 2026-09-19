import { describe, expect, it, vi } from 'vitest'
import type { RemoteHostFacts } from '@deepseek-ai/dsh-api-remotes/client'
import type { SubagentAddress } from '@deepseek-ai/dsh-subagent/client'
import { createComposerControlSource } from '../src/client/input/control-capabilities.ts'

const CHILD: SubagentAddress = { parentSessionId: 'p' as never, childSessionId: 'c' as never, mode: 'continuable' }

function bench(capabilities: readonly string[], address: SubagentAddress | undefined = CHILD) {
  let host: RemoteHostFacts = { home: undefined, isLoopback: true, capabilities }
  const cancel = vi.fn(() => Promise.resolve())
  const listeners = new Set<() => void>()
  const source = createComposerControlSource({
    host: () => host, address: () => address, alive: () => true, cancel,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  })
  const replace = (next: readonly string[] = capabilities) => {
    host = { ...host, capabilities: next }
    for (const listener of listeners) listener()
  }
  return { source, replace, cancel, listeners }
}

describe('addressed composer support', () => {
  it.each([
    { capabilities: [], prompt: false, interrupt: false },
    { capabilities: ['session.control.v1'], prompt: false, interrupt: false },
    { capabilities: ['subagent.catalog.v1'], prompt: false, interrupt: false },
    { capabilities: ['subagent.prompt.v1'], prompt: true, interrupt: false },
    { capabilities: ['subagent.interrupt.v1'], prompt: false, interrupt: true },
    { capabilities: ['subagent.interrupt-turn.v1'], prompt: false, interrupt: true },
  ])('separates prompt and interruption for $capabilities', ({ capabilities, prompt, interrupt }) => {
    const b = bench(capabilities)
    expect(b.source.getSnapshot()).toMatchObject({ prompt, interrupt })
    expect(b.source.getSnapshot()).toBe(b.source.getSnapshot())
    expect(b.cancel).not.toHaveBeenCalled()
  })

  it('keeps one-shot history read-only even when the Host supports continuation', () => {
    const b = bench(['subagent.prompt.v1', 'subagent.interrupt.v1'], { ...CHILD, mode: 'one-shot' })
    expect(b.source.getSnapshot()).toMatchObject({ prompt: false, interrupt: false })
  })

  it('rejects a retained Stop callback on an equally capable replacement', async () => {
    const b = bench(['subagent.interrupt.v1'])
    const stop = b.source.getSnapshot().stop!
    const listener = vi.fn()
    const dispose = b.source.subscribe(listener)
    b.replace()
    expect(listener).toHaveBeenCalledTimes(1)
    stop()
    expect(b.cancel).not.toHaveBeenCalled()
    b.source.getSnapshot().stop!()
    await Promise.resolve()
    expect(b.cancel).toHaveBeenCalledTimes(1)
    b.replace([])
    expect(b.source.getSnapshot().stop).toBeUndefined()
    dispose()
    expect(b.listeners.size).toBe(0)
  })
})
