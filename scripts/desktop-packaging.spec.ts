import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Format, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import type { AfterPackContext, Configuration } from 'electron-builder'
import { desktopBuildOptions } from './desktop-packaging.ts'
import { parseProductIdentity } from './release/product-identity.ts'
import { rewriteWindowsExecutableVersion } from './release/windows-executable-version.ts'

const identity = parseProductIdentity({ version: '12.34.56-beta.2' }, { schemaVersion: 1, buildNumber: 43210, channel: 'beta' })
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

function fixture(): Uint8Array {
  const executable = NtExecutable.createEmpty(false, false)
  const resources = NtExecutableResource.from(executable)
  for (const lang of [1033, 2052]) {
    const version = Resource.VersionInfo.create({
      lang,
      fixedInfo: { fileFlagsMask: 0x3f, fileFlags: 2, fileOS: 0x40004, fileType: 1 },
      strings: [{ lang, codepage: 1200, values: { FileVersion: '39.8.10', ProductVersion: '39.8.10', ProductName: 'Electron', CompanyName: 'Retained company' } }],
    })
    version.outputToResourceEntries(resources.entries)
  }
  resources.entries.push({ type: 10, id: 42, lang: 1033, codepage: 0, bin: Uint8Array.of(1, 3, 5, 7).buffer })
  resources.outputResource(executable)
  executable.setExtraData(Uint8Array.of(7, 5, 3, 1))
  return new Uint8Array(executable.generate())
}

describe('Windows executable application identity', () => {
  it('updates numeric and localized versions while retaining unrelated resources and overlay bytes', () => {
    const original = fixture()
    const originalCopy = original.slice()
    const updated = rewriteWindowsExecutableVersion(original, identity, 'DeepSeek Harness')
    expect(original).toEqual(originalCopy)
    const executable = NtExecutable.from(updated)
    expect(executable.is32bit()).toBe(false)
    expect(new Uint8Array(executable.getExtraData()!)).toEqual(Uint8Array.of(7, 5, 3, 1))
    const resources = NtExecutableResource.from(executable)
    const retained = resources.entries.find(entry => entry.type === 10 && entry.id === 42)!
    expect(new Uint8Array(retained.bin)).toEqual(Uint8Array.of(1, 3, 5, 7))
    const versions = Resource.VersionInfo.fromEntries(resources.entries)
    expect(versions).toHaveLength(2)
    for (const version of versions) {
      expect(version.fixedInfo).toMatchObject({
        fileVersionMS: (12 << 16) | 34,
        fileVersionLS: (56 << 16) | 43210,
        productVersionMS: (12 << 16) | 34,
        productVersionLS: (56 << 16) | 43210,
        fileFlags: 2,
      })
      for (const language of version.getAllLanguagesForStringValues()) {
        expect(version.getStringValues(language)).toMatchObject({
          FileVersion: '12.34.56.43210', ProductVersion: '12.34.56-beta.2',
          ProductName: 'DeepSeek Harness', CompanyName: 'Retained company',
        })
      }
    }
  })

  it('rejects malformed, missing-version and certificate-bearing binaries', () => {
    expect(() => rewriteWindowsExecutableVersion(Uint8Array.of(1, 2), identity, 'App')).toThrow()
    const missing = new Uint8Array(NtExecutable.createEmpty(false, false).generate())
    expect(() => rewriteWindowsExecutableVersion(missing, identity, 'App')).toThrow('no version resource')
    const certificateBearing = fixture()
    const headerOffset = new DataView(certificateBearing.buffer).getUint32(0x3c, true)
    Format.ImageNtHeaders.from(certificateBearing, headerOffset).optionalHeaderDataDirectory.set(4, {
      virtualAddress: certificateBearing.byteLength - 4, size: 4,
    })
    expect(() => rewriteWindowsExecutableVersion(certificateBearing, identity, 'App')).toThrow(/signed|certificate/i)
  })
})

describe('desktop candidate builder', () => {
  it('writes application versions in afterPack before installers consume the unsigned executable', async () => {
    const output = await mkdtemp(join(tmpdir(), 'dsh-desktop-version-'))
    directories.push(output)
    const filename = join(output, 'Renamed App.exe')
    await writeFile(filename, fixture())
    const options = desktopBuildOptions('/deployed-app', output, identity)
    expect(options.publish).toBe('never')
    const config = options.config as Configuration
    expect(config.publish).toBeNull()
    expect(config.cscLink).toBe('')
    expect(config.buildVersion).toBe('12.34.56.43210')
    expect(config.win?.signAndEditExecutable).toBe(false)
    const hook = config.afterPack as (context: AfterPackContext) => Promise<void>
    await hook({
      appOutDir: output,
      packager: { appInfo: { productFilename: 'Renamed App', productName: 'Renamed App' } },
    } as AfterPackContext)
    const resources = NtExecutableResource.from(NtExecutable.from(await readFile(filename)))
    for (const version of Resource.VersionInfo.fromEntries(resources.entries)) {
      expect(version.getStringValues({ lang: Number(version.lang), codepage: 1200 })).toMatchObject({
        ProductName: 'Renamed App', ProductVersion: '12.34.56-beta.2', FileVersion: '12.34.56.43210',
      })
    }
    await writeFile(filename, 'corrupted input')
    await expect(hook({
      appOutDir: output,
      packager: { appInfo: { productFilename: 'Renamed App', productName: 'Renamed App' } },
    } as AfterPackContext)).rejects.toThrow()
    expect(await readFile(filename, 'utf8')).toBe('corrupted input')
  })
})
