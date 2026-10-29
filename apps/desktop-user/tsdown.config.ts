import { defineConfig } from 'tsdown'

/**
 * The desktop shell ships two entries: the Electron main process (`main`,
 * referenced by package.json `main`) and its scheme constants. The root
 * tsdown builds only `lib/types/index.js`, so this override points at the
 * real entries; reachable modules bundle with them. Declarations come from
 * `tsc -b` (dts: false), matching every package.
 */
export default defineConfig({
  entry: ['lib/types/main.js', 'lib/types/scheme.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  // The Electron runtime is provided by the host process at runtime; it is a
  // devDependency, so without this the bundler would inline its CJS bootstrap
  // (a __dirname user) into the ESM bundle and crash at load.
  external: ['electron'],
})
