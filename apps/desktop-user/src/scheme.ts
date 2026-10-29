/** Privileged-scheme constants shared by the desktop shell's registration and window load. */

/**
 * The desktop carrier scheme: renderer page loads and every fetch ride it, and
 * the host answers in-process through desktopGateway — no socket binds. The
 * name is registered as privileged before app ready (main) and is the wire
 * fact the client connection half detects through the page protocol.
 */
export const DSH_SCHEME = 'dsh'

/** The single fixed host of the desktop origin; the surface has no network identity. */
const DSH_HOST = 'desktop'

/** Entry URL loaded into the BrowserWindow; the gateway answers it with the boot-manifest-injected index. */
export const ENTRY_URL = `${DSH_SCHEME}://${DSH_HOST}/`
