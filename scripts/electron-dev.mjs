// npm run dev: the desktop game with hot reload.
//
// - the renderer is served by the Vite dev server (React fast refresh);
// - the Electron-side bundles (main, preload, simulation host) rebuild on
//   change (scripts/build-electron.mjs --watch);
// - Electron restarts whenever one of those bundles changes.
//
// Closing the game window ends the whole session.
import { spawn } from 'node:child_process';
import { existsSync, rmSync, statSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { electronEnv } from './electronEnv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist-electron');
const require = createRequire(import.meta.url);
const electronPath = require('electron');

rmSync(outDir, { recursive: true, force: true });

const vite = await createServer({ root, server: { host: '127.0.0.1', port: 5173 } });
await vite.listen();
const devServerUrl = vite.resolvedUrls?.local[0];
if (!devServerUrl) throw new Error('Vite did not report a local URL.');
console.log(`[dev] renderer at ${devServerUrl}`);

const builder = spawn(process.execPath, [path.join(root, 'scripts', 'build-electron.mjs'), '--watch'], {
  cwd: root,
  stdio: 'inherit',
});

const bundles = ['main.cjs', 'preload.cjs', 'simHost.cjs'].map((file) => path.join(outDir, file));
while (!bundles.every((file) => existsSync(file) && statSync(file).size > 0)) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}

let electron = null;
let restarting = false;
let shuttingDown = false;

function startElectron() {
  electron = spawn(electronPath, [root, ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: electronEnv({ WYRNLANDS_DEV_SERVER_URL: devServerUrl }),
  });
  electron.on('exit', () => {
    if (restarting) {
      restarting = false;
      startElectron();
    } else {
      void shutdown();
    }
  });
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  builder.kill();
  await vite.close();
  process.exit(0);
}

let timer = null;
watch(outDir, (_event, file) => {
  if (!file || !file.endsWith('.cjs')) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (!electron || shuttingDown) return;
    console.log(`[dev] ${file} changed — restarting Electron`);
    restarting = true;
    electron.kill();
  }, 400);
});

process.on('SIGINT', () => void shutdown());
startElectron();
