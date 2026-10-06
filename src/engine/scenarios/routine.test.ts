import { describe, expect, it } from 'vitest';
import { createDatabase, queryRows } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import {
  BAKERY_COMPANY_ID,
  FARM_JOB_SLOT_ID,
  MILL_COMPANY_ID,
  PLAYER_ID,
  seedDemoWorld,
} from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';

// The player's daily routine (Engine.setAutonomous + seed/demoWorld.ts's
// playerRoutine), and what the logs read like as a result.

const DAY = MINUTES_PER_DAY;

async function autonomousPlayer(seed: string) {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  seedDemoWorld(engine);
  engine.setAutonomous(PLAYER_ID, true);
  // A farmhand with a week's bread in their pack (they eat two or three loaves a day).
  const farmhands = engine.listJobOpenings().find((s) => s.id === FARM_JOB_SLOT_ID)!;
  engine.db.run('UPDATE job_slots SET capacity = capacity + 1 WHERE id = ?', [farmhands.id]);
  engine.applyForJob(PLAYER_ID, FARM_JOB_SLOT_ID, { haggle: false });
  for (let i = 0; i < 20; i++)
    engine.produceItem({ id: `pack-bread-${i}`, type: 'bread', containerId: PLAYER_ID });
  return engine;
}

describe('the daily routine', () => {
  it('works the shift on workdays, eats from the pack, sleeps the night — without being told, and without collapsing', async () => {
    const engine = await autonomousPlayer('routine-life');
    const coinBefore = engine.getBalance(PLAYER_ID);
    engine.advanceTicks(5 * DAY);

    const actions = queryRows(
      engine.db,
      "SELECT type, status FROM actions WHERE actor_id = ? AND status IN ('complete', 'failed') ORDER BY id",
      [PLAYER_ID],
    ).map((r) => String(r[0]));
    const shifts = actions.filter((t) => t === `work_shift_${FARM_JOB_SLOT_ID}`).length;
    // Five days, at most one shift a day, and the seventh day of the week is rest.
    expect(shifts).toBeGreaterThanOrEqual(3);
    expect(shifts).toBeLessThanOrEqual(5);
    expect(actions).toContain('eat');
    expect(actions.some((t) => t === 'sleep_bunk' || t === 'sleep_rough')).toBe(true);
    expect(engine.getBalance(PLAYER_ID)).not.toBe(coinBefore); // paid for shifts (and maybe a bunk)

    const log = engine.queryLog('personal', 500);
    expect(log.some((e) => e.type === 'need.collapsed')).toBe(false);
    expect(log.some((e) => /You head to Oster Farm for your shift/.test(e.message))).toBe(true);
    expect(log.some((e) => /You finish your shift at Oster Farm/.test(e.message))).toBe(true);
    expect(log.some((e) => /You sit down and eat/.test(e.message))).toBe(true);
    engine.dispose();
  });

  it('starting with an empty pack, keeps itself in water and bread — fetching pails, buying a few days of bread ahead', async () => {
    const engine = await autonomousPlayer('routine-provisions');
    for (const row of queryRows(
      engine.db,
      "SELECT id FROM items WHERE container_id = ? AND type = 'bread' AND status = 'active'",
      [PLAYER_ID],
    ))
      engine.destroyItem(String(row[0]), 'consumed');
    engine.advanceTicks(6 * DAY);

    const log = engine.queryLog('personal', 1000);
    expect(log.some((e) => e.type === 'need.collapsed')).toBe(false);
    const purchase = log.find((e) => e.type === 'market.purchase');
    expect(purchase?.message).toMatch(
      /^You buy (a loaf|\d+ loaves) of bread at the market stall for \d+ coin \(\d+ each\) to keep in your pack — /,
    );
    expect(log.some((e) => /You fill \d+ pails at the well/.test(e.message))).toBe(true);
    const pails = queryRows(
      engine.db,
      "SELECT COUNT(*) FROM provenance_events JOIN items ON items.id = provenance_events.item_id WHERE items.type = 'water' AND event_type = 'consumed' AND provenance_events.actor_id = ?",
      [PLAYER_ID],
    )[0]?.[0];
    expect(Number(pails)).toBeGreaterThan(6); // drank from the pack, day after day
    engine.dispose();
  });

  it('does nothing on its own for a character who is not autonomous', async () => {
    const engine = await autonomousPlayer('routine-off');
    engine.setAutonomous(PLAYER_ID, false);
    engine.advanceTicks(DAY);
    // Left alone they'll collapse from thirst sooner or later (a recovery,
    // not a choice) — but nothing was chosen for them.
    const chosen = queryRows(
      engine.db,
      "SELECT COUNT(*) FROM actions WHERE actor_id = ? AND type != 'collapse_recovery'",
      [PLAYER_ID],
    )[0]?.[0];
    expect(Number(chosen)).toBe(0);
    engine.dispose();
  });
});

describe('the logs read as a story', () => {
  it('the personal log has no bookkeeping noise or internal names', async () => {
    const engine = await autonomousPlayer('routine-log');
    engine.advanceTicks(3 * DAY);
    const log = engine.queryLog('personal', 1000);
    expect(log.length).toBeGreaterThan(0);
    for (const event of log) {
      expect(event.type).not.toMatch(/^(need\.restored|item\.(produced|transferred|consumed)|coin\.)/);
      expect(event.message).not.toMatch(/_|\bplayer\b|began /);
    }
    engine.dispose();
  });

  it('business logs give one line per transaction: who, how many, the price each and in all', async () => {
    const engine = await autonomousPlayer('routine-business-log');
    engine.advanceTicks(4 * DAY);
    const bakery = engine.queryActorLog(BAKERY_COMPANY_ID, 500);
    const mill = engine.queryActorLog(MILL_COMPANY_ID, 500);

    // Every line is a sentence about the business, not a per-item record.
    for (const event of [...bakery, ...mill]) expect(event.message).not.toBe('Sold to the market.');
    const sold = bakery.filter((e) => e.type === 'business.sold');
    expect(sold.length).toBeGreaterThan(0);
    expect(sold[0]?.message).toMatch(
      /^Sells \d+ bread to .+ at the market stall: \d+ coin each, \d+ coin in all\.$/,
    );
    const bought = [...bakery, ...mill].filter((e) => e.type === 'business.bought');
    expect(bought.length).toBeGreaterThan(0);
    expect(bought.every((e) => /\d+ coin each/.test(e.message) && /in all/.test(e.message))).toBe(true);
    expect(bakery.some((e) => e.type === 'business.workday' && /hands? works? a shift/.test(e.message))).toBe(
      true,
    );
    // Hires are named.
    const hires = queryRows(engine.db, "SELECT message FROM event_log WHERE type = 'job.filled' LIMIT 5").map(
      (r) => String(r[0]),
    );
    expect(hires.length).toBeGreaterThan(0);
    for (const message of hires) expect(message).not.toMatch(/hires a new/);
    engine.dispose();
  });
});
