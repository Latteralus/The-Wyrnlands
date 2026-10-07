/* global document */
// Times the engine running *inside a Chromium renderer* — how the game ran
// before the desktop migration moved the simulation into its own process
// (MigrationPlan.md Phase 28's "browser + sql.js" and "Electron renderer +
// sql.js" rows). Serves the engine sources with the Vite dev server and runs
// src/engine/perf/benchmark.ts in the page.
//
//   node scripts/bench-renderer.mjs [--host electron|chrome] [--days 1,30,365] [--seed X]
//
// --host chrome uses the locally installed Google Chrome (playwright-core
// channel 'chrome'). Prints JSON.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, chromium } from 'playwright-core';
import { createServer } from 'vite';
import { electronEnv } from './electronEnv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const host = arg('host', 'electron');
const seed = arg('seed', 'stage5-scale-stress');
const sampleDays = arg('days', '1,30,365').split(',').map(Number);

const vite = await createServer({ root, logLevel: 'warn', server: { host: '127.0.0.1', port: 5199 } });
await vite.listen();
const url = vite.resolvedUrls.local[0];

let app = null;
let browser = null;
let page;
if (host === 'electron') {
  app = await electron.launch({
    args: [root],
    cwd: root,
    env: electronEnv({ WYRNLANDS_DEV_SERVER_URL: url }),
  });
  page = await app.firstWindow();
} else {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage();
  await page.goto(url);
}
await page.waitForFunction(() => document.querySelector('button') !== null);

const running = page.evaluate(
  async ({ seed, sampleDays }) => {
    const { loadSqlJs } = await import('/src/engine/db/sqlite.browser.ts');
    const { createDatabase } = await import('/src/engine/db/sqlite.ts');
    const bench = await import('/src/engine/perf/benchmark.ts');
    const SQL = await loadSqlJs();
    const engine = bench.createBenchmarkGame(createDatabase(SQL), seed);
    const samples = bench.runBenchmark(engine, { sampleDays, player: true, now: () => performance.now() });
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(bench.canonicalState(engine)),
    );
    const fingerprint = [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 16);
    engine.dispose();
    return {
      samples,
      fingerprint,
      jsHeapMb: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1048576),
    };
  },
  { seed, sampleDays },
);

// Electron only: peak working set per process type while the engine runs
// (polled from the main process, which stays free while the page computes).
const peakMb = {};
let done = false;
void running.finally(() => (done = true));
while (app && !done) {
  for (const m of await app.evaluate(({ app }) => app.getAppMetrics())) {
    peakMb[m.type] = Math.max(peakMb[m.type] ?? 0, Math.round(m.memory.workingSetSize / 1024));
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
const result = await running;
if (app) result.peakWorkingSetMb = peakMb;
console.log(JSON.stringify({ host, seed, ...result }, null, 2));

await app?.close();
await browser?.close();
await vite.close();
