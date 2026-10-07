/* global document, indexedDB, IDBDatabase */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

// Run against a Vite dev server. Install playwright locally, or point
// WYRN_PLAYWRIGHT_MODULE at an existing installation. Uses installed Chrome.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.WYRN_PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});
const url = process.env.WYRN_SMOKE_URL ?? 'http://127.0.0.1:5186';

async function visible(text) {
  await page.getByText(text, { exact: true }).first().waitFor();
}
async function button(name) {
  await page.getByRole('button', { name, exact: true }).click();
}

try {
  await page.goto(url);
  await page.getByRole('button', { name: 'New Game', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Continue', exact: true }).isEnabled(), false);
  await button('New Game');
  for (const skill of ['labor', 'farming', 'woodcutting', 'milling', 'baking', 'trading', 'management']) {
    const select = page.getByLabel(skill, { exact: true });
    assert.equal(await select.isDisabled(), true);
    assert.equal(await select.inputValue(), '0');
    assert.deepEqual(await select.locator('option').allTextContents(), [
      'Level 0',
      'Level 1',
      'Level 2',
      'Level 3',
      'Level 4',
      'Level 5',
    ]);
  }
  await page.getByLabel('First name').fill('Chris');
  await page.getByLabel('Last name').fill('Barnett');
  await page.getByLabel('World seed').fill('named-player-regression');
  await page.getByLabel('Starting season').selectOption('0');
  await button('Begin your life');
  await page.getByRole('heading', { name: 'Chris Barnett', exact: true }).waitFor();
  await button('Skills');
  await visible('Farming');
  assert.equal(await page.locator('.player-table tbody tr').count(), 7);
  await button('Inventory');
  await visible('1.0 / 20 kg carried');
  await button('Equipment');
  await button('Unequip shoes');
  await visible('Empty slot');
  await button('Equip shoes');
  await button('Home');
  await page.getByRole('heading', { name: 'The Barnett Household' }).waitFor();
  await page.getByLabel('Preferred lodging').selectOption('rough');
  await page.getByLabel('Routine coin reserve').fill('25');
  await button('Work / Jobs');
  await page
    .getByRole('button', { name: /Accept posted wage/ })
    .and(page.locator(':enabled'))
    .first()
    .click();
  await page.getByRole('button', { name: 'Quit your job' }).waitFor();
  await button('Skip to morning');
  await button('Character');
  await button('History');
  assert.match(await page.locator('.game-main').innerText(), /Chris|Farmhand|Woodcutter|Miller|Baker/);
  await button('Save');
  await page.getByRole('heading', { name: 'Save & load' }).waitFor();
  await page.getByLabel('Save name').fill('Smoke manual');
  await button('Create manual save');
  await page.getByRole('button', { name: 'Load Smoke manual', exact: true }).waitFor();
  await button('Overwrite');
  await button('Confirm overwrite');
  const downloadPromise = page.waitForEvent('download');
  await button('Export Save');
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), 'wyrnlands-chris-barnett.sqlite');
  const exportPath = await download.path();
  await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: true }).waitFor();
  await button('Continue');
  await page.getByRole('heading', { name: 'Chris Barnett', exact: true }).waitFor();
  await button('Home');
  assert.equal(await page.getByLabel('Preferred lodging').inputValue(), 'rough');
  assert.equal(await page.getByLabel('Routine coin reserve').inputValue(), '25');
  await button('Work / Jobs');
  await page.getByRole('button', { name: 'Quit your job' }).waitFor();
  await button('Save');
  await page.getByRole('heading', { name: 'Save & load' }).waitFor();
  // Delete both slots through the UI, then restore only from the portable file.
  while (await page.getByRole('button', { name: 'Delete', exact: true }).count()) {
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await button('Confirm delete');
    await page.waitForFunction(
      () => !Array.from(document.querySelectorAll('button')).some((b) => b.textContent === 'Confirm delete'),
    );
    await page.waitForFunction(
      () =>
        !document.querySelector('button:disabled') ||
        !Array.from(document.querySelectorAll('button')).some(
          (b) => b.textContent?.startsWith('Load ') && b.disabled,
        ),
    );
  }
  await visible('No local saves yet.');
  await page.locator('input[type="file"]').setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/vnd.sqlite3',
    buffer: readFileSync(exportPath),
  });
  await page.getByRole('button', { name: /Load wyrnlands-chris-barnett/ }).waitFor();
  await page.getByRole('button', { name: /Load wyrnlands-chris-barnett/ }).click();
  await page.getByRole('heading', { name: 'Chris Barnett', exact: true }).waitFor();
  await button('Home');
  assert.equal(await page.getByLabel('Preferred lodging').inputValue(), 'rough');
  await button('Save');
  await page.getByRole('heading', { name: 'Save & load' }).waitFor();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'bad.sqlite',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from('invalid'),
  });
  await visible('This file is not a SQLite game save.');

  // Exercise the real IndexedDB service in an isolated database, including
  // binary round-trip, atomic overwrite, Continue ordering and deletion.
  const storeResult = await page.evaluate(async () => {
    const { SaveStore, selectContinueSave } = await import('/src/persistence/saveStore.ts');
    const store = new SaveStore(indexedDB, 'wyrnlands-smoke-store');
    const metadata = {
      id: 'manual',
      kind: 'manual',
      displayName: 'Test',
      characterName: 'Chris Barnett',
      tick: 1440,
      year: 1,
      season: 'spring',
      day: 2,
      worldSeed: 'smoke',
      createdAt: '2026-10-06T00:00:00.000Z',
      updatedAt: '2026-10-06T00:00:00.000Z',
      gameVersion: '0.1.0',
      saveFormatVersion: 1,
    };
    await store.put({ metadata, bytes: new Uint8Array([0, 1, 255]) });
    const first = await store.get('manual');
    await store.put({
      metadata: { ...metadata, tick: 2880, updatedAt: '2026-10-06T02:00:00.000Z' },
      bytes: new Uint8Array([4, 5]),
    });
    await store.put({
      metadata: { ...metadata, id: 'autosave', kind: 'autosave', updatedAt: '2026-10-06T01:00:00.000Z' },
      bytes: new Uint8Array([8]),
    });
    const second = await store.get('manual');
    const list = await store.list();
    const continued = selectContinueSave(list)?.id;
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = originalTransaction.apply(this, args);
      queueMicrotask(() => tx.abort());
      return tx;
    };
    let failedWrite = false;
    try {
      await store.put({ metadata: { ...metadata, tick: 9999 }, bytes: new Uint8Array([99]) });
    } catch {
      failedWrite = true;
    } finally {
      IDBDatabase.prototype.transaction = originalTransaction;
    }
    const afterAbort = await store.get('manual');
    await store.delete('manual');
    await store.delete('autosave');
    return {
      first: [...first.bytes],
      firstMetadata: first.metadata,
      second: [...second.bytes],
      secondTick: second.metadata.tick,
      count: list.length,
      continued,
      failedWrite,
      afterAbortTick: afterAbort.metadata.tick,
      afterAbortBytes: [...afterAbort.bytes],
      afterDelete: (await store.list()).length,
      missing: await store.get('manual'),
    };
  });
  assert.deepEqual(storeResult.first, [0, 1, 255]);
  assert.equal(storeResult.firstMetadata.characterName, 'Chris Barnett');
  assert.deepEqual(storeResult.second, [4, 5]);
  assert.equal(storeResult.secondTick, 2880);
  assert.equal(storeResult.count, 2);
  assert.equal(storeResult.continued, 'manual');
  assert.equal(storeResult.failedWrite, true);
  assert.equal(storeResult.afterAbortTick, 2880);
  assert.deepEqual(storeResult.afterAbortBytes, [4, 5]);
  assert.equal(storeResult.afterDelete, 0);
  assert.equal(storeResult.missing, null);

  const enterpriseContext = await browser.newContext();
  const enterprise = await enterpriseContext.newPage();
  enterprise.on('pageerror', (error) => errors.push(error.message));
  enterprise.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await enterprise.clock.install();
  const clickEnterprise = (name) => enterprise.getByRole('button', { name, exact: true }).click();
  await enterprise.goto(url);
  await clickEnterprise('New Game');
  await enterprise.getByLabel('First name').fill('Edda');
  await enterprise.getByLabel('Last name').fill('Hale');
  await enterprise.getByLabel('Starting preset').selectOption('custom');
  await enterprise.getByLabel('World seed').fill('named-player-regression');
  await enterprise.getByLabel('Starting season').selectOption('0');
  await enterprise.getByLabel('Starting coin', { exact: true }).fill('2000');
  await enterprise.getByLabel('management', { exact: true }).selectOption('3');
  await enterprise.getByLabel('farming', { exact: true }).selectOption('5');
  // Standard resets displayed levels to zero; switching back retains custom choices.
  await enterprise.getByLabel('Starting preset').selectOption('standard');
  assert.equal(await enterprise.getByLabel('farming', { exact: true }).inputValue(), '0');
  await enterprise.getByLabel('Starting preset').selectOption('custom');
  assert.equal(await enterprise.getByLabel('farming', { exact: true }).inputValue(), '5');
  await clickEnterprise('Begin your life');
  await enterprise.getByRole('heading', { name: 'Edda Hale', exact: true }).waitFor();
  await clickEnterprise('Skills');
  assert.match(
    await enterprise.locator('.player-table tr').filter({ hasText: 'Farming' }).innerText(),
    /Farming\s+5\s+1000\s+Mastered/,
  );
  assert.match(
    await enterprise.locator('.player-table tr').filter({ hasText: 'Management' }).innerText(),
    /Management\s+3\s+600\s+200/,
  );
  await clickEnterprise('Businesses');
  await enterprise.getByLabel('Company name').fill('Hale Timber');
  await enterprise.getByLabel('Total investment (including startup costs)').fill('500');
  await clickEnterprise('Found company');
  await enterprise.getByRole('heading', { name: 'Hale Timber', exact: true }).waitFor();
  await enterprise.getByText('The books', { exact: true }).waitFor();
  assert.equal(await enterprise.getByRole('button', { name: /Inspect/ }).count(), 0);
  await clickEnterprise('Market');
  await enterprise.getByRole('button', { name: /axe/i }).first().click();
  await enterprise.getByRole('button', { name: /^Buy 1/ }).click();
  await clickEnterprise('Skip to morning');
  await clickEnterprise('Character');
  await clickEnterprise('Inventory');
  assert.match(await enterprise.locator('.player-table').innerText(), /Axe/);
  // A virtual minute exercises the real autosave timer without a minute of wall-clock waiting.
  await enterprise.clock.fastForward(60_001);
  await enterprise.waitForFunction(async () => {
    const { SaveStore } = await import('/src/persistence/saveStore.ts');
    return (await new SaveStore().get('autosave'))?.metadata.tick === 1440;
  });
  await clickEnterprise('Home');
  await enterprise.getByLabel('Preferred lodging').selectOption('rough');
  await enterprise.clock.fastForward(60_001);
  await enterprise.waitForFunction(async () => {
    const { SaveStore } = await import('/src/persistence/saveStore.ts');
    const { GameSession } = await import('/src/persistence/gameSession.ts');
    const saved = await new SaveStore().get('autosave');
    const session = await GameSession.load(saved.bytes);
    try {
      return session.api.getPlayerRoutinePreferences().lodging === 'rough';
    } finally {
      session.dispose();
    }
  });
  await enterprise.reload();
  await clickEnterprise('Continue');
  await enterprise.getByRole('heading', { name: 'Edda Hale', exact: true }).waitFor();
  await enterprise.getByRole('button', { name: 'Hale Timber', exact: true }).click();
  await enterprise.getByText('The books', { exact: true }).waitFor();
  await clickEnterprise('Home');
  assert.equal(await enterprise.getByLabel('Preferred lodging').inputValue(), 'rough');
  await enterpriseContext.close();
  assert.deepEqual(errors, []);
  console.log(
    'PASS: title, Standard/Custom characters, all character pages, equipment, household, routine, job, time, manual create/overwrite/delete, reload/Continue, raw export/import, invalid import, real IndexedDB service, player founding/own books, axe purchase, periodic autosave and business reload; no browser errors.',
  );
} finally {
  await browser.close();
}
