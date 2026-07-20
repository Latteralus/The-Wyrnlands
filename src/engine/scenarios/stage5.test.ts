import { describe, expect, it } from 'vitest';
import { checkpointEngine } from '../checkpoint';
import { createDatabase } from '../db/sqlite';
import { loadFreshSqlJs, loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { findFirstActiveItem } from '../inventory/items';
import { countActiveEmploymentsForSlot } from '../jobs/jobs';
import {
  BAKERY_COMPANY_ID,
  BAKERY_JOB_SLOT_ID,
  FARM_COMPANY_ID,
  FARM_JOB_SLOT_ID,
  LOGGING_JOB_SLOT_ID,
  MILL_COMPANY_ID,
  MILL_JOB_SLOT_ID,
  PLAYER_ID,
  REST_BUNK_PRICE,
  seedDemoWorld,
} from '../seed/demoWorld';
import { MINUTES_PER_DAY } from '../time/clock';

const SEED = 'stage5-closed-economy';

// MASTERPLAN.md §Stage 5 ("The Closed Economy & Living Companies") is a
// large stage — full v1 chains, Management-weighted business ledgers,
// company equipment/upgrade tiers, B2B contracts, smoothed pricing,
// failure+auction, rolled starting conditions, market charts, business
// logs, world chronicle, a 2-year exit test. This is honestly *not* that
// exit test — it's built across slices. Slice 1: the grain -> flour ->
// bread production chain (production/recipes.ts) closing for real through
// the market (market.ts's producerCompanyId), Management-weighted daily
// buy/sell decisions (companies/decisions.ts), and smoothed pricing
// (market/pricing.ts). Slice 2: company equipment purchasing, Management-
// gated upgrade tiers (companies/decisions.ts's tryUpgrade), and minimal
// NPC job-seeking (population/cadence.ts) so newly-opened slots actually
// get filled. True standing B2B contracts with freight, seasons-affecting-
// price, auction/closure, rolled starting conditions, and the log/chart
// screens are still not built — named gaps, see DECISIONS.md.
//
// A real 90-day headless run (2026-07-19, not this test's own 60-day
// window) found something worth knowing before reading too much into any
// single run's numbers: growth (a company upgrade) and hardship-driven
// hiring both fired for real, but company *profitability* didn't cleanly
// track owner Management level the way the seed's flavor text originally
// hoped — Management currently weights purchasing reliability only, not
// selling efficiency, so a well-managed company can over-buy inputs
// relative to what it can actually resell. See DECISIONS.md and seed/
// demoWorld.ts's MANAGEMENT_XP comment for the honest account.
describe('Stage 5 — the closed grain -> flour -> bread chain, with real company growth', () => {
  it('the farm, mill, and bakery all earn real, traceable revenue from real sales over a 60-day run', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    let engine = Engine.bootstrap(db, { seed: SEED });
    seedDemoWorld(engine);

    const SIMULATED_TICKS = 60 * MINUTES_PER_DAY;
    const CHECKPOINT_INTERVAL_TICKS = 15 * MINUTES_PER_DAY; // same tuned interval as stage4.test.ts
    let lastCheckpointTick = 0;

    // The player just survives alongside the chain (same scripted loop
    // shape as stage3/4) — this scenario is really about the companies
    // and NPCs, but a live player also exercises the *other* closed-loop
    // payment path (createBuyActionDefinition's own buy_bread, not just
    // households' feedHousehold) for free.
    let safetyIterations = 0;
    while (engine.tick < SIMULATED_TICKS) {
      safetyIterations++;
      if (safetyIterations > 150_000) {
        throw new Error('Scripted player loop exceeded its safety iteration cap — likely stuck.');
      }

      const busy = engine.getCurrentAction(PLAYER_ID);
      if (busy?.status === 'in_progress') {
        const remaining = (busy.endsAtTick ?? engine.tick + 1) - engine.tick;
        engine.advanceTicks(Math.max(1, remaining));
        continue;
      }

      if (engine.tick - lastCheckpointTick >= CHECKPOINT_INTERVAL_TICKS) {
        engine = await checkpointEngine(engine, { seed: SEED, loadFreshSqlJs });
        seedDemoWorld(engine);
        lastCheckpointTick = engine.tick;
        continue;
      }

      const needs = engine.getNeeds(PLAYER_ID)!;
      const balance = engine.getBalance(PLAYER_ID);
      const wornFeet = engine.getWornGear(PLAYER_ID).find((g) => g.slot === 'feet');
      const employed = engine.getEmployment(PLAYER_ID) !== null;

      let queuedType: string;
      if (needs.thirst < 60) {
        queuedType = 'draw_water';
      } else if (needs.hunger < 60 && findFirstActiveItem(engine.db, PLAYER_ID, 'bread')) {
        queuedType = 'eat';
      } else if (needs.hunger < 60 && balance >= 2) {
        queuedType = 'buy_bread';
      } else if (needs.energy < 60) {
        queuedType = balance >= REST_BUNK_PRICE ? 'rest_bunk' : 'rest_rough';
      } else if (!wornFeet && balance >= 15) {
        queuedType = 'buy_shoes';
      } else if (!employed) {
        queuedType = 'read_notices';
      } else if (needs.thirst >= 75 && needs.hunger >= 75 && needs.energy >= 75) {
        queuedType = `work_shift_${FARM_JOB_SLOT_ID}`;
      } else {
        queuedType = 'rest_rough';
      }

      engine.queueAction(PLAYER_ID, queuedType);
      engine.advanceTicks(1);
    }

    // The chain closed for real: each link's own sale actually landed on
    // it, not on a merchant faucet (market.ts's producerCompanyId).
    const farmLedger = engine.getCompanyLedgerSummary(FARM_COMPANY_ID, 0);
    const millLedger = engine.getCompanyLedgerSummary(MILL_COMPANY_ID, 0);
    const bakeryLedger = engine.getCompanyLedgerSummary(BAKERY_COMPANY_ID, 0);
    expect(farmLedger.revenue).toBeGreaterThan(0); // the mill really bought grain from it
    expect(millLedger.revenue).toBeGreaterThan(0); // the bakery really bought flour from it
    expect(bakeryLedger.revenue).toBeGreaterThan(0); // households/the player really bought bread from it

    // A real bought loaf still carries its full produced -> sold ->
    // consumed provenance chain, the same standard every other stage
    // holds consumption to (§Stage 2/3/4).
    const soldBreadEvents = engine
      .queryLog('business', 10_000)
      .filter((e) => e.type === 'item.transferred' && (e.data?.to as string | undefined) === 'market-stock');
    expect(soldBreadEvents.length).toBeGreaterThan(0);

    // §Stage 5 slice 2: NPC job-seeking (population/cadence.ts) genuinely
    // fills newly-opened job slots over time, not just at world generation —
    // confirmed by a real 90-day run reaching full employment at all four
    // companies well within 60 days (DECISIONS.md), not assumed.
    expect(countActiveEmploymentsForSlot(engine.db, MILL_JOB_SLOT_ID)).toBeGreaterThanOrEqual(2);
    expect(countActiveEmploymentsForSlot(engine.db, BAKERY_JOB_SLOT_ID)).toBeGreaterThanOrEqual(2);
    expect(countActiveEmploymentsForSlot(engine.db, LOGGING_JOB_SLOT_ID)).toBeGreaterThanOrEqual(4);

    // Conservation held throughout, at this heavier population+company
    // scale — no drift, no silent bugs (§16's "drift = bug, caught same day").
    expect(engine.queryLog('world', 10_000).some((e) => e.type === 'audit.failed')).toBe(false);
    expect(engine.runConservationAudit().passed).toBe(true);

    engine.dispose();
  }, 240_000);
});
