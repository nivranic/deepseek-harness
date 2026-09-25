/** Invalid encrypted credentials remain intact until explicit verified Android pairing succeeds. */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
for (const damage of ['malformed', 'ciphertext', 'missing-key'] as const) {
  it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')(`Android recovers credentials after ${damage}`, async () => {
    const scaffold = await launchWebScaffold({
      extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
      extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
    })
    let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
    const failures: unknown[] = []
    try {
      const info = scaffold.ctx.nativeRemote.describe()
      const host = scaffold.ctx.hostDescription.describe()
      const start = (resetData: boolean) => startAndroidCompanionUiDriver(
        process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, resetData,
      )
      const payload = () => {
        const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
        return {
          kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
          hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
          code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
        }
      }
      driver = await start(true)
      expect((await driver.request({ op: 'pair', payload: payload() })).type).toBe('ok')
      expect(await driver.request({ op: 'assertSessionListReady' })).toMatchObject({ type: 'ok' })
      expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
      const damaged = await driver.request({ op: 'damageCredentials', damage })
      expect(damaged.type).toBe('ok')
      expect((await driver.request({ op: 'close' })).type).toBe('ok')
      expect(await driver.stop()).toBe(0)
      driver = await start(false)
      expect(await driver.request({ op: 'assertCredentialRecovery', damage, digest: damaged.value }))
        .toMatchObject({ type: 'ok', value: null })
      expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
      expect((await driver.request({ op: 'pair', payload: payload() })).type).toBe('ok')
      expect(await driver.request({ op: 'assertSessionListReady' })).toMatchObject({ type: 'ok' })
      expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(2)
      expect((await driver.request({ op: 'close' })).type).toBe('ok')
      expect(await driver.stop()).toBe(0)
      driver = await start(false)
      expect((await driver.request({ op: 'assertRestored' })).type).toBe('ok')
      expect(await driver.request({ op: 'assertSessionListReady' })).toMatchObject({ type: 'ok' })
      expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(2)
      expect((await driver.request({ op: 'close' })).type).toBe('ok')
      expect(await driver.stop()).toBe(0)
      const expected = fileURLToPath(new URL(`./expected/android-credential-recovery.${damage}.expected.md`, import.meta.url))
      await compareOrRefreshGolden(expected, [
        `# Android credential recovery: ${damage}`, '',
        '- A paired application sends an authenticated Session list request to the real Host.',
        '- A different process rejects the damaged identity and presents explicit pairing recovery.',
        '- Failed restoration preserves credential file bytes and does not redeem another Host grant.',
        ...damage === 'missing-key' ? ['- Reading the encrypted identity does not create a replacement Keystore key.'] : [],
        '- Explicit verified pairing stores a usable replacement; the original Host grant remains for operator revocation.',
        '- Another process restores the replacement and sends a signed request without a third grant.',
      ].join('\n'), MODE)
    } catch (error) { failures.push(error) }
    finally {
      await driver?.kill().catch((error: unknown) => { failures.push(error) })
      await scaffold.close().catch((error: unknown) => { failures.push(error) })
    }
    if (failures.length) throw new AggregateError(failures, `Android credential recovery failed: ${damage}`)
  }, 120_000)
}
