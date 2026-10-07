/* global document */
// Electron smoke test: launches the real desktop app — the unpackaged build
// (dist/ + dist-electron/) or the packaged executable — and plays through
// it with Playwright's Electron driver (playwright-core drives Electron's own
// Chromium; no browser download).
//
//   npm run test:electron                  (after npm run build)
//   npm run test:packaged                  (after npm run package)
//   node scripts/electron-smoke.mjs [--packaged] [--sim-backend sqljs] [--screenshots DIR]
//   node scripts/electron-smoke.mjs --executable PATH   (test an installed app)
//
// Every run uses fresh temporary user-data directories, so real saves are
// never touched. Native file dialogs are answered by stubbing Electron's
// dialog module in the main process. Fails on any renderer console error or
// page exception.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { electronEnv } from './electronEnv.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executableIndex = process.argv.indexOf('--executable');
if (executableIndex >= 0 && !process.argv[executableIndex + 1])
  throw new Error('--executable needs an application path.');
const executablePath =
  executableIndex >= 0
    ? path.resolve(process.argv[executableIndex + 1])
    : path.join(root, 'release', 'win-unpacked', 'The Wyrnlands.exe');
const packaged = process.argv.includes('--packaged') || executableIndex >= 0;
const screenshotIndex = process.argv.indexOf('--screenshots');
const screenshotDir = screenshotIndex >= 0 ? path.resolve(process.argv[screenshotIndex + 1]) : null;
const backendIndex = process.argv.indexOf('--sim-backend');
const backend = backendIndex >= 0 ? process.argv[backendIndex + 1] : 'native';
const appArgs = (userData) => [`--user-data-dir=${userData}`, `--sim-backend=${backend}`];
const scratch = mkdtempSync(path.join(tmpdir(), 'wyrnlands-smoke-'));
const errors = [];
const step = (text) => console.log(`  • ${text}`);

async function launch(userData) {
  const app = await electron.launch(
    packaged
      ? {
          executablePath,
          args: appArgs(userData),
          env: electronEnv(),
        }
      : { args: [root, ...appArgs(userData)], cwd: root, env: electronEnv() },
  );
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  await page.waitForLoadState('domcontentloaded');
  return { app, page };
}

function ui(page) {
  return {
    button: (name) => page.getByRole('button', { name, exact: true }),
    click: (name) => page.getByRole('button', { name, exact: true }).click(),
    heading: (name) => page.getByRole('heading', { name, exact: true }).waitFor(),
    text: (text) => page.getByText(text, { exact: true }).first().waitFor(),
    sceneTime: () => page.locator('.scene-header-calendar').first().innerText(),
    shot: async (name) => {
      if (!screenshotDir) return;
      mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({
        path: path.join(screenshotDir, `${packaged ? 'packaged' : 'dev'}-${name}.png`),
      });
    },
    // Waits for a button to be enabled (e.g. Continue once saves are listed).
    enabled: (name) =>
      page.waitForFunction(
        (label) =>
          Array.from(document.querySelectorAll('button')).some((b) => b.textContent === label && !b.disabled),
        name,
      ),
  };
}

// Answer the next native save/open dialogs with these files (or cancel).
async function answerDialogs(app, { save, open }) {
  await app.evaluate(
    ({ dialog }, files) => {
      dialog.showSaveDialog = async () =>
        files.save ? { canceled: false, filePath: files.save } : { canceled: true, filePath: '' };
      dialog.showOpenDialog = async () =>
        files.open ? { canceled: false, filePaths: [files.open] } : { canceled: true, filePaths: [] };
    },
    { save: save ?? null, open: open ?? null },
  );
}

let session = null;
try {
  console.log(
    `Electron smoke (${packaged ? 'packaged' : 'unpackaged'}, ${backend} SQLite) — scratch ${scratch}`,
  );
  const lifeData = path.join(scratch, 'life');
  session = await launch(lifeData);
  let { app, page } = session;
  let u = ui(page);

  step('window and renderer load; the renderer is sandboxed and sees only the bridge');
  await u.button('New Game').waitFor();
  const boundary = await page.evaluate(async () => {
    let unknownRequest = '';
    try {
      await globalThis.wyrnlands.request('db.exec', { sql: 'DROP TABLE items' });
    } catch (error) {
      unknownRequest = String(error.message);
    }
    return {
      require: typeof globalThis.require,
      process: typeof globalThis.process,
      module: typeof globalThis.module,
      bridge: Object.keys(globalThis.wyrnlands ?? {}).sort(),
      unknownRequest,
    };
  });
  assert.deepEqual(
    { require: boundary.require, process: boundary.process, module: boundary.module },
    { require: 'undefined', process: 'undefined', module: 'undefined' },
  );
  assert.deepEqual(boundary.bridge, [
    'exportSave',
    'host',
    'importSave',
    'onNotification',
    'request',
    'versions',
  ]);
  assert.match(boundary.unknownRequest, /Unknown request/);
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const wp = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: wp.contextIsolation,
      nodeIntegration: wp.nodeIntegration,
      sandbox: wp.sandbox,
      webviewTag: wp.webviewTag,
    };
  });
  assert.deepEqual(prefs, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
  });
  const processes = await app.evaluate(({ app: electronApp }) =>
    electronApp
      .getAppMetrics()
      .map((m) => ({ type: m.type, name: `${m.name ?? ''} ${m.serviceName ?? ''}` })),
  );
  assert.ok(
    processes.some((p) => p.type === 'Utility' && /Wyrnlands Simulation/.test(p.name)),
    `simulation utility process running: ${JSON.stringify(processes)}`,
  );

  step('new game (Standard)');
  assert.equal(await u.button('Continue').isEnabled(), false);
  await u.click('New Game');
  for (const skill of ['labor', 'farming', 'woodcutting', 'milling', 'baking', 'trading', 'management']) {
    const select = page.getByLabel(skill, { exact: true });
    assert.equal(await select.isDisabled(), true);
    assert.equal(await select.inputValue(), '0');
  }
  await page.getByLabel('First name').fill('Chris');
  await page.getByLabel('Last name').fill('Barnett');
  await page.getByLabel('World seed').fill('electron-smoke');
  await page.getByLabel('Starting season').selectOption('0');
  await u.click('Begin your life');
  await u.heading('Chris Barnett');
  await u.shot('character');
  const running = await page.evaluate(() => globalThis.wyrnlands.request('session.get'));
  assert.equal(running.backend, backend);

  step('character pages and equipment');
  await u.click('Skills');
  await u.text('Farming');
  assert.equal(await page.locator('.player-table tbody tr').count(), 7);
  await u.click('Inventory');
  await u.text('1.0 / 20 kg carried');
  await u.click('Equipment');
  await u.click('Unequip shoes');
  await u.text('Empty slot');
  await u.click('Equip shoes');
  await u.button('Unequip shoes').waitFor();

  step('home and routine preferences');
  await u.click('Home');
  await u.heading('The Barnett Household');
  await page.getByLabel('Preferred lodging').selectOption('rough');
  await page.getByLabel('Routine coin reserve').fill('25');
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Routine coin reserve"]')?.value === '25',
  );
  await u.shot('home');

  // NPCs now apply during the day; claim the initial vacancy before advancing
  // the world, rather than assuming it is reserved for the player tomorrow.
  step('take a job');
  await u.click('Work / Jobs');
  await page
    .getByRole('button', { name: /Accept posted wage/ })
    .and(page.locator(':enabled'))
    .first()
    .click();
  await u.button('Quit your job').waitFor();

  step('the clock runs at 16×, pauses, and skips to morning');
  await u.click('Settlement');
  const before = await u.sceneTime();
  await u.click('16×');
  await page.waitForFunction(
    (initial) => document.querySelector('.scene-header-calendar')?.textContent !== initial,
    before,
    { timeout: 15_000 },
  );
  await u.click('Pause');
  await page.waitForFunction(() => document.querySelector('.time-controls .active')?.textContent === 'Pause');
  const paused = await u.sceneTime();
  await page.waitForTimeout(800);
  assert.equal(await u.sceneTime(), paused, 'clock stays put while paused');
  await u.click('Skip to morning');
  await page.waitForFunction(
    () => document.querySelector('.scene-header-calendar')?.textContent?.includes('day 2'),
    null,
    { timeout: 15_000 },
  );
  await u.shot('settlement');

  step('profiles: household, person (Inspect), business, chronicle, market');
  await u.click('Settlement');
  await page.locator('.tabs').getByRole('button', { name: 'Households', exact: true }).click();
  await page.locator('.location-card').first().click();
  await page.locator('.household-members button').first().click();
  await u.text('Work history');
  await page.getByRole('button', { name: /Inspect/ }).click();
  await u.text('Own purse');
  await u.shot('person');
  await u.click('← Back');
  await page.locator('.tabs').getByRole('button', { name: 'Businesses', exact: true }).click();
  await page.locator('.location-card').first().click();
  await u.heading('Business Log');
  await u.shot('business');
  await u.click('Chronicle');
  await u.heading('Chronicle');
  await u.click('Market');
  await page.locator('.scene-header h2').waitFor();
  await u.shot('market');

  step('a reloaded window reconnects to the running game');
  await u.click('Settlement');
  await u.click('16×');
  await page.waitForTimeout(600);
  await page.reload();
  await u.heading('Chris Barnett');
  // Nobody was watching while the page reloaded, so the world paused.
  await page.waitForFunction(() => document.querySelector('.time-controls .active')?.textContent === 'Pause');
  await u.click('Work / Jobs');
  await u.button('Quit your job').waitFor();

  step('manual save, overwrite; the save in play cannot be deleted');
  await u.click('Save');
  await u.heading('Save & load');
  await page.getByLabel('Save name').fill('Smoke manual');
  await u.click('Create manual save');
  await u.button('Load Smoke manual').waitFor();
  await u.click('Overwrite');
  await u.click('Confirm overwrite');
  await u.button('Load Smoke manual').waitFor();
  const inPlay = page.locator('.save-list article', { hasText: 'in play' });
  await inPlay.waitFor();
  assert.equal(await inPlay.getByRole('button', { name: 'Delete', exact: true }).count(), 0);
  await u.shot('saves');

  step('export through the native save dialog');
  const exported = path.join(scratch, 'smoke-export.sqlite');
  await answerDialogs(app, { save: exported });
  await u.click('Export Save');
  await u.text('Exported smoke-export.sqlite.');
  assert.equal(readFileSync(exported).subarray(0, 16).toString('latin1'), 'SQLite format 3\0');

  step('title → Continue resumes the same life with its settings');
  await u.click('Back');
  await u.click('Title');
  await u.enabled('Continue');
  await u.click('Continue');
  await u.heading('Chris Barnett');
  await u.click('Home');
  assert.equal(await page.getByLabel('Preferred lodging').inputValue(), 'rough');
  assert.equal(await page.getByLabel('Routine coin reserve').inputValue(), '25');
  await u.click('Work / Jobs');
  await u.button('Quit your job').waitFor();

  step('delete every save, then restore from the exported file');
  await u.click('Title');
  await u.enabled('Load Game');
  await u.click('Load Game');
  await u.heading('Load game');
  while (await u.button('Delete').count()) {
    await u.button('Delete').first().click();
    await u.click('Confirm delete');
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Confirm delete'),
    );
  }
  await u.text('No saves yet.');
  await answerDialogs(app, { open: exported });
  await u.click('Import Save (.sqlite)');
  await u.text('Imported save added. Select Load to resume it.');
  await u.click('Load smoke-export');
  await u.heading('Chris Barnett');
  await u.click('Home');
  assert.equal(await page.getByLabel('Preferred lodging').inputValue(), 'rough');

  step('a file that is not a save is refused; a cancelled dialog does nothing');
  const junk = path.join(scratch, 'junk.sqlite');
  writeFileSync(junk, 'invalid');
  await u.click('Save');
  await u.heading('Save & load');
  await answerDialogs(app, { open: junk });
  await u.click('Import Save (.sqlite)');
  await u.text('This file is not a SQLite game save.');
  await answerDialogs(app, {});
  await u.click('Import Save (.sqlite)');
  await u.click('Back');

  step('quit and relaunch: the life is still there');
  await app.close();
  assert.ok(existsSync(path.join(lifeData, 'saves', 'autosave', 'world.sqlite')), 'save file on disk');
  session = await launch(lifeData);
  ({ app, page } = session);
  u = ui(page);
  await u.enabled('Continue');
  await u.click('Continue');
  await u.heading('Chris Barnett');
  await u.click('Work / Jobs');
  await u.button('Quit your job').waitFor();
  await app.close();

  step('a killed app keeps every batch it committed (native) or its last autosave (sql.js)');
  const crashData = path.join(scratch, 'crash');
  session = await launch(crashData);
  ({ app, page } = session);
  u = ui(page);
  await u.click('New Game');
  await page.getByLabel('First name').fill('Bram');
  await page.getByLabel('Last name').fill('Cotter');
  await page.getByLabel('World seed').fill('crash-test');
  await u.click('Begin your life');
  await u.heading('Bram Cotter');
  await u.click('16×');
  await page.waitForTimeout(1500);
  const tickBeforeKill = (await page.evaluate(() => globalThis.wyrnlands.request('session.get'))).tick;
  assert.ok(tickBeforeKill > 0);
  app.process().kill(); // no shutdown, no final autosave
  await app.close().catch(() => {});
  session = await launch(crashData);
  ({ app, page } = session);
  u = ui(page);
  await u.enabled('Continue');
  await u.click('Continue');
  await u.heading('Bram Cotter');
  const tickAfterRestart = (await page.evaluate(() => globalThis.wyrnlands.request('session.get'))).tick;
  if (backend === 'native')
    assert.ok(tickAfterRestart >= tickBeforeKill, `${tickAfterRestart} >= ${tickBeforeKill}`);
  await app.close();

  step('custom character, founding a business, buying an axe');
  session = await launch(path.join(scratch, 'enterprise'));
  ({ app, page } = session);
  u = ui(page);
  await u.click('New Game');
  await page.getByLabel('First name').fill('Edda');
  await page.getByLabel('Last name').fill('Hale');
  await page.getByLabel('Starting preset').selectOption('custom');
  await page.getByLabel('World seed').fill('named-player-regression');
  await page.getByLabel('Starting season').selectOption('0');
  await page.getByLabel('Starting coin', { exact: true }).fill('2000');
  await page.getByLabel('management', { exact: true }).selectOption('3');
  await page.getByLabel('farming', { exact: true }).selectOption('5');
  await u.click('Begin your life');
  await u.heading('Edda Hale');
  await u.click('Skills');
  assert.match(
    await page.locator('.player-table tr').filter({ hasText: 'Farming' }).innerText(),
    /Farming\s+5\s+1000\s+Mastered/,
  );
  await u.click('Businesses');
  await page.getByLabel('Company name').fill('Hale Timber');
  await page.getByLabel('Total investment (including startup costs)').fill('500');
  await page.waitForFunction(() => document.querySelector('button.primary-button')?.disabled === false);
  await u.shot('founding');
  await u.click('Found company');
  await u.heading('Hale Timber');
  await u.text('The books');
  assert.equal(await page.getByRole('button', { name: /Inspect/ }).count(), 0);
  await u.click('Market');
  await page.getByRole('button', { name: /axe/i }).first().click();
  await page.getByRole('button', { name: /^Buy 1/ }).click();
  await u.click('Skip to morning');
  await u.click('Character');
  await u.click('Inventory');
  await page.locator('.player-table', { hasText: 'Axe' }).waitFor();
  await u.click('Home');
  await page.getByLabel('Preferred lodging').selectOption('rough');
  await page.waitForTimeout(300);
  await app.close();
  session = await launch(path.join(scratch, 'enterprise'));
  ({ app, page } = session);
  u = ui(page);
  await u.enabled('Continue');
  await u.click('Continue');
  await u.heading('Edda Hale');
  await u.click('Hale Timber');
  await u.text('The books');
  await u.click('Home');
  assert.equal(await page.getByLabel('Preferred lodging').inputValue(), 'rough');

  assert.deepEqual(errors, [], 'no renderer console errors or page exceptions');
  console.log('Electron smoke passed.');
} catch (error) {
  if (errors.length) console.error(`Renderer errors:\n${errors.join('\n')}`);
  try {
    const shot = path.join(tmpdir(), 'wyrnlands-smoke-failure.png');
    await session?.page.screenshot({ path: shot });
    console.error(`Screenshot: ${shot}`);
  } catch {
    // window already gone
  }
  throw error;
} finally {
  await session?.app.close().catch(() => {});
  rmSync(scratch, { recursive: true, force: true });
}
