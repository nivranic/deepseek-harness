/** Exercise the private Desktop registration through the shipped snapshot profile. */
const source = new URL('../../../apps/desktop-host/src/desktop-context.ts', import.meta.url)
const built = new URL('../../../apps/desktop-host/lib/types/desktop-context.js', import.meta.url)
const { registerDesktopContext } = await import(process.env.DSH_EXAMPLE_MODE === 'lib' ? built.href : source.href)

export const name = 'desktop-context-snapshot'

/** Register the same application context used by the Desktop Host bootstrap. */
export function apply(ctx) {
  registerDesktopContext(ctx)
}
