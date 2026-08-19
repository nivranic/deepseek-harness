import { describe, expect, it } from 'vitest'
import { nodeSpawnCommand } from '../src/index.ts'

describe('nodeSpawnCommand', () => {
  it('under plain Node, uses process.execPath with no environment additions', () => {
    const command = nodeSpawnCommand({ execPath: '/usr/bin/node', electron: undefined })

    expect(command).toEqual({ command: '/usr/bin/node', env: {} })
  })

  it('under an Electron binary, marks the same executable as its Node CLI mode', () => {
    const command = nodeSpawnCommand({ execPath: 'C:/app/DeepSeek Harness.exe', electron: '39.8.10' })

    expect(command).toEqual({
      command: 'C:/app/DeepSeek Harness.exe',
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })

  it('defaults to the real process facts', () => {
    const command = nodeSpawnCommand()
    const electron = process.versions.electron

    expect(command.command).toBe(process.execPath)
    if (electron === undefined) expect(command.env).toEqual({})
    else expect(command.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' })
  })
})
