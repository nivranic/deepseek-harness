/** Desktop API carrier: the host's privileged-scheme bridge carries fetch. */

import { AbstractApiClient } from './api.ts'

/**
 * Desktop platform subclass: `doFetch` stays the page's own fetch, which the
 * Electron host answers in-process through its privileged app scheme (the IPC
 * bridge the webserver README documents for the desktop shape). Event streams
 * keep the base SSE openers — the bridge streams them, and the browser-only
 * WebSocket override has no downlink to reach here.
 */
export class IpcApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    return globalThis.fetch(input, init)
  }
}
