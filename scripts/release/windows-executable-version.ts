/** Application version resources for unsigned Windows executables. */
import { NtExecutable, NtExecutableResource, Resource } from 'resedit'
import type { ProductIdentity } from './product-identity.ts'

/**
 * Rewrite every version resource before installer packaging or code signing.
 * Other resource entries and executable sections are retained. Malformed PE
 * input, signed input, and an executable without version resources fail.
 * @param content - complete unsigned executable bytes.
 * @param identity - validated application version and platform build number.
 * @param productName - application name recorded in the Windows version strings.
 * @returns replacement executable bytes; the input buffer is unchanged.
 */
export function rewriteWindowsExecutableVersion(
  content: Uint8Array,
  identity: ProductIdentity,
  productName: string,
): Uint8Array {
  const executable = NtExecutable.from(content)
  const resources = NtExecutableResource.from(executable)
  const versions = Resource.VersionInfo.fromEntries(resources.entries)
  if (versions.length === 0) throw new Error('Windows executable has no version resource')
  for (const version of versions) {
    version.setFileVersion(identity.windowsFileVersion)
    version.setProductVersion(identity.windowsFileVersion)
    for (const language of version.getAllLanguagesForStringValues()) {
      version.setStringValues(language, {
        FileVersion: identity.windowsFileVersion,
        ProductVersion: identity.version,
        ProductName: productName,
      })
    }
    version.outputToResourceEntries(resources.entries)
  }
  resources.outputResource(executable)
  return new Uint8Array(executable.generate())
}
