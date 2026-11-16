import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopShellPreferences } from '../src/shell-preferences.ts'

const io = vi.hoisted(() => ({ beforeWrite: async (): Promise<void> => {} }))
vi.mock('@deepseek-ai/dsh-atomic-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-atomic-write')>()
  return { ...actual, writeFileAtomic: async (...args: Parameters<typeof actual.writeFileAtomic>) => {
    await io.beforeWrite()
    await actual.writeFileAtomic(...args)
  } }
})

const roots: string[] = []
afterEach(() => {
  io.beforeWrite = async () => {}
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
function path(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-shell-preferences-'))
  roots.push(root)
  return join(root, 'preferences.json')
}

it('defaults to normal window closing and restores a committed tray preference', async () => {
  const file = path()
  const preferences = new DesktopShellPreferences(file)
  expect(preferences.closeToTray).toBe(false)
  await preferences.setCloseToTray(true)
  expect(new DesktopShellPreferences(file).closeToTray).toBe(true)
  expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ schemaVersion: 1, closeToTray: true })
})

it.each(['null', '{}', '{"schemaVersion":2,"closeToTray":true}',
  '{"schemaVersion":1,"closeToTray":"true"}', '{"schemaVersion":1,"closeToTray":true,"launchAtLogin":true}', 'broken']) (
  'preserves an unsupported preferences document: %s', (text) => {
    const file = path()
    writeFileSync(file, text)
    expect(() => new DesktopShellPreferences(file)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe(text)
  },
)

it('keeps the committed value after a write failure and permits a later repair', async () => {
  const file = path()
  const preferences = new DesktopShellPreferences(file)
  await preferences.setCloseToTray(true)
  const failure = new Error('disk write refused')
  io.beforeWrite = async () => { throw failure }
  await expect(preferences.setCloseToTray(false)).rejects.toBe(failure)
  expect(preferences.closeToTray).toBe(true)
  expect(new DesktopShellPreferences(file).closeToTray).toBe(true)
  io.beforeWrite = async () => {}
  await preferences.setCloseToTray(false)
  expect(preferences.closeToTray).toBe(false)
})

it('serializes writes, publishes after persistence, and joins admitted work during shutdown', async () => {
  const file = path()
  const preferences = new DesktopShellPreferences(file)
  const started = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  io.beforeWrite = async () => { started.resolve(undefined); await release.promise }
  const first = preferences.setCloseToTray(true)
  const second = preferences.setCloseToTray(false)
  let closed = false
  let closing: Promise<void> | undefined
  try {
    await started.promise
    expect(preferences.closeToTray).toBe(false)
    closing = preferences.close().then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)
    await expect(preferences.setCloseToTray(true)).rejects.toThrow('closed')
    release.resolve(undefined)
    await Promise.all([first, second, closing])
  } finally {
    release.resolve(undefined)
    await Promise.allSettled([first, second, closing])
    await preferences.close()
  }
  expect(closed).toBe(true)
  expect(new DesktopShellPreferences(file).closeToTray).toBe(false)
})
