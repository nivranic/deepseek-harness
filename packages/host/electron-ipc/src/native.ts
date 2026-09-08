/** Native application callbacks kept outside the client-safe support result types. */
import type { ApprovedSupportDocument } from './support-export.ts'

/** The Electron application owns product metadata, bundled resources and the native save operation. */
export interface DesktopSupportHost {
  readonly scannerDirectory: string
  /**
   * Read the staged application's bounded package.json; the exporter selects only identity fields.
   * @returns parsed package metadata, without logging or projecting the complete manifest.
   */
  readProductManifest(): Promise<unknown>
  /**
   * Present a cancellable native save dialog and write only the document's approved bytes.
   * @param document - immutable bytes already admitted by the bundled scanner.
   * @param signal - closes the native dialog and cancels a save before its atomic commit.
   * @returns saved only after commit, or cancelled without creating the destination.
   */
  save(document: ApprovedSupportDocument, signal: AbortSignal): Promise<'saved' | 'cancelled'>
}
