import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { findFirstActiveItem } from '../inventory/items';
import { FARM_JOB_SLOT_ID, PLAYER_ID, REST_BUNK_PRICE, seedDemoWorld } from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';

const WORK_SHIFT_TYPE = `work_shift_${FARM_JOB_SLOT_ID}`;

// Stage 3 exit test (MASTERPLAN.md §Stage 3): "the §14.4 loop runs a full
// season through the interface alone." A calendar season is 30 days
// (Stage 0's decision: 30 days/season × 4 seasons). This scenario proves the
// underlying engine mechanics survive that full season end to end (hiring,
// haggling, shift wages from the company's own ledger, Farming XP, grain
// into real storage, tool wear); a separate browser smoke test (see
// DECISIONS.md's Stage 3 entry) confirms the same calls are correctly wired
// through the actual interface (notice board → jobs screen → farm →
// HUD/log), which a 30-day run isn't practical to drive via real UI clicks.
describe('Stage 3 — First Job scenarios', () => {
  it('applies for the farm job with a haggle attempt and is hired at a wage within the posted band', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'stage3-hire' });
    seedDemoWorld(engine);

    const opening = engine.listJobOpenings().find((j) => j.id === FARM_JOB_SLOT_ID);
    expect(opening).toBeDefined();
    expect(engine.getEmployment(PLAYER_ID)).toBeNull();

    const result = engine.applyForJob(PLAYER_ID, FARM_JOB_SLOT_ID, { haggle: true });
    expect(result.wage).toBeGreaterThanOrEqual(opening!.wageMin);
    expect(result.wage).toBeLessThanOrEqual(opening!.wageMax);

    const employment = engine.getEmployment(PLAYER_ID);
    expect(employment?.jobSlotId).toBe(FARM_JOB_SLOT_ID);
    expect(employment?.wage).toBe(result.wage);

    expect(engine.queryLog('personal', 20).some((e) => e.type === 'job.hired')).toBe(true);
    expect(engine.queryLog('business', 20).some((e) => e.type === 'job.filled')).toBe(true);

    // Already employed — a real invariant, not a silent no-op (matches
    // decrementStock/faucetCoin's "throw on invalid state" precedent).
    expect(() => engine.applyForJob(PLAYER_ID, FARM_JOB_SLOT_ID, { haggle: false })).toThrow();

    engine.dispose();
  });

  it('a green-youth applicant who skips haggling is hired at exactly the posted floor wage', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'stage3-no-haggle' });
    seedDemoWorld(engine);

    const opening = engine.listJobOpenings().find((j) => j.id === FARM_JOB_SLOT_ID)!;
    const result = engine.applyForJob(PLAYER_ID, FARM_JOB_SLOT_ID, { haggle: false });

    expect(result.haggleAttempted).toBe(false);
    expect(result.wage).toBe(opening.wageMin);

    engine.dispose();
  });

  it('a farmhand who works a shift earns the haggled wage from the company ledger, Farming XP, and grain into company storage, wearing the shared hoe', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'stage3-shift' });
    seedDemoWorld(engine);

    const { wage } = engine.applyForJob(PLAYER_ID, FARM_JOB_SLOT_ID, { haggle: false });
    const companyBalanceBefore = engine.getBalance('oster_farm');
    const playerBalanceBefore = engine.getBalance(PLAYER_ID);
    const xpBefore = engine.getSkillXp(PLAYER_ID, 'farming');

    engine.queueAction(PLAYER_ID, WORK_SHIFT_TYPE);
    engine.advanceTicks(361); // the shift's full duration, plus one to resolve

    expect(engine.getBalance(PLAYER_ID)).toBe(playerBalanceBefore + wage);
    expect(engine.getBalance('oster_farm')).toBe(companyBalanceBefore - wage);
    expect(engine.getSkillXp(PLAYER_ID, 'farming')).toBeGreaterThan(xpBefore);

    const grainProduced = engine
      .queryLog('personal', 20)
      .filter((e) => e.type === 'item.produced' && (e.data?.type as string | undefined) === 'grain');
    expect(grainProduced.length).toBeGreaterThan(0);

    const hoe = findFirstActiveItem(engine.db, 'oster_farm', 'hoe');
    expect(hoe).not.toBeNull(); // durable enough to survive a single shift's wear

    // The shift's skill check is a real probabilistic roll (§13.2) — wage,
    // XP, and grain all land regardless of which way it goes (only the
    // grain *quantity* differs, already covered above), so the action's
    // terminal status here is either resolved outcome, not just 'complete'.
    const action = engine.getActorActions(PLAYER_ID).find((a) => a.type === WORK_SHIFT_TYPE);
    expect(['complete', 'failed']).toContain(action?.status);

    engine.dispose();
  });

  it('a scripted farmhand survives a full season (30 days) via the §14.4 loop — hired, working shifts, maintaining needs, all consumption traceable', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'stage3-season' });
    seedDemoWorld(engine);

    engine.applyForJob(PLAYER_ID, FARM_JOB_SLOT_ID, { haggle: true });

    const SIMULATED_TICKS = 30 * MINUTES_PER_DAY;
    let safetyIterations = 0;
    let shiftsWorked = 0;
    const eatenItemIds: string[] = [];

    // Same "cheap current-action polling, no full-history scans" shape as
    // Stage 2's scripted worker (getActorActions() is unbounded — see
    // DECISIONS.md's Stage 2 entry on the O(n²) trap it caused there).
    while (engine.tick < SIMULATED_TICKS) {
      safetyIterations++;
      if (safetyIterations > 20_000) {
        throw new Error('Scripted farmhand loop exceeded its safety iteration cap — likely stuck.');
      }

      const busy = engine.getCurrentAction(PLAYER_ID);
      if (busy?.status === 'in_progress') {
        const remaining = (busy.endsAtTick ?? engine.tick + 1) - engine.tick;
        engine.advanceTicks(Math.max(1, remaining));
        if (busy.type === WORK_SHIFT_TYPE) shiftsWorked++;
        continue;
      }

      const needs = engine.getNeeds(PLAYER_ID)!;
      const balance = engine.getBalance(PLAYER_ID);
      const wornFeet = engine.getWornGear(PLAYER_ID).find((g) => g.slot === 'feet');
      // §5.4's rolled price level means bread/shoes no longer always cost
      // their catalog base price — read the real listing price rather than
      // hardcoding one.
      const breadPrice = engine.getMarketListing('market', 'bread')?.price ?? 2;
      const shoesPrice = engine.getMarketListing('market', 'shoes')?.price ?? 15;

      // A work shift is 360 ticks — far longer than any Stage 2 action
      // (5-90 ticks) — so starting one needs a much bigger safety margin
      // than the short errands below: a need sitting just under the usual
      // <50 threshold when a shift *starts* can decay straight through 0
      // before the shift ends (thirst alone decays 60 over 360 ticks).
      // Below 60, top the need up with a short action; only commit to a
      // shift once all three sit comfortably clear of that decay.
      let queuedType: string;
      if (needs.thirst < 60) {
        queuedType = 'draw_water';
      } else if (needs.hunger < 60 && findFirstActiveItem(engine.db, PLAYER_ID, 'bread')) {
        queuedType = 'eat';
      } else if (needs.hunger < 60 && balance >= breadPrice) {
        queuedType = 'buy_bread';
      } else if (needs.energy < 60 || needs.warmth < 60) {
        // §5.4's rolled starting season can now genuinely be winter — a
        // bunk rest restores warmth as well as energy (demoWorld.ts's
        // rest_bunk), so this is also this script's cold-weather response;
        // it never modeled a separate cloak purchase, and doesn't need to
        // as long as a cheap (3 coin) bunk stays reachable.
        queuedType = balance >= REST_BUNK_PRICE ? 'rest_bunk' : 'rest_rough';
      } else if (!wornFeet && balance >= shoesPrice) {
        queuedType = 'buy_shoes';
      } else if (needs.thirst >= 75 && needs.hunger >= 75 && needs.energy >= 75) {
        queuedType = WORK_SHIFT_TYPE;
      } else {
        // In the 60-75 buffer zone on at least one need — not yet safe to
        // commit to a shift, nothing else urgent enough to act on either.
        // rest_rough is free, short, and tops up energy while we wait.
        queuedType = 'rest_rough';
      }

      const breadAboutToBeEaten =
        queuedType === 'eat' ? findFirstActiveItem(engine.db, PLAYER_ID, 'bread') : null;

      engine.queueAction(PLAYER_ID, queuedType);
      engine.advanceTicks(1);

      if (queuedType === 'eat' && breadAboutToBeEaten) {
        eatenItemIds.push(breadAboutToBeEaten.id);
      }
    }

    const finalNeeds = engine.getNeeds(PLAYER_ID)!;
    expect(finalNeeds.thirst).toBeGreaterThan(0);
    expect(finalNeeds.hunger).toBeGreaterThan(0);
    expect(finalNeeds.energy).toBeGreaterThan(0);

    expect(shiftsWorked).toBeGreaterThan(0);
    expect(engine.getSkillLevel(PLAYER_ID, 'farming')).toBeGreaterThan(0);

    expect(eatenItemIds.length).toBeGreaterThan(0);
    for (const itemId of eatenItemIds) {
      const chain = engine.getProvenanceChain(itemId);
      expect(chain.map((e) => e.eventType)).toEqual(['produced', 'consumed']);
    }

    expect(engine.queryLog('world', 10_000).some((e) => e.type === 'audit.failed')).toBe(false);
    expect(engine.runConservationAudit().passed).toBe(true);

    engine.dispose();
  }, 120_000);
});
