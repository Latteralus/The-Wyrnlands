/* global document, requestAnimationFrame, window */
// Measures the running desktop game the way a player experiences it
// (MigrationPlan.md Phase 28): at 1×, 4× and 16×, for each speed —
//   - renderer smoothness: animation-frame gaps and long tasks (>50 ms);
//   - interaction latency: clicking between Settlement tabs;
//   - simulation progress: in-game minutes advanced per real second;
//   - CPU and memory per Electron process (app.getAppMetrics());
// then times a full day skipped at once, and IPC round trips and payloads.
// Drives the UI only, so it measures any architecture the same way.
//
//   node scripts/bench-electron.mjs [--seconds 20] [--packaged] [--sim-backend sqljs]
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { electronEnv } from './electronEnv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secondsIndex = process.argv.indexOf('--seconds');
const seconds = secondsIndex >= 0 ? Number(process.argv[secondsIndex + 1]) : 20;
const packaged = process.argv.includes('--packaged');
const backendIndex = process.argv.indexOf('--sim-backend');
const backendArgs = backendIndex >= 0 ? [`--sim-backend=${process.argv[backendIndex + 1]}`] : [];
const userData = mkdtempSync(path.join(tmpdir(), 'wyrnlands-bench-'));

const app = await electron.launch(
  packaged
    ? {
        executablePath: path.join(root, 'release', 'win-unpacked', 'The Wyrnlands.exe'),
        args: [`--user-data-dir=${userData}`, ...backendArgs],
        env: electronEnv(),
      }
    : { args: [root, `--user-data-dir=${userData}`, ...backendArgs], cwd: root, env: electronEnv() },
);
const page = await app.firstWindow();
const button = (name) => page.getByRole('button', { name, exact: true });

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
// "Year 1 · spring, day 3 · 6:05 AM" → minutes since the start of year 1
async function gameMinutes() {
  const text = await page.locator('.scene-header-calendar').first().innerText();
  const m = /Year (\d+) · (\w+), day (\d+) · (\d+):(\d+) (AM|PM)/.exec(text);
  if (!m) throw new Error(`Unreadable calendar: ${text}`);
  const hour = (Number(m[4]) % 12) + (m[6] === 'PM' ? 12 : 0);
  const days = (Number(m[1]) - 1) * 120 + SEASONS.indexOf(m[2]) * 30 + Number(m[3]) - 1;
  return days * 1440 + hour * 60 + Number(m[5]);
}

const metrics = () => app.evaluate(({ app }) => app.getAppMetrics());

try {
  await button('New Game').waitFor();
  await button('New Game').click();
  await page.getByLabel('First name').fill('Edda');
  await page.getByLabel('Last name').fill('Hale');
  await page.getByLabel('World seed').fill('stage5-scale-stress');
  await page.getByLabel('Starting season').selectOption('0');
  await button('Begin your life').click();
  await page.getByRole('heading', { name: 'Edda Hale', exact: true }).waitFor();
  await button('Settlement').click();

  const results = [];
  for (const speed of [1, 4, 16]) {
    await page.evaluate(() => {
      window.__bench = { gaps: [], longTasks: [], clicks: [], last: performance.now(), running: true };
      const frame = (now) => {
        const b = window.__bench;
        if (!b.running) return;
        b.gaps.push(now - b.last);
        b.last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__bench.longTasks.push(entry.duration);
      });
      observer.observe({ type: 'longtask', buffered: false });
      window.__bench.observer = observer;
      // Event Timing: from each click to the next frame painted after it.
      const events = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (entry.name === 'click') window.__bench.clicks.push(entry.duration);
      });
      events.observe({ type: 'event', durationThreshold: 16, buffered: false });
      window.__bench.events = events;
    });
    const startMinutes = await gameMinutes();
    await metrics(); // resets each process's CPU-usage window
    await button(`${speed}×`).click();
    const started = Date.now();

    // Interaction latency: switch Settlement tabs while the clock runs.
    const latencies = [];
    while (Date.now() - started < seconds * 1000) {
      await page.waitForTimeout(1500);
      for (const [tab, marker] of [
        ['Households', 'Household'],
        ['Locations', 'The Village Well'],
      ]) {
        const t0 = performance.now();
        await page.getByRole('button', { name: tab, exact: true }).click();
        await page.locator('.tabs button.active', { hasText: tab }).waitFor();
        await page.locator('.location-card-name', { hasText: marker }).first().waitFor();
        latencies.push(performance.now() - t0);
      }
    }
    const window_ = await metrics();
    const elapsed = (Date.now() - started) / 1000;
    await button('Pause').click();
    const endMinutes = await gameMinutes();
    const frames = await page.evaluate(() => {
      const b = window.__bench;
      b.running = false;
      b.observer.disconnect();
      b.events.disconnect();
      const clicks = b.clicks.sort((x, y) => x - y);
      const gaps = b.gaps.slice(1).sort((x, y) => x - y);
      const pct = (p) => gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * p))] ?? 0;
      return {
        frames: gaps.length,
        p50FrameMs: Math.round(pct(0.5) * 10) / 10,
        p99FrameMs: Math.round(pct(0.99) * 10) / 10,
        maxFrameMs: Math.round(gaps.at(-1) ?? 0),
        framesOver50ms: gaps.filter((g) => g > 50).length,
        longTasks: b.longTasks.length,
        longTaskMs: Math.round(b.longTasks.reduce((a, d) => a + d, 0)),
        maxLongTaskMs: Math.round(Math.max(0, ...b.longTasks)),
        // Clicks faster than one frame (16 ms) aren't reported at all.
        slowClicks: clicks.length,
        clickToPaintMaxMs: Math.round(clicks.at(-1) ?? 0),
      };
    });
    latencies.sort((a, b) => a - b);
    results.push({
      speed: `${speed}×`,
      seconds: Math.round(elapsed),
      gameMinutesPerSecond: Math.round(((endMinutes - startMinutes) / elapsed) * 10) / 10,
      ...frames,
      tabSwitchMedianMs: Math.round(latencies[Math.floor(latencies.length / 2)] ?? 0),
      tabSwitchMaxMs: Math.round(latencies.at(-1) ?? 0),
      processes: window_.map((m) => ({
        type: m.type,
        name: m.name ?? m.serviceName ?? '',
        cpuPercent: Math.round(m.cpu.percentCPUUsage * 10) / 10,
        workingSetMb: Math.round(m.memory.workingSetSize / 1024),
      })),
    });
  }

  // Skip to morning: up to a whole day of simulation in one request — the
  // heaviest single thing the player can ask for. Time from the click until
  // the new day is on screen, and whether the window kept painting meanwhile.
  const skips = [];
  for (let i = 0; i < 3; i++) {
    const before = await gameMinutes();
    await page.evaluate(() => {
      window.__skip = { gaps: [], last: performance.now(), running: true };
      const frame = (now) => {
        const s = window.__skip;
        if (!s.running) return;
        s.gaps.push(now - s.last);
        s.last = now;
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    const beforeText = await page.locator('.scene-header-calendar').first().innerText();
    const t0 = performance.now();
    await button('Skip to morning').click();
    await page.waitForFunction(
      (initial) => {
        const text = document.querySelector('.scene-header-calendar')?.textContent ?? '';
        return text !== initial && text.includes('12:00 AM');
      },
      beforeText,
      { timeout: 30_000 },
    );
    const latencyMs = Math.round(performance.now() - t0);
    const maxFrameMs = await page.evaluate(() => {
      window.__skip.running = false;
      return Math.round(Math.max(...window.__skip.gaps));
    });
    skips.push({ latencyMs, maxFrameMs, gameMinutes: (await gameMinutes()) - before });
  }
  // IPC cost (MigrationPlan.md Phase 22): renderer → simulation process →
  // renderer round trips, through the real preload bridge.
  const ipc = await page.evaluate(async () => {
    const bridge = globalThis.wyrnlands;
    const time = async (method, params, n) => {
      const samples = [];
      let bytes = 0;
      for (let i = 0; i < n; i++) {
        const t0 = performance.now();
        const result = await bridge.request(method, params);
        samples.push(performance.now() - t0);
        bytes = JSON.stringify(result).length;
      }
      samples.sort((a, b) => a - b);
      return {
        method,
        medianMs: Math.round(samples[Math.floor(n / 2)] * 100) / 100,
        p95Ms: Math.round(samples[Math.floor(n * 0.95)] * 100) / 100,
        payloadKb: Math.round(bytes / 102.4) / 10,
      };
    };
    const session = await bridge.request('session.get');
    const settlement = await bridge.request('view.settlement');
    const company = settlement.companies[0]?.id ?? '';
    return [
      await time('session.get', undefined, 200),
      await time('view.hud', undefined, 100),
      await time('view.character', undefined, 50),
      await time('view.settlement', undefined, 50),
      await time('view.market', { siteId: 'market' }, 50),
      await time('view.business', { companyId: company }, 50),
      await time('view.person', { entityId: session.playerId }, 50),
      await time('view.log', { scope: 'personal', limit: 20 }, 100),
    ];
  });
  console.log(JSON.stringify({ packaged, results, skips, ipc }, null, 2));
} finally {
  await app.close().catch(() => {});
  rmSync(userData, { recursive: true, force: true });
}
