/** §26 view-location handoff: capture into a cross-device link, open a received one. */
import { createSnapshotStore, type ObservableSnapshot, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConnectionGeneration } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'

/** URL fragment carrying one handoff payload: `#dsh-view=<payload>`. */
export const VIEW_HANDOFF_FRAGMENT = 'dsh-view'

/** Prefix a received page fragment must start with to carry a handoff payload. */
const FRAGMENT_PREFIX = `#${VIEW_HANDOFF_FRAGMENT}=`

type LocationLike = { origin: string; pathname: string; hash: string }

/**
 * Owns the host-admission signal, link building, clipboard delivery, and the
 * one-shot received-link open. The viewing position moves; the runtime never does.
 */
export class ViewHandoffController {
  /** True while the current generation's ready frame carried a Host descriptor. */
  readonly admitted: SnapshotStore<boolean> = createSnapshotStore(false)
  private readonly listeners = new Set<() => void>()

  /**
   * @param generation - the connection generation observable; descriptor presence is the
   * same admission signal `ClientSessions.encodeViewLocation` requires.
   * @param clipboard - async text writer, injectable for tests.
   * @param location - page location, injectable for tests.
   */
  constructor(
    generation: ObservableSnapshot<ConnectionGeneration | undefined>,
    private readonly clipboard: (text: string) => Promise<void> = text => navigator.clipboard.writeText(text),
    private readonly location: LocationLike = globalThis.location,
  ) {
    const apply = (): void => { this.admitted.set(generation.getSnapshot()?.host.descriptor !== undefined) }
    apply()
    generation.subscribe(() => {
      apply()
      for (const listener of [...this.listeners]) listener()
    })
  }

  /**
   * Build the cross-device link for one encoded payload.
   * @param payload - `ClientSessions.encodeViewLocation` output.
   * @returns page URL with the payload in its fragment, never sent to any server.
   */
  buildLink(payload: string): string {
    return `${this.location.origin}${this.location.pathname}#${VIEW_HANDOFF_FRAGMENT}=${payload}`
  }

  /**
   * Copy text to the clipboard.
   * @param text - the link to place on the clipboard.
   * @returns whether the clipboard accepted the write.
   */
  async copy(text: string): Promise<boolean> {
    try {
      await this.clipboard(text)
      return true
    } catch {
      return false
    }
  }

  /**
   * Resolve once a generation carries a Host descriptor (a received link cannot
   * open before its Host is admitted; pending forever means nobody connected).
   * @returns after the first admitted generation.
   */
  waitForAdmission(): Promise<void> {
    if (this.admitted.getSnapshot()) return Promise.resolve()
    return new Promise((resolve) => {
      const listener = (): void => {
        if (!this.admitted.getSnapshot()) return
        this.listeners.delete(listener)
        resolve()
      }
      this.listeners.add(listener)
    })
  }

  /**
   * Read a received handoff from the page fragment and open it exactly once.
   * The fragment is consumed on read (one-shot: a wrong-Host failure does not
   * loop on refresh), and the open happens only after admission so the payload
   * can never leak to a Host it does not target.
   * @param sessions - the Client sessions service.
   * @param onOpened - optional completion observation for tests.
   */
  async receive(sessions: ISessions, onOpened?: (outcome: 'opened' | 'failed', error?: unknown) => void): Promise<void> {
    const hash = this.location.hash
    if (!hash.startsWith(FRAGMENT_PREFIX)) return
    const payload = hash.slice(FRAGMENT_PREFIX.length)
    this.location.hash = ''
    await this.waitForAdmission()
    try {
      await sessions.openViewLocation(payload)
      onOpened?.('opened')
    } catch (error) {
      // Wrong Host or unresolvable payload: fail loud in the console, never retry.
      console.error('[view-handoff] opening the received view location failed:', error)
      onOpened?.('failed', error)
    }
  }
}
