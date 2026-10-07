// Bundles the Electron-side entry points (main process, preload, and the
// simulation host process) into dist-electron/*.cjs with Vite's own build
// API — the same toolchain as the renderer, no extra bundler.
//
//   node scripts/build-electron.mjs           one production build
//   node scripts/build-electron.mjs --watch   rebuild on change (npm run dev)
//
// Each entry is built separately into a single self-contained file: the
// sandboxed preload in particular may require nothing but 'electron', so it
// must never share a split chunk with main.
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');

// Runtime dependencies resolved from node_modules (packaged into app.asar)
// rather than bundled: sql.js locates its .wasm next to its own files.
const external = ['electron', 'sql.js', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

export const ENTRIES = [
  { name: 'main', entry: 'src/electron/main.ts' },
  { name: 'preload', entry: 'src/electron/preload.ts' },
  { name: 'simHost', entry: 'src/electron/simProcess.ts' },
];

function config({ name, entry }) {
  return {
    configFile: false,
    root,
    logLevel: 'warn',
    publicDir: false,
    mode: watch ? 'development' : 'production',
    define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      sourcemap: true,
      ssr: entry,
      reportCompressedSize: false,
      watch: watch ? {} : null,
      rolldownOptions: {
        external,
        output: { format: 'cjs', entryFileNames: `${name}.cjs`, codeSplitting: false },
      },
    },
    ssr: { noExternal: true, external: ['sql.js'] },
  };
}

for (const entry of ENTRIES) {
  await build(config(entry));
}
if (!watch) console.log(`Built ${ENTRIES.map((e) => `dist-electron/${e.name}.cjs`).join(', ')}`);
