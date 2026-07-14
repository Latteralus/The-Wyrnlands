import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';

describe('sites', () => {
  it('round-trips a created site and computes distance/travel time between two', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'sites-basic' });

    engine.createSite({ id: 'riverside-mill', name: 'Riverside Mill', kind: 'business', x: 0, y: 0 });
    engine.createSite({ id: 'oster-farm', name: "Oster's Farm", kind: 'farm', x: 3, y: 4 });

    expect(engine.getSite('riverside-mill')).toEqual({
      id: 'riverside-mill',
      name: 'Riverside Mill',
      kind: 'business',
      x: 0,
      y: 0,
    });

    expect(engine.distanceBetweenSites('riverside-mill', 'oster-farm')).toBe(5);

    const ticks = engine.travelDurationBetweenSites('riverside-mill', 'oster-farm', { mode: 'foot' });
    expect(ticks).toBeGreaterThan(0);

    engine.dispose();
  });

  it('lists sites by kind', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'sites-by-kind' });

    engine.createSite({ id: 'farm-a', name: 'Farm A', kind: 'farm', x: 1, y: 1 });
    engine.createSite({ id: 'farm-b', name: 'Farm B', kind: 'farm', x: 2, y: 2 });
    engine.createSite({ id: 'quarry-a', name: 'Quarry A', kind: 'resource_node', x: 5, y: 5 });

    const farms = engine.listSitesByKind('farm');
    expect(farms.map((s) => s.id)).toEqual(['farm-a', 'farm-b']);

    engine.dispose();
  });

  it('throws distance lookup for an unknown site', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'sites-unknown' });

    engine.createSite({ id: 'known-site', name: 'Known Site', kind: 'settlement', x: 0, y: 0 });
    expect(() => engine.distanceBetweenSites('known-site', 'ghost-site')).toThrow(/Unknown site/);

    engine.dispose();
  });
});
