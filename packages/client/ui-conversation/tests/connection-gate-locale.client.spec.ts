import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'
import { CONNECTION_GATE_KEYS } from '../src/client/skeleton/ConversationRoot.tsx'

describe('connection gate locale matrix (§18)', () => {
  it('spells a non-empty gate string for every non-ready state in both dictionaries', () => {
    const states = Object.keys(CONNECTION_GATE_KEYS)
    expect(states).toHaveLength(10)
    for (const state of states) {
      const key = `connection.gate.${state}`
      const zhLine = (zh as Record<string, string>)[key]
      const enLine = (en as Record<string, string>)[key]
      expect(zhLine, `zh dictionary misses ${key}`).toBeTruthy()
      expect(enLine, `en dictionary misses ${key}`).toBeTruthy()
    }
  })
})
