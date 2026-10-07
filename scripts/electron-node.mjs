// Runs a Node script under Electron's own Node runtime — the exact runtime
// (Node 24, node:sqlite with array rows) the desktop game's simulation
// process uses — without starting the app:
//
//   node scripts/electron-node.mjs <script> [args…]
//
// Used for the native-SQLite tests and benchmarks (npm run test:native,
// npm run sim:perf:electron).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const electronPath = createRequire(import.meta.url)('electron');
const child = spawn(electronPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
child.on('exit', (code) => process.exit(code ?? 1));
