/** Normalize operator input without accepting credentials, paths, or a different listener port. */

/**
 * Validate the reachable origin entered for one native listener.
 * @param input - untrusted address typed by the operator.
 * @param port - actual port reported by the authenticated Host.
 * @returns canonical HTTPS origin, or undefined for an unusable address.
 */
export function nativePairingOrigin(input: string, port: number): string | undefined {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    // URL rejects malformed operator input before any pairing code is issued.
    return undefined
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== ''
    || Number(url.port || '443') !== port || ['0.0.0.0', '[::]'].includes(url.hostname)) return undefined
  return url.origin
}
