/** Unsigned Windows candidate packaging and pre-installer application metadata. */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Arch, Platform, type CliOptions } from 'electron-builder'
import type { ProductIdentity } from './release/product-identity.ts'
import { rewriteWindowsExecutableVersion } from './release/windows-executable-version.ts'

/**
 * Configure unsigned NSIS and portable candidates over a deployed app closure.
 * The afterPack hook edits the main executable before installers collect it.
 * Publishing and all certificate-backed signing are disabled for this producer.
 * @param stageDir - exclusive deployed application directory outside the workspace.
 * @param outputDir - destination for the unpacked application and installers.
 * @param identity - validated application identity shared by every platform.
 * @returns electron-builder options for one Windows x64 candidate build.
 */
export function desktopBuildOptions(stageDir: string, outputDir: string, identity: ProductIdentity): CliOptions {
  return {
    projectDir: stageDir,
    targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
    publish: 'never',
    config: {
      appId: 'com.deepseek.dsh',
      productName: 'DeepSeek Harness',
      buildVersion: identity.windowsFileVersion,
      buildNumber: String(identity.buildNumber),
      publish: null,
      // An explicit empty link overrides ambient CSC_LINK and WIN_CSC_LINK.
      cscLink: '',
      directories: { output: outputDir },
      files: ['lib/**/*.js', 'resources/**', 'package.json'],
      // The deployed node-pty closure supplies its Electron-compatible prebuilds.
      npmRebuild: false,
      // Profile fallback junctions must resolve real package directories at boot.
      asar: false,
      win: {
        // resedit owns unsigned PE metadata without winCodeSign's symlink extraction.
        signAndEditExecutable: false,
        signtoolOptions: { sign: () => Promise.resolve() },
      },
      nsis: { oneClick: false, allowToChangeInstallationDirectory: true },
      afterPack: async (context) => {
        const filename = join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
        const content = await readFile(filename)
        const updated = rewriteWindowsExecutableVersion(content, identity, context.packager.appInfo.productName)
        await writeFile(filename, updated)
      },
    },
  }
}
