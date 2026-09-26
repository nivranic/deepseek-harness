/** A previous native credential file is imported only by explicit action, never used as catalog fallback. */
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-api-native-remote'
import type {} from '@deepseek-ai/dsh-api-device-trust'
import type {} from '@deepseek-ai/dsh-api-host-description'
import { compareOrRefreshGolden, launchWebScaffold, webSnapshotMode } from './scaffold.ts'
import { startAndroidCompanionUiDriver } from './android-companion-ui-driver.ts'

const MODE = webSnapshotMode()
it.skipIf(!process.env.DSH_ANDROID_ADB || MODE === 'record')('Android explicitly imports a prior native identity and refuses silent fallback', async () => {
  const scaffold = await launchWebScaffold({
    extraOverlayPath: fileURLToPath(new URL('./fixtures/native-remote.patch.yml', import.meta.url)),
    extraInstallAnchors: [fileURLToPath(new URL('./fixtures/native-remote/package.json', import.meta.url))],
  })
  let driver: Awaited<ReturnType<typeof startAndroidCompanionUiDriver>> | undefined
  const failures: unknown[] = []
  try {
    const info = scaffold.ctx.nativeRemote.describe()
    const host = scaffold.ctx.hostDescription.describe()
    const start = (reset: boolean) => startAndroidCompanionUiDriver(
      process.env.DSH_ANDROID_ADB!, process.env.DSH_ANDROID_SERIAL ?? '', info.port, reset,
    )
    const issued = scaffold.ctx.deviceTrust.issuePairing('collaborator')
    driver = await start(true)
    expect(await driver.request({ op: 'pair', payload: {
      kind: 'dsh-native-pairing', version: 1, endpoint: `https://127.0.0.1:${info.port}`,
      hostId: host.hostId, displayName: host.displayName, spkiFingerprint: info.spkiFingerprint,
      code: issued.code, expiresAt: issued.expiresAt, role: issued.role,
    } })).toMatchObject({ type: 'ok' })
    const legacy = await driver.request({ op: 'prepareLegacyImport' })
    expect(legacy.type).toBe('ok')
    await driver.kill()
    driver = await start(false)
    expect(await driver.request({ op: 'importLegacyHost', digest: legacy.value })).toMatchObject({ type: 'ok' })
    expect(await driver.request({ op: 'assertCurrentHost', hostId: host.hostId, count: 1 })).toMatchObject({ type: 'ok' })
    expect(await driver.request({ op: 'assertSessionListReady' })).toMatchObject({ type: 'ok' })
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    const damaged = await driver.request({ op: 'damageCredentials', damage: 'ciphertext' })
    expect(damaged.type).toBe('ok')
    await driver.kill()
    driver = await start(false)
    expect(await driver.request({ op: 'assertCredentialRecovery', damage: 'ciphertext', digest: damaged.value }))
      .toMatchObject({ type: 'ok' })
    expect(scaffold.ctx.deviceTrust.listDevices()).toHaveLength(1)
    await driver.kill()
    await compareOrRefreshGolden(fileURLToPath(new URL('./expected/android-host-import.expected.md', import.meta.url)), [
      '# Android explicit native Host import', '',
      '- A missing catalog displays an import action without restoring the old identity automatically.',
      '- Explicit import preserves the original credential file and reuses its existing Host grant.',
      '- The imported selection issues an authenticated Session list request.',
      '- A later unreadable catalog requires explicit recovery even while the old credential file remains usable.',
    ].join('\n'), MODE)
  } catch (error) { failures.push(error) }
  finally {
    await driver?.kill().catch((error: unknown) => { failures.push(error) })
    await scaffold.close().catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length) throw new AggregateError(failures, 'Android explicit Host import failed')
}, 120_000)
