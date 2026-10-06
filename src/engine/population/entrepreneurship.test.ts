import { describe, expect, it } from 'vitest';
import { getBusinessType } from '../companies/businessTypes';
import { getFoundingRecord } from '../companies/founding';
import { createRng } from '../rng';
import {
  addGluttedGrainMarket,
  addHungryMill,
  addJobSeekers,
  buildFoundingWorld,
  FOUNDER_HOUSEHOLD_ID,
  FOUNDER_ID,
  type FoundingWorldOptions,
} from '../scenarios/foundingWorld';
import { FARMING_SKILL, MANAGEMENT_SKILL } from '../skills/skills';
import { MINUTES_PER_DAY } from '../time/clock';
import { applyEntrepreneurshipCadence, tradeExperience } from './entrepreneurship';
import { getTrait } from './traits';

const PASS_TICK = 28 * MINUTES_PER_DAY;
// A middling RNG: every willingness roll passes for an ambitious founder,
// and every estimate carries zero random error — so a test reads only the
// signal it set up.
const steady = () => 0.5;

async function hungryMillWorld(seed: string, options: FoundingWorldOptions = {}) {
  const engine = await buildFoundingWorld(seed, options);
  addHungryMill(engine);
  addJobSeekers(engine, 6);
  return engine;
}

describe('NPC entrepreneurship (population/entrepreneurship.ts)', () => {
  it('a capitalized, capable NPC facing a real opportunity founds a business — and says why', async () => {
    const engine = await hungryMillWorld('entre-success');
    const stats = applyEntrepreneurshipCadence(engine.db, engine.bus, PASS_TICK, steady);

    expect(stats.founded).toHaveLength(1);
    const company = engine.getCompany(stats.founded[0]!)!;
    expect(company).toMatchObject({
      kind: 'farm',
      ownerId: FOUNDER_ID,
      siteId: 'eastfield',
      name: 'Hale Farm',
    });
    expect(engine.getEmployment(FOUNDER_ID)?.companyId).toBe(company.id);
    expect(engine.getBalance(FOUNDER_HOUSEHOLD_ID)).toBeLessThan(5000);

    const opportunity = engine.queryActorLog(FOUNDER_ID).find((e) => e.type === 'entrepreneur.opportunity');
    expect(opportunity?.message).toMatch(/grain/);
    const record = getFoundingRecord(engine.db, company.id)!;
    expect(record.details?.reasons).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/need grain/),
        expect.stringMatching(/nobody in town makes grain/),
      ]),
    );
    expect(record.details?.market).toMatchObject({ soldPerDay: 0 });
    expect(engine.runConservationAudit().passed).toBe(true);
    engine.dispose();
  });

  it('insufficient capital: a household that cannot fund it is not even a candidate', async () => {
    const engine = await hungryMillWorld('entre-broke', { founderCoin: 250 });
    const stats = applyEntrepreneurshipCadence(engine.db, engine.bus, PASS_TICK, steady);
    expect(stats).toMatchObject({ candidates: 0, founded: [] });
    expect(engine.getBalance(FOUNDER_HOUSEHOLD_ID)).toBe(250);
    engine.dispose();
  });

  it("won't risk the household's cushion: savings that cover the plan but not the plan plus a few weeks' food aren't enough", async () => {
    // Enough to be a candidate, nowhere near enough for a farm plus
    // working capital plus the household's safety margin.
    const engine = await hungryMillWorld('entre-cushion', { founderCoin: 600, riskTolerance: 0 });
    const stats = applyEntrepreneurshipCadence(engine.db, engine.bus, PASS_TICK, steady);
    expect(stats.candidates).toBe(1);
    expect(stats.founded).toEqual([]);
    engine.dispose();
  });

  it('no suitable land, no resource business — whatever the opportunity', async () => {
    const engine = await hungryMillWorld('entre-no-land', { farmParcel: false });
    const stats = applyEntrepreneurshipCadence(engine.db, engine.bus, PASS_TICK, steady);
    expect(stats.founded).toEqual([]);
    expect(engine.listCompanies().map((c) => c.id)).toEqual(['mill-co']);
    engine.dispose();
  });

  it('a competent founder stays out of a saturated market; a poor manager with the same savings walks in', async () => {
    const competent = await buildFoundingWorld('entre-glut-competent', { founderManagementXp: 1100 });
    addGluttedGrainMarket(competent, 4);
    competent.addSkillXp(FOUNDER_ID, FARMING_SKILL, 1000); // knows farming
    expect(applyEntrepreneurshipCadence(competent.db, competent.bus, PASS_TICK, steady).founded).toEqual([]);
    competent.dispose();

    const poor = await buildFoundingWorld('entre-glut-poor', { founderManagementXp: 0, riskTolerance: 1 });
    addGluttedGrainMarket(poor, 4);
    poor.addSkillXp(FOUNDER_ID, FARMING_SKILL, 1000);
    const stats = applyEntrepreneurshipCadence(poor.db, poor.bus, PASS_TICK, steady);
    expect(stats.founded).toHaveLength(1);
    // ...hiring to the limit for a market that wants none of it.
    expect(poor.listJobSlotsForCompany(stats.founded[0]!)[0]?.capacity).toBe(
      getBusinessType('farm')!.startingMaxPositions,
    );
    poor.dispose();
  });

  it("someone who has never worked a trade only takes it on if they're a capable manager", async () => {
    const novice = await hungryMillWorld('entre-novice', { founderManagementXp: 0 });
    expect(applyEntrepreneurshipCadence(novice.db, novice.bus, PASS_TICK, steady)).toMatchObject({
      considered: 1,
      estimates: 0,
      founded: [],
    });
    novice.dispose();

    // The same person after years as a farmhand knows the trade.
    const farmhand = await hungryMillWorld('entre-farmhand', { founderManagementXp: 0 });
    farmhand.addSkillXp(FOUNDER_ID, FARMING_SKILL, 1000);
    expect(
      tradeExperience(farmhand.db, FOUNDER_ID, getBusinessType('farm')!, PASS_TICK),
    ).toBeGreaterThanOrEqual(0.2);
    expect(
      applyEntrepreneurshipCadence(farmhand.db, farmhand.bus, PASS_TICK, steady).estimates,
    ).toBeGreaterThan(0);
    farmhand.dispose();
  });

  it('does not immediately found again after a business of their own has closed', async () => {
    const engine = await hungryMillWorld('entre-recovery');
    engine.createSite({ id: 'gone', name: 'Gone', kind: 'farm', x: 7, y: 7, landValue: 600 });
    engine.createCompany({ id: 'old-co', name: 'Old Co', kind: 'farm', siteId: 'gone', foundedAtTick: 0 });
    engine.setCompanyOwner('old-co', FOUNDER_ID);
    engine.shutDownCompany('old-co', 'Old Co closes.', 'insolvency');
    expect(applyEntrepreneurshipCadence(engine.db, engine.bus, PASS_TICK, steady).candidates).toBe(0);
    // Months later they're ready to try again — and their failed farm
    // counts as experience.
    const later = PASS_TICK + 120 * MINUTES_PER_DAY;
    expect(tradeExperience(engine.db, FOUNDER_ID, getBusinessType('farm')!, later)).toBeGreaterThanOrEqual(
      0.4,
    );
    expect(applyEntrepreneurshipCadence(engine.db, engine.bus, later, steady).founded).toHaveLength(1);
    engine.dispose();
  });

  it('no automatic replacement: closing the sole producer founds nothing until a capable, capitalized person chooses to', async () => {
    const engine = await hungryMillWorld('entre-no-replacement', { founderCoin: 0 });
    // The town's only farm supplies the mill...
    engine.createSite({ id: 'old-farm', name: 'Old Farm', kind: 'farm', x: 9, y: 9, landValue: 800 });
    engine.createCompany({ id: 'old-farm-co', name: 'Old Farm', kind: 'farm', siteId: 'old-farm' });
    engine.grantSiteTenure('old-farm', 'old-farm-co');
    // ...and fails.
    engine.shutDownCompany('old-farm-co', 'The Old Farm closes.', 'insolvency');

    // Shortage, idle mill, free land — and nobody with the means to act.
    for (let pass = 1; pass <= 4; pass++) {
      const stats = applyEntrepreneurshipCadence(engine.db, engine.bus, pass * 14 * MINUTES_PER_DAY, steady);
      expect(stats.founded).toEqual([]);
    }
    expect(
      engine
        .listCompanies()
        .filter((c) => c.closedAtTick === null)
        .map((c) => c.id),
    ).toEqual(['mill-co']);

    // Someone who has saved up does weigh it — and a farm appears because
    // they chose to found it.
    engine.faucetCoin(FOUNDER_HOUSEHOLD_ID, 5000, 'an inheritance', 'business');
    const stats = applyEntrepreneurshipCadence(engine.db, engine.bus, 70 * MINUTES_PER_DAY, steady);
    expect(stats.founded).toHaveLength(1);
    expect(engine.queryActorLog(FOUNDER_ID).some((e) => e.type === 'entrepreneur.opportunity')).toBe(true);
    engine.dispose();
  });

  it('is deterministic: the same world and seed make the same decisions', async () => {
    const run = async () => {
      const engine = await hungryMillWorld('entre-determinism', { ambition: 0.4, riskTolerance: 0.5 });
      const rng = createRng(1234);
      const founded: string[] = [];
      for (let pass = 1; pass <= 6; pass++)
        founded.push(
          ...applyEntrepreneurshipCadence(engine.db, engine.bus, pass * 14 * MINUTES_PER_DAY, rng).founded,
        );
      const log = engine.queryLog('settlement', 200).map((e) => `${e.tick}:${e.type}:${e.message}`);
      const balance = engine.getBalance(FOUNDER_HOUSEHOLD_ID);
      engine.dispose();
      return { founded, log, balance };
    };
    const a = await run();
    const b = await run();
    expect(a).toEqual(b);
  });

  it('traits are fixed per person and world, and drawn without touching the shared RNG stream', async () => {
    const engine = await buildFoundingWorld('entre-traits');
    engine.createEntity('someone', 'Someone');
    const before = engine.nextRandom();
    const ambition = getTrait(engine.db, 'someone', 'ambition');
    expect(ambition).toBeGreaterThanOrEqual(0);
    expect(ambition).toBeLessThan(1);
    expect(getTrait(engine.db, 'someone', 'ambition')).toBe(ambition);
    expect(getTrait(engine.db, 'someone', 'risk_tolerance')).not.toBe(ambition);
    engine.dispose();

    const replay = await buildFoundingWorld('entre-traits');
    expect(replay.nextRandom()).toBe(before);
    replay.createEntity('someone', 'Someone');
    expect(getTrait(replay.db, 'someone', 'ambition')).toBe(ambition);
    replay.dispose();
  });

  it('only weighs plausible people: a well-off household whose members already run two businesses sits it out', async () => {
    const engine = await hungryMillWorld('entre-two-businesses');
    for (const id of ['co-a', 'co-b']) {
      engine.createSite({ id: `${id}-site`, name: id, kind: 'forest', x: 3, y: 3, landValue: 400 });
      engine.createCompany({ id, name: id, kind: 'logging', siteId: `${id}-site` });
      engine.setCompanyOwner(id, FOUNDER_ID);
    }
    engine.addSkillXp(FOUNDER_ID, MANAGEMENT_SKILL, 1000);
    expect(applyEntrepreneurshipCadence(engine.db, engine.bus, PASS_TICK, steady).candidates).toBe(0);
    engine.dispose();
  });
});
