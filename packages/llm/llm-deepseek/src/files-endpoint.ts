/** Shared endpoint spelling for Files API requests and upload-cache scopes. */

/**
 * Remove only trailing ASCII slashes without rescanning interior slash runs.
 * @param baseURL - configured endpoint text.
 * @returns the endpoint with its trailing slashes removed and all other characters preserved.
 */
export function filesEndpoint(baseURL: string): string {
  let end = baseURL.length
  while (end > 0 && baseURL.charCodeAt(end - 1) === 47) end--
  return baseURL.slice(0, end)
}
