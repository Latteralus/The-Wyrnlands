import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/sqlite';
import { loadSqlJs } from '../db/sqlite.node';
import { Engine } from '../engine';
import type { ProvenanceEvent } from './types';

describe('item provenance', () => {
  it('records a full life — produced, transferred, then consumed — as a queryable chain', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'provenance-chain' });
    engine.createEntity('miller-edda', 'Edda the Miller');

    engine.advanceTicks(5);
    engine.produceItem({
      id: 'loaf-1',
      type: 'bread',
      containerId: 'riverside-mill-storage',
      actorId: 'miller-edda',
      note: 'Baked by Edda from Oster-farm flour.',
    });

    engine.advanceTicks(3);
    engine.transferItem('loaf-1', 'market-stall-2', { actorId: 'miller-edda', note: 'Carted to market.' });

    engine.advanceTicks(10);
    engine.destroyItem('loaf-1', 'consumed', { actorId: 'villager-1', note: 'Eaten.' });

    const item = engine.getItem('loaf-1');
    expect(item?.status).toBe('consumed');
    expect(item?.containerId).toBe('market-stall-2'); // last known container before consumption
    expect(item?.createdAtTick).toBe(5);
    expect(item?.destroyedAtTick).toBe(18);

    const chain = engine.getProvenanceChain('loaf-1');
    expect(chain.map((e) => e.eventType)).toEqual(['produced', 'transferred', 'consumed']);
    expect(chain).toHaveLength(3);
    const [produced, transferred, consumed] = chain as [ProvenanceEvent, ProvenanceEvent, ProvenanceEvent];
    expect(produced.tick).toBe(5);
    expect(produced.toContainerId).toBe('riverside-mill-storage');
    expect(transferred.tick).toBe(8);
    expect(transferred.fromContainerId).toBe('riverside-mill-storage');
    expect(transferred.toContainerId).toBe('market-stall-2');
    expect(consumed.tick).toBe(18);
    expect(consumed.actorId).toBe('villager-1');

    engine.dispose();
  });

  it('rejects transferring or destroying an item that is already gone', async () => {
    const SQL = await loadSqlJs();
    const db = createDatabase(SQL);
    const engine = Engine.bootstrap(db, { seed: 'provenance-guards' });

    engine.produceItem({ id: 'axe-1', type: 'axe', containerId: 'toolshed' });
    engine.destroyItem('axe-1', 'worn_out');

    expect(() => engine.transferItem('axe-1', 'toolshed-2')).toThrow(/non-active/);
    expect(() => engine.destroyItem('axe-1', 'worn_out')).toThrow(/already destroyed/);
    expect(() => engine.transferItem('ghost-item', 'toolshed-2')).toThrow(/Unknown item/);

    engine.dispose();
  });
});
