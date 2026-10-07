import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createViewBuilders } from '../../sim-host/views';
import { createDatabase, queryRow, queryRows } from '../db/sqlite';
import { NativeDatabase } from '../db/sqlite.native';
import { loadSqlJs } from '../db/sqlite.node';
import { getGoodDefinition } from '../goods/catalog';
import { listActiveItemsInContainer } from '../inventory/items';
import { createNewGame } from '../player/newGame';
import { collectEconomySnapshot } from '../reports/economySnapshot';
import { addXp } from '../skills/skills';
import { canonicalState, databaseBytes } from './benchmark';
import type { Database } from '../db/sqlite';
import type { Engine } from '../engine';

// Repeat the starting households, businesses, staffing and inventory at the
// same travel distances. This is a load fixture, not a balanced large town:
// catalog market reference stocks intentionally remain unchanged.
export function scaleStartingSettlement(engine: Engine, scale: number): void {
  const companies = engine.listCompanies();
  const households = engine.listHouseholds().filter((h) => h.id !== 'player-household');
  const db = engine.db;
  for (let group = 1; group < scale; group++) {
    const prefix = `scale-${group}-`;
    for (const household of households) {
      engine.createHousehold({
        id: prefix + household.id,
        name: prefix + household.name,
        homeSiteId: household.homeSiteId,
      });
      engine.faucetCoin(
        prefix + household.id,
        engine.getBalance(household.id),
        'Benchmark starting reserve.',
        'business',
      );
      for (const member of engine.listHouseholdMembers(household.id)) {
        engine.createEntity(prefix + member, prefix + (engine.getEntity(member)?.name ?? member));
        engine.ensureNeeds(prefix + member);
        engine.addHouseholdMember(prefix + household.id, prefix + member);
        for (const row of queryRows(db, 'SELECT skill, xp FROM skills WHERE entity_id = ?', [member]))
          addXp(db, prefix + member, String(row[0]), Number(row[1]));
      }
      for (const item of listActiveItemsInContainer(db, household.id))
        engine.produceItem({
          id: prefix + item.id,
          type: item.type,
          containerId: prefix + household.id,
          qualityTier: item.qualityTier,
          ...(getGoodDefinition(item.type).maxDurability
            ? { durability: getGoodDefinition(item.type).maxDurability }
            : {}),
          scope: 'business',
        });
    }
    for (const company of companies) {
      const site = engine.getSite(company.siteId);
      if (!site) continue;
      engine.createSite({ ...site, id: prefix + site.id, name: prefix + site.name });
      engine.createCompany({
        id: prefix + company.id,
        name: prefix + company.name,
        kind: company.kind,
        siteId: prefix + site.id,
      });
      engine.faucetCoin(
        prefix + company.id,
        engine.getBalance(company.id),
        'Benchmark starting capital.',
        'business',
      );
      if (company.ownerId) engine.setCompanyOwner(prefix + company.id, prefix + company.ownerId);
      for (const slot of engine.listJobSlotsForCompany(company.id)) {
        const { toolGoodType, ...parameters } = slot;
        engine.createJobSlot({
          ...parameters,
          id: prefix + slot.id,
          companyId: prefix + company.id,
          ...(toolGoodType ? { toolGoodType } : {}),
        });
        for (const row of queryRows(
          db,
          "SELECT entity_id, wage FROM employment WHERE job_slot_id = ? AND status = 'active'",
          [slot.id],
        )) {
          engine.applyForJob(prefix + String(row[0]), prefix + slot.id, { haggle: false, scope: 'business' });
          db.run("UPDATE employment SET wage = ? WHERE entity_id = ? AND status = 'active'", [
            Number(row[1]),
            prefix + String(row[0]),
          ]);
        }
      }
      for (const item of listActiveItemsInContainer(db, company.id))
        engine.produceItem({
          id: prefix + item.id,
          type: item.type,
          containerId: prefix + company.id,
          qualityTier: item.qualityTier,
          ...(getGoodDefinition(item.type).maxDurability
            ? { durability: getGoodDefinition(item.type).maxDurability }
            : {}),
          scope: 'business',
        });
    }
  }
  db.run('UPDATE market_listings SET quantity = quantity * ?', [scale]);
}

const argument = (name: string, fallback: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : (process.argv[index + 1] ?? fallback);
};
const days = Number(argument('--days', '14'));
const scales = argument('--scales', '1,4,12').split(',').map(Number);
const backend = argument('--backend', 'native');
const out = argument('--out', 'logs/activity-scale.json');
const fixture = argument('--save-prefix', '');
if (
  !Number.isSafeInteger(days) ||
  days < 1 ||
  scales.some((scale) => !Number.isSafeInteger(scale) || scale < 1) ||
  !['native', 'sqljs'].includes(backend)
)
  throw new Error('Use positive integer days/scales and a native or sqljs backend.');
mkdirSync(dirname(out), { recursive: true });
if (fixture) mkdirSync(dirname(fixture), { recursive: true });
const SQL = await loadSqlJs();
const results = [];
for (const scale of scales) {
  for (const speed of [1, 4, 16]) {
    const db: Database = backend === 'native' ? new NativeDatabase(':memory:') : createDatabase(SQL);
    const engine = createNewGame(db, {
      world: { seed: 'perf-baseline', startSeasonIndex: 0 },
      character: { firstName: 'Edda', lastName: 'Hale', preset: 'standard' },
    });
    scaleStartingSettlement(engine, scale);
    if (fixture && speed === 1) writeFileSync(`${fixture}-${scale}.sqlite`, engine.export());
    const startCounts = {
      population: Number(queryRow(db, 'SELECT COUNT(*) FROM household_members')?.[0]),
      businesses: engine.listCompanies().length,
    };
    const batches = [];
    let peakRss = process.memoryUsage().rss;
    const cpu = process.cpuUsage();
    const started = performance.now();
    while (engine.tick < days * 1440) {
      const t0 = performance.now();
      engine.advanceTicks(Math.min(5 * speed, days * 1440 - engine.tick));
      batches.push(performance.now() - t0);
      if (engine.tick % 1440 < 5 * speed) peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    const elapsedMs = performance.now() - started;
    const usedCpu = process.cpuUsage(cpu);
    batches.sort((a, b) => a - b);
    const views = createViewBuilders(engine);
    const viewTimes = [];
    let payloadBytes = 0;
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      payloadBytes = new TextEncoder().encode(
        JSON.stringify({
          settlement: views['view.settlement'](undefined),
          market: views['view.location']({ siteId: 'market' }),
          home: views['view.location']({ siteId: 'tavern' }),
        }),
      ).length;
      viewTimes.push(performance.now() - t0);
    }
    const result = {
      scale,
      speed,
      ...startCounts,
      days,
      elapsedMs: Math.round(elapsedMs),
      msPerDay: Math.round(elapsedMs / days),
      batchP99Ms: batches[Math.floor(batches.length * 0.99)],
      batchMaxMs: batches.at(-1),
      clockBudgetMs: 200,
      cpuMs: (usedCpu.user + usedCpu.system) / 1000,
      peakRssMb: peakRss / 1024 / 1024,
      heapMb: process.memoryUsage().heapUsed / 1024 / 1024,
      dbBytes: databaseBytes(db),
      actions: queryRow(db, 'SELECT COUNT(*) FROM actions')?.[0],
      events: queryRow(db, 'SELECT COUNT(*) FROM event_log')?.[0],
      provenance: queryRow(db, 'SELECT COUNT(*) FROM provenance_events')?.[0],
      audit: engine.runConservationAudit(),
      viewBuildAndSerializeMs: viewTimes.reduce((a, b) => a + b, 0) / viewTimes.length,
      payloadBytes,
      fingerprint: createHash('sha256').update(canonicalState(engine)).digest('hex').slice(0, 16),
      economy: collectEconomySnapshot(db, engine.tick, days * 1440, 1440),
    };
    results.push(result);
    console.log(JSON.stringify({ ...result, economy: undefined }));
    engine.dispose();
  }
}
writeFileSync(out, JSON.stringify({ backend, days, results }, null, 2));
