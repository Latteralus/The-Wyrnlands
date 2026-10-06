import { describe, expect, it } from 'vitest';
import { summarizeLedger } from '../companies/companies';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import { getGoodDefinition } from '../goods/catalog';
import { MINUTES_PER_DAY } from '../time/clock';
import { sellSurplusToMarket } from './market';
import { applyMerchantTrade } from './merchant';

async function newMarket(seed: string) {
  const engine = Engine.bootstrap(createDatabase(await loadSqlJs()), { seed });
  engine.createSite({ id: 'market', name: 'Market', kind: 'market', x: 0, y: 0 });
  return engine;
}

describe('the merchant (§8.2 imports, §8.1 export purchases)', () => {
  it('restocks a short imported good to its reference level, at no less than its asking price', async () => {
    const engine = await newMarket('merchant-import');
    const bread = getGoodDefinition('bread');
    engine.seedMarketListing('market', 'bread', bread.basePrice, 5); // well under half of reference

    applyMerchantTrade(engine.db, engine.bus, MINUTES_PER_DAY);

    const listing = engine.getMarketListing('market', 'bread')!;
    expect(listing.quantity).toBe(bread.marketReferenceStock);
    expect(listing.price).toBe(Math.ceil(bread.basePrice * 1.5));
    expect(engine.queryLog('business', 10).some((e) => e.type === 'market.imported')).toBe(true);
    engine.dispose();
  });

  it('leaves a well-stocked market alone, and never imports what it does not carry', async () => {
    const engine = await newMarket('merchant-no-import');
    const bread = getGoodDefinition('bread');
    engine.seedMarketListing('market', 'bread', bread.basePrice, bread.marketReferenceStock ?? 0);
    engine.seedMarketListing('market', 'firewood', 15, 0); // firewood isn't a merchant import

    applyMerchantTrade(engine.db, engine.bus, MINUTES_PER_DAY);

    expect(engine.getMarketListing('market', 'bread')?.quantity).toBe(bread.marketReferenceStock);
    expect(engine.getMarketListing('market', 'firewood')?.quantity).toBe(0);
    engine.dispose();
  });

  it('buys up only a stale glut of an exportable good, paying its producer from outside the economy', async () => {
    const engine = await newMarket('merchant-export');
    engine.createCompany({ id: 'camp', name: 'Camp', kind: 'logging', siteId: 'market' });
    const wood = getGoodDefinition('firewood');
    const reference = wood.marketReferenceStock ?? 0;
    const glut = reference * 2 + 10;
    for (let i = 0; i < glut; i++)
      engine.produceItem({ id: `wood-${i}`, type: 'firewood', containerId: 'camp' });
    sellSurplusToMarket(engine.db, engine.bus, 'camp', 'market', 'firewood', glut, wood.basePrice, 0);
    const before = engine.runConservationAudit();

    // Fresh output isn't a glut yet — a periodic buyer may be back for it.
    applyMerchantTrade(engine.db, engine.bus, 3 * MINUTES_PER_DAY);
    expect(engine.getMarketListing('market', 'firewood')?.quantity).toBe(glut);

    // A week on, the excess over twice the reference stock leaves for export.
    applyMerchantTrade(engine.db, engine.bus, 8 * MINUTES_PER_DAY);
    expect(engine.getMarketListing('market', 'firewood')?.quantity).toBe(reference * 2);
    expect(engine.getItem('wood-0')?.status).toBe('exported');
    expect(engine.getProvenanceChain('wood-0').map((e) => e.eventType)).toEqual([
      'produced',
      'transferred',
      'exported',
    ]);
    const unitPrice = Math.max(1, Math.floor(wood.basePrice * 0.6));
    expect(engine.getBalance('camp')).toBe(10 * unitPrice);
    expect(summarizeLedger(engine.db, 'camp', 0).revenue).toBe(10 * unitPrice);

    const after = engine.runConservationAudit();
    expect(after.passed).toBe(true);
    expect(after.goods.actual).toBe(before.goods.actual - 10);
    engine.dispose();
  });
});
