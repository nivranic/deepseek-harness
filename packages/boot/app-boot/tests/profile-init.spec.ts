/** Profile initialization preserves entries published by another writer. */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { initProfile } from '../src/profile.ts'

const collision = vi.hoisted(() => ({ path: '', content: '', error: undefined as Error | undefined }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      if (args[0] === collision.path) {
        collision.path = ''
        if (collision.error !== undefined) throw collision.error
        actual.writeFileSync(args[0], collision.content)
      }
      actual.writeFileSync(...args)
    },
  }
})

const roots: string[] = []
afterEach(() => {
  collision.path = ''
  collision.error = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-profile-init-'))
  roots.push(root)
  return root
}

it.each(['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml'])(
  'preserves %s created immediately before the initialization write', (name) => {
    const root = directory()
    const target = join(root, name)
    collision.path = target
    collision.content = 'concurrent owner contents\n'
    initProfile(root, ['initial-bundle'])
    expect(collision.path).toBe('')
    expect(readFileSync(target, 'utf8')).toBe(collision.content)
  },
)

it('reports a write failure other than an existing entry', () => {
  const root = directory()
  collision.path = join(root, 'package.json')
  collision.error = Object.assign(new Error('profile initialization denied'), { code: 'EACCES' })
  expect(() => { initProfile(root, []) }).toThrow(collision.error)
})
