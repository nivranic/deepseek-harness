import { parseBootManifest } from "./manifest.js";
export { ClientModuleSystem } from "./system.js";
export { parseBootManifest } from "./manifest.js";
/**
 * Enroll the kernel-built module system as `ctx.modules` and provide the boot
 * document's installation facts as `ctx.appInfo`.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    const modules = globalThis.__DSH_MODULES__;
    // The kernel writes the slot right after constructing the instance, before
    // any cordis entry exists — a missing slot means the kernel sequencing broke.
    if (modules === undefined) {
        throw new Error('client-modules: window.__DSH_MODULES__ missing — the shell kernel must construct the module system before plugin boot');
    }
    ctx.reflect.provide('modules', modules);
    // The kernel already parsed the same document successfully (boot would not
    // have reached plugin adoption otherwise); re-parsing is the validated read
    // of the wire fact, so a throw here names a kernel/parser divergence.
    ctx.reflect.provide('appInfo', { version: parseBootManifest(globalThis.__DSH_BOOT__).version });
}
//# sourceMappingURL=index.js.map