/** Session-list failures stay visible until the user explicitly retries a read through the real Host. */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android explicitly recovers a failed Session list read', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  try {
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    driver = await startAndroidCompanionUiDriver(process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port)
    expect((await driver.request({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })).type).toBe('ok')
    expect(await driver.request({ op: 'assertSessionListReady' })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'assertNoSessionSend' })).toMatchObject({ type: 'ok' })
    await driver.setHostReachable(false)
    expect(await driver.request({ op: 'refreshSessions' })).toMatchObject({ type: 'ok' })
    expect(await driver.request({ op: 'assertSessionListFailure' })).toMatchObject({ type: 'ok', value: 'transport' })
    const folder = fileURLToPath(new URL('../../../.artifacts/screenshots/android-session-list/', import.meta.url))
    await mkdir(folder, { recursive: true })
    const disconnected = await driver.request({ op: 'screenshot' })
    expect(disconnected.type).toBe('ok')
    await writeFile(join(folder, 'transport-failure.png'), Buffer.from(disconnected.value as string, 'base64'))
    await driver.setHostReachable(true)
    expect(await driver.request({ op: 'refreshSessions' })).toMatchObject({ type: 'ok' })
    expect(await driver.request({ op: 'assertSessionListReady' })).toMatchObject({ type: 'ok', value: null })
    expect(await driver.request({ op: 'assertNoSessionSend' })).toMatchObject({ type: 'ok' })
    await scaffold.ctx.deviceTrust.revokeDevice({ deviceId: scaffold.ctx.deviceTrust.listDevices()[0]!.deviceId })
    expect(await driver.request({ op: 'refreshSessions' })).toMatchObject({ type: 'ok' })
    expect(await driver.request({ op: 'assertSessionListFailure' })).toMatchObject({ type: 'ok', value: 'refused' })
    const revoked = await driver.request({ op: 'screenshot' })
    expect(revoked.type).toBe('ok')
    await writeFile(join(folder, 'revoked-failure.png'), Buffer.from(revoked.value as string, 'base64'))
    expect((await driver.request({ op: 'close' })).type).toBe('ok')
    expect(await driver.stop()).toBe(0)
    const expected = fileURLToPath(new URL('./expected/android-session-list.expected.md', import.meta.url))
    await compareOrRefreshGolden(expected, [
      '# Android Session-list recovery', '',
      '- An authenticated empty list displays its empty state and disables send and stop without an open Session.',
      '- Removing only the test Host port forward makes an explicit list refresh fail with a visible transport message.',
      '- The retry control remains available; transport recovery itself does not replay a user mutation.',
      '- Restoring the port forward and tapping retry loads the list and removes the failure message.',
      '- Revoking the device grant makes a later refresh display the classified Host refusal.',
      '- The test closes its transport and releases its private forwards and emulator lease.',
    ].join('\n'), MODE)
  } catch (error) { failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android Session-list recovery failed')
}, 120_000)
