import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { countActiveItemsOfType } from '../inventory/items';
import { applyMerchantTrade } from '../market/merchant';
import { BAKING_SKILL, FARMING_SKILL, MANAGEMENT_SKILL, MILLING_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { applyCompanyDailyCadence } from './decisions';
import { TRADE_DISCOUNT } from './trade';

// Business-to-business trade (companies/trade.ts) and the input floor every
// owner keeps (companies/decisions.ts's restockInputs).

const DAY = MINUTES_PER_DAY;

async function newEngine(seed: string) {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  return engine;
}

// A one-hand business of the given trade, its owner the hand.
function addBusiness(engine: Engine, id: string, skill: string, managementXp: number, cash: number) {
  engine.createSite({ id: `${id}-site`, name: id, kind: id, x: 1, y: 1 });
  engine.createCompany({ id, name: id, kind: id, siteId: `${id}-site` });
  engine.createJobSlot({
    id: `${id}-job`,
    companyId: id,
    title: 'Hand',
    skill,
    wageMin: 20,
    wageMax: 30,
    shiftDurationTicks: 360,
    capacity: 1,
  });
  engine.createEntity(`${id}-owner`, `${id} owner`);
  engine.ensureSkill(`${id}-owner`, MANAGEMENT_SKILL);
  if (managementXp > 0) engine.addSkillXp(`${id}-owner`, MANAGEMENT_SKILL, managementXp);
  engine.setCompanyOwner(id, `${id}-owner`);
  engine.applyForJob(`${id}-owner`, `${id}-job`, { haggle: false });
  engine.faucetCoin(id, cash, 'capital');
}

describe('business-to-business trade', () => {
  it("a mill buys the farm's fresh harvest straight from the farm, under the stall's price, before it ever reaches market", async () => {
    const engine = await newEngine('trade-direct');
    engine.seedMarketListing('market', 'grain', 12, 40);
    addBusiness(engine, 'farm', FARMING_SKILL, 650, 1000);
    addBusiness(engine, 'mill', MILLING_SKILL, 650, 1000);
    for (let i = 0; i < 60; i++)
      engine.produceItem({ id: `harvest-${i}`, type: 'grain', containerId: 'farm' });

    applyCompanyDailyCadence(engine.db, engine.bus, 3 * DAY);

    const price = Math.round(12 * (1 - TRADE_DISCOUNT));
    const bought = countActiveItemsOfType(engine.db, 'mill', 'grain');
    expect(bought).toBeGreaterThan(0);
    expect(engine.getBalance('mill')).toBe(1000 - bought * price);
    expect(engine.getCompanyLedgerSummary('farm', 0).revenue).toBe(bought * price);
    // The farm's unsold remainder went to market as usual.
    expect(countActiveItemsOfType(engine.db, 'farm', 'grain')).toBe(0);
    expect(engine.getMarketListing('market', 'grain')?.quantity).toBe(40 + 60 - bought);
    // Provenance shows the grain going farm → mill.
    const sold = engine.getProvenanceChain('harvest-0');
    expect(sold.map((e) => [e.eventType, e.toContainerId])).toEqual([
      ['produced', 'farm'],
      ['transferred', 'mill'],
    ]);
    expect(engine.queryActorLog('farm').some((e) => e.type === 'business.direct_sale')).toBe(true);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('even a Management-0 owner never leaves hands idle: a day of input every day, its bigger restock only on its habit day', async () => {
    const engine = await newEngine('trade-floor');
    engine.seedMarketListing('market', 'flour', 16, 200);
    addBusiness(engine, 'bakery', BAKING_SKILL, 0, 2000);
    // One baker processes 24 sacks a shift at full labor.
    applyCompanyDailyCadence(engine.db, engine.bus, 1 * DAY);
    expect(countActiveItemsOfType(engine.db, 'bakery', 'flour')).toBe(24);
    engine.dispose();
  });

  it('a business needing an input nobody sells here orders it — and the merchant brings it', async () => {
    const engine = await newEngine('trade-order');
    addBusiness(engine, 'bakery', BAKING_SKILL, 0, 2000);
    expect(engine.getMarketListing('market', 'flour')).toBeNull();

    applyCompanyDailyCadence(engine.db, engine.bus, 1 * DAY);
    expect(engine.getMarketListing('market', 'flour')).toMatchObject({ quantity: 0, price: 24 });
    applyMerchantTrade(engine.db, engine.bus, 1 * DAY);
    expect(engine.getMarketListing('market', 'flour')?.quantity).toBeGreaterThan(0);

    applyCompanyDailyCadence(engine.db, engine.bus, 2 * DAY);
    expect(countActiveItemsOfType(engine.db, 'bakery', 'flour')).toBe(24);
    engine.dispose();
  });
});
