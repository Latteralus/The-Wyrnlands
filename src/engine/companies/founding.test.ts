import { describe, expect, it } from 'vitest';
import { queryRow } from '../db/sqlite';
import { countActiveItemsOfType } from '../inventory/items';
import { buildFoundingWorld, FOUNDER_HOUSEHOLD_ID, FOUNDER_ID, PARCEL_ID } from '../scenarios/foundingWorld';
import { MINUTES_PER_DAY } from '../time/clock';
import { getOpenTenure } from '../world/tenure';
import { foundCompany, getFoundingRecord, type FoundingPlan } from './founding';
import type { Engine } from '../engine';

const TICK = 14 * MINUTES_PER_DAY;

function farmPlan(overrides: Partial<FoundingPlan> = {}): FoundingPlan {
  return {
    founderId: FOUNDER_ID,
    payerId: FOUNDER_HOUSEHOLD_ID,
    businessTypeId: 'farm',
    siteId: PARCEL_ID,
    tenureKind: 'lease',
    companyName: 'Hale Farm',
    positions: 3,
    postedWage: 20,
    investment: 1000,
    initialInputUnits: 0,
    founderWorks: true,
    ...overrides,
  };
}

function totalCoin(engine: Engine): number {
  return Number(queryRow(engine.db, 'SELECT SUM(balance) FROM wallets')?.[0] ?? 0);
}

function rowCount(engine: Engine, table: string): number {
  return Number(queryRow(engine.db, `SELECT COUNT(*) FROM ${table}`)?.[0] ?? 0);
}

describe('foundCompany (companies/founding.ts)', () => {
  it('founds a company with real money: capital from the household, land leased, a tool bought, positions posted', async () => {
    const engine = await buildFoundingWorld('founding-success');
    const result = foundCompany(engine.db, engine.bus, farmPlan(), TICK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const company = engine.getCompany(result.companyId)!;

    expect(company).toMatchObject({
      name: 'Hale Farm',
      kind: 'farm',
      ownerId: FOUNDER_ID,
      foundedAtTick: TICK,
    });
    // The household paid exactly the investment; the company holds what's
    // left after the entry fine (4 weeks × 15 rent) and the hoe (60).
    expect(engine.getBalance(FOUNDER_HOUSEHOLD_ID)).toBe(5000 - 1000);
    expect(result.outlay).toMatchObject({ land: 60, weeklyRent: 15, tool: 60, total: 120 });
    expect(engine.getBalance(company.id)).toBe(1000 - 120);
    expect(countActiveItemsOfType(engine.db, company.id, 'hoe')).toBe(1);
    expect(getOpenTenure(engine.db, PARCEL_ID)).toMatchObject({ holderId: company.id, kind: 'lease' });

    const slot = engine.listJobSlotsForCompany(company.id)[0]!;
    expect(slot).toMatchObject({
      title: 'Farmhand',
      capacity: 3,
      maxCapacity: 4,
      wageMin: 20,
      toolGoodType: 'hoe',
    });
    // The founder works their own business; the other two positions are
    // openings — nobody was summoned into them.
    expect(engine.getEmployment(FOUNDER_ID)?.companyId).toBe(company.id);
    expect(engine.countActiveEmploymentsForSlot(slot.id)).toBe(1);

    // Equity and capital stay out of operating net.
    const ledger = engine.getCompanyLedgerSummary(company.id, 0);
    expect(ledger).toMatchObject({ ownerContributions: 1000, capital: 120, net: 0 });
    expect(getFoundingRecord(engine.db, company.id)).toMatchObject({
      founderId: FOUNDER_ID,
      payerId: FOUNDER_HOUSEHOLD_ID,
      investment: 1000,
      payerBalanceBefore: 5000,
      businessType: 'farm',
    });
    expect(engine.queryActorLog(company.id).some((e) => e.type === 'business.founded')).toBe(true);
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('creates no money: total coin falls by exactly the land and tool paid out of the economy', async () => {
    const engine = await buildFoundingWorld('founding-conservation');
    const before = totalCoin(engine);
    const goodsBefore = Number(
      queryRow(engine.db, "SELECT COUNT(*) FROM items WHERE status = 'active'")?.[0],
    );
    const result = foundCompany(engine.db, engine.bus, farmPlan(), TICK);
    expect(result.ok).toBe(true);
    // Entry fine (60) and the merchant-import hoe (60) are sinks; the
    // capital itself only moved between purses.
    expect(totalCoin(engine)).toBe(before - 120);
    // One hoe now exists, imported by the merchant — a recorded creation.
    expect(Number(queryRow(engine.db, "SELECT COUNT(*) FROM items WHERE status = 'active'")?.[0])).toBe(
      goodsBefore + 1,
    );
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it("can't found from nothing: a plan the household can't pay for creates nothing", async () => {
    const engine = await buildFoundingWorld('founding-broke', { founderCoin: 300 });
    const companiesBefore = engine.listCompanies().length;
    const result = foundCompany(engine.db, engine.bus, farmPlan({ investment: 1000 }), TICK);
    expect(result).toMatchObject({ ok: false });
    expect(engine.listCompanies().length).toBe(companiesBefore);
    expect(engine.getBalance(FOUNDER_HOUSEHOLD_ID)).toBe(300);
    expect(getOpenTenure(engine.db, PARCEL_ID)).toBeNull();
    engine.dispose();
  });

  it("refuses capital that doesn't cover the outlay — no company runs on promises", async () => {
    const engine = await buildFoundingWorld('founding-short');
    const result = foundCompany(engine.db, engine.bus, farmPlan({ investment: 100 }), TICK);
    expect(result).toMatchObject({ ok: false });
    expect(engine.listCompanies()).toHaveLength(0);
    engine.dispose();
  });

  it('a resource business needs the right land: no farm without a farm parcel, none on land already held', async () => {
    const noLand = await buildFoundingWorld('founding-no-land', { farmParcel: false });
    expect(foundCompany(noLand.db, noLand.bus, farmPlan(), TICK)).toMatchObject({ ok: false });
    expect(noLand.listCompanies()).toHaveLength(0);
    noLand.dispose();

    const held = await buildFoundingWorld('founding-held');
    held.createEntity('someone', 'Someone');
    held.grantSiteTenure(PARCEL_ID, 'someone', 'lease');
    expect(foundCompany(held.db, held.bus, farmPlan(), TICK)).toMatchObject({ ok: false });
    held.dispose();

    // A logging company can't be founded on a farm parcel either.
    const wrongKind = await buildFoundingWorld('founding-wrong-kind');
    wrongKind.seedMarketListing('market', 'axe', 70, 2);
    expect(
      foundCompany(wrongKind.db, wrongKind.bus, farmPlan({ businessTypeId: 'logging' }), TICK),
    ).toMatchObject({ ok: false });
    wrongKind.dispose();
  });

  it('a resource business needs its equipment: no hoe for sale, no farm', async () => {
    const engine = await buildFoundingWorld('founding-no-tool', { hoeStock: 0 });
    expect(foundCompany(engine.db, engine.bus, farmPlan(), TICK)).toMatchObject({ ok: false });
    expect(engine.listCompanies()).toHaveLength(0);
    engine.dispose();
  });

  it('rolls back every step when one fails part-way — no half-made company, no lost coin or goods', async () => {
    const engine = await buildFoundingWorld('founding-rollback');
    const coinBefore = totalCoin(engine);
    const counts = () =>
      [
        'companies',
        'entities',
        'wallets',
        'site_tenures',
        'job_slots',
        'employment',
        'items',
        'company_ledger_entries',
      ].map((table) => rowCount(engine, table));
    const before = counts();
    const hoeListing = engine.getMarketListing('market', 'hoe');
    // The very last write fails.
    engine.db.run(
      "CREATE TRIGGER fail_founding BEFORE INSERT ON company_foundings BEGIN SELECT RAISE(ABORT, 'the deed is lost'); END",
    );

    const result = foundCompany(engine.db, engine.bus, farmPlan(), TICK);
    expect(result).toMatchObject({ ok: false });
    expect(counts()).toEqual(before);
    expect(totalCoin(engine)).toBe(coinBefore);
    expect(engine.getBalance(FOUNDER_HOUSEHOLD_ID)).toBe(5000);
    expect(engine.getMarketListing('market', 'hoe')).toEqual(hoeListing);
    expect(engine.getEmployment(FOUNDER_ID)).toBeNull();
    expect(engine.runConservationAudit().passed).toBe(true);
    // The attempt is part of the founder's story, even though nothing came of it.
    expect(engine.queryActorLog(FOUNDER_ID).some((e) => e.type === 'business.founding_failed')).toBe(true);
    engine.dispose();
  });

  it('an owner who already runs a business can found a second without working it', async () => {
    const engine = await buildFoundingWorld('founding-second');
    const result = foundCompany(engine.db, engine.bus, farmPlan({ founderWorks: false }), TICK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(engine.getEmployment(FOUNDER_ID)).toBeNull();
    expect(engine.getCompany(result.companyId)?.ownerId).toBe(FOUNDER_ID);
    engine.dispose();
  });
});
