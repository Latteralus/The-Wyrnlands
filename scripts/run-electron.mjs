// npm run electron: start the built desktop app (dist/ + dist-electron/).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { electronEnv } from './electronEnv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(import.meta.url)('electron');
const child = spawn(electronPath, [root, ...process.argv.slice(2)], { stdio: 'inherit', env: electronEnv() });
child.on('exit', (code) => process.exit(code ?? 0));
