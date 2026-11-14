/** The host roster plugin's Host entry is an executable no-op. */
import { expect, it } from 'vitest'
import * as host from '../src/index.ts'

it('exposes a callable Host entry for host roster', () => {
  expect(Object.keys(host)).toEqual(['apply'])
  expect(() => { host.apply() }).not.toThrow()
})
