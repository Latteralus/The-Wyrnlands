import { describe, expect, it } from 'vitest';
import { createDatabase, queryRow, queryRows } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { countActiveItemsOfType } from '../inventory/items';
import { quitJob } from '../jobs/jobs';
import { SHIFT_XP, TOOL_WEAR_PER_SHIFT } from '../jobs/shifts';
import { canonicalState } from '../perf/benchmark';
import { activityOffset } from './activities';
import { applyHouseholdMigrationWeeklyCadence } from './cadence';

async function village(skill = 'farming', workers = 1) {
  const SQL = await loadSqlJs();
  const e = Engine.bootstrap(createDatabase(SQL), { seed: 'timed-settlement' });
  for (const [id, x] of [
    ['home', 0],
    ['market', 1],
    ['well', -1],
    ['work', 3],
  ] as const) {
    e.createSite({ id, name: id, kind: id === 'work' ? 'farm' : id, x, y: 0 });
  }
  e.createHousehold({ id: 'family', name: 'Family', homeSiteId: 'home' });
  e.faucetCoin('family', 400, 'Savings');
  e.createCompany({ id: 'firm', name: 'Firm', kind: 'farm', siteId: 'work' });
  e.faucetCoin('firm', 1000, 'Capital');
  e.createJobSlot({
    id: 'job',
    companyId: 'firm',
    title: 'Worker',
    skill,
    wageMin: 20,
    wageMax: 20,
    shiftDurationTicks: 360,
    capacity: workers,
    toolGoodType: 'hoe',
  });
  e.produceItem({ id: 'hoe', type: 'hoe', containerId: 'firm', durability: 100 });
  for (let i = 0; i < workers; i++) {
    const id = `worker-${i}`;
    e.createEntity(id, id);
    e.ensureNeeds(id);
    e.addHouseholdMember('family', id);
    e.applyForJob(id, 'job', { haggle: false, scope: 'business' });
  }
  for (let i = 0; i < workers * 4; i++)
    e.produceItem({ id: `bread-${i}`, type: 'bread', containerId: 'family' });
  for (let i = 0; i < workers * 24; i++)
    e.produceItem({ id: `water-${i}`, type: 'water', containerId: 'family' });
  e.seedMarketListing('market', 'bread', 12, 200);
  return { e, SQL };
}

function until(e: Engine, predicate: () => boolean, limit = 1440) {
  for (let i = 0; i < limit && !predicate(); i++) e.advanceTicks(1);
  expect(predicate()).toBe(true);
}

describe('scheduled active settlement', () => {
  it('commutes to actual work, resolves once at its end, then delivers stock over time', async () => {
    const { e } = await village();
    e.advanceTicks(1);
    expect(e.listPresentEntities('home').some((p) => p.entityId === 'worker-0')).toBe(true);
    until(e, () => e.getCurrentAction('worker-0')?.type === 'settlement:travel');
    expect(e.listPresentEntities('home')).toHaveLength(0);
    expect(e.listPresentEntities('work')).toHaveLength(0);
    until(e, () => e.getCurrentAction('worker-0')?.type === 'settlement:work:job');
    const shift = e.getCurrentAction('worker-0')!;
    expect(shift.startedAtTick).toBe(420 + activityOffset('worker-0', 120));
    expect(shift.endsAtTick! - shift.startedAtTick!).toBe(360);
    expect(e.listPresentEntities('work')[0]?.activity).toBe('Working at Firm');
    const purse = e.getBalance('family');
    e.advanceTicks(shift.endsAtTick! - e.tick - 1);
    expect(e.getBalance('family')).toBe(purse);
    expect(countActiveItemsOfType(e.db, 'firm', 'grain')).toBe(0);
    e.advanceTicks(1);
    expect(e.getBalance('family')).toBe(purse + 20);
    expect(e.getSkillXp('worker-0', 'farming')).toBe(SHIFT_XP);
    expect(queryRow(e.db, "SELECT durability FROM items WHERE id = 'hoe'")?.[0]).toBe(
      100 - TOOL_WEAR_PER_SHIFT,
    );
    until(e, () => e.getCurrentAction('firm')?.type === 'settlement:delivery');
    expect(countActiveItemsOfType(e.db, 'freight:firm', 'grain')).toBeGreaterThan(0);
    expect(e.getMarketListing('market', 'grain')).toBeNull();
    const arrival = e.getCurrentAction('firm')!.endsAtTick!;
    e.advanceTicks(arrival - e.tick);
    expect(e.getMarketListing('market', 'grain')?.quantity).toBeGreaterThan(0);
    e.advanceTicks(1440 - e.tick);
    expect(e.getCompanyLedgerSummary('firm', 0).wages).toBe(20);
    expect(e.runConservationAudit().passed).toBe(true);
    e.dispose();
  });

  it('reserves production inputs exclusively and releases them on dismissal without wages or XP', async () => {
    const { e } = await village('milling', 2);
    for (let i = 0; i < 50; i++) e.produceItem({ id: `grain-${i}`, type: 'grain', containerId: 'firm' });
    until(
      e,
      () =>
        e.getCurrentAction('worker-0')?.type === 'settlement:work:job' &&
        e.getCurrentAction('worker-1')?.type === 'settlement:work:job',
    );
    const a = e.getCurrentAction('worker-0')!;
    const b = e.getCurrentAction('worker-1')!;
    expect(countActiveItemsOfType(e.db, `work-input:${a.id}`, 'grain')).toBe(25);
    expect(countActiveItemsOfType(e.db, `work-input:${b.id}`, 'grain')).toBe(25);
    expect(countActiveItemsOfType(e.db, 'firm', 'grain')).toBe(0);
    quitJob(e.db, e.bus, 'worker-0', e.tick, { scope: 'settlement' });
    expect(countActiveItemsOfType(e.db, `work-input:${a.id}`, 'grain')).toBe(0);
    expect(countActiveItemsOfType(e.db, 'firm', 'grain')).toBe(25);
    expect(e.getSkillXp('worker-0', 'milling')).toBe(0);
    expect(e.getCompanyLedgerSummary('firm', 0).wages).toBe(0);
    expect(e.getCurrentAction('worker-0')?.type).not.toBe('settlement:work:job');
    expect(e.runConservationAudit().passed).toBe(true);
    e.dispose();
  });

  it('keeps groceries out of the pantry until the shopper arrives home', async () => {
    const { e } = await village();
    e.db.run("UPDATE items SET container_id = 'elsewhere' WHERE container_id = 'family' AND type = 'bread'");
    until(e, () => e.getCurrentAction('worker-0')?.type === 'settlement:shopping');
    const end = e.getCurrentAction('worker-0')!.endsAtTick!;
    e.advanceTicks(end - e.tick);
    expect(countActiveItemsOfType(e.db, 'family', 'bread')).toBe(0);
    expect(countActiveItemsOfType(e.db, 'errand:worker-0', 'bread')).toBe(4);
    expect(e.getCurrentAction('worker-0')?.type).toBe('settlement:travel');
    until(e, () => e.getCurrentAction('worker-0')?.type === 'settlement:unload');
    expect(e.listPresentEntities('home')[0]?.entityId).toBe('worker-0');
    until(e, () => countActiveItemsOfType(e.db, 'family', 'bread') > 0);
    expect(countActiveItemsOfType(e.db, 'errand:worker-0', 'bread')).toBe(0);
    expect(e.runConservationAudit().passed).toBe(true);
    e.dispose();
  });

  it('round-trips mid-shift and has bounded current action state', async () => {
    const { e, SQL } = await village('milling');
    for (let i = 0; i < 40; i++) e.produceItem({ id: `grain-${i}`, type: 'grain', containerId: 'firm' });
    until(e, () => e.getCurrentAction('worker-0')?.type === 'settlement:work:job');
    const restored = Engine.bootstrap(createDatabase(SQL, e.export()), { seed: 'timed-settlement' });
    expect(canonicalState(restored)).toBe(canonicalState(e));
    e.advanceTicks(3000);
    for (let i = 0; i < 3000; i += 80) restored.advanceTicks(Math.min(80, 3000 - i));
    expect(canonicalState(restored)).toBe(canonicalState(e));
    expect(
      queryRows(
        e.db,
        "SELECT id FROM actions WHERE transient = 1 AND status NOT IN ('queued', 'in_progress')",
      ),
    ).toHaveLength(0);
    expect(
      Number(queryRow(e.db, 'SELECT COUNT(*) FROM actions WHERE transient = 1')?.[0]),
    ).toBeLessThanOrEqual(4);
    expect(
      queryRows(e.db, "SELECT id FROM event_log WHERE actor_id = 'worker-0' AND type LIKE 'action.%'"),
    ).toHaveLength(0);
    expect(e.runConservationAudit().passed).toBe(true);
    restored.dispose();
    e.dispose();
  });

  it('round-trips goods in transit and returns freight before a business liquidation', async () => {
    const { e, SQL } = await village();
    until(e, () => e.getCurrentAction('firm')?.type === 'settlement:delivery');
    const restored = Engine.bootstrap(createDatabase(SQL, e.export()), { seed: 'timed-settlement' });
    const arrival = e.getCurrentAction('firm')!.endsAtTick!;
    e.advanceTicks(arrival - e.tick);
    restored.advanceTicks(arrival - restored.tick);
    expect(canonicalState(restored)).toBe(canonicalState(e));
    restored.dispose();

    until(e, () => e.getCurrentAction('firm')?.type === 'settlement:delivery', 3 * 1440);
    const freight = countActiveItemsOfType(e.db, 'freight:firm', 'grain');
    expect(freight).toBeGreaterThan(0);
    e.shutDownCompany('firm', 'The firm closes.', 'wound_down');
    expect(countActiveItemsOfType(e.db, 'freight:firm', 'grain')).toBe(0);
    expect(e.getCurrentAction('firm')).toBeNull();
    expect(e.getEmployment('worker-0')).toBeNull();
    expect(e.runConservationAudit().passed).toBe(true);
    e.dispose();
  });

  it('clears continuous-insolvency time when an intraday sale replenishes cash', async () => {
    const { e } = await village();
    e.sinkCoin('firm', 1000, 'A cash crunch.');
    expect(e.getCompany('firm')?.insolventSinceTick).toBe(0);
    e.advanceTicks(100);
    e.transferCoin('family', 'firm', 12, 'A sale.');
    expect(e.getCompany('firm')?.insolventSinceTick).toBeNull();
    e.sinkCoin('firm', 12, 'Materials.');
    expect(e.getCompany('firm')?.insolventSinceTick).toBe(100);
    e.dispose();
  });

  it('cancels a departing household shopper and accounts for goods carried away', async () => {
    const { e } = await village();
    e.db.run("UPDATE items SET container_id = 'elsewhere' WHERE container_id = 'family' AND type = 'bread'");
    until(e, () => e.getCurrentAction('worker-0')?.type === 'settlement:shopping');
    e.advanceTicks(e.getCurrentAction('worker-0')!.endsAtTick! - e.tick);
    expect(countActiveItemsOfType(e.db, 'errand:worker-0', 'bread')).toBeGreaterThan(0);
    e.db.run("UPDATE households SET hunger_days = 45 WHERE id = 'family'");
    applyHouseholdMigrationWeeklyCadence(e.db, e.bus, e.tick, () => 1);
    expect(e.getHousehold('family')?.departedAtTick).toBe(e.tick);
    expect(countActiveItemsOfType(e.db, 'errand:worker-0', 'bread')).toBe(0);
    expect(e.getCurrentAction('worker-0')).toBeNull();
    expect(e.listPresentEntities('home')).toHaveLength(0);
    expect(e.runConservationAudit().passed).toBe(true);
    e.advanceTicks(1440);
    expect(e.getCurrentAction('worker-0')).toBeNull();
    e.dispose();
  });

  it('spends time applying and rechecks a vacancy taken during the application', async () => {
    const { e } = await village();
    e.quitJob('worker-0');
    until(e, () => e.getCurrentAction('worker-0')?.type === 'settlement:seek_work');
    const application = e.getCurrentAction('worker-0')!;
    expect(application.endsAtTick! - application.startedAtTick!).toBe(30);
    expect(e.getEmployment('worker-0')).toBeNull();
    e.createEntity('competitor', 'Another applicant');
    e.applyForJob('competitor', 'job', { haggle: false });
    expect(e.getEmployment('competitor')?.jobSlotId).toBe('job');
    e.advanceTicks(application.endsAtTick! - e.tick);
    expect(e.getEmployment('worker-0')).toBeNull();
    expect(e.countActiveEmploymentsForSlot('job')).toBe(1);
    expect(e.runConservationAudit().passed).toBe(true);
    e.dispose();
  });
});
