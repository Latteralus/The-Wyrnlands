import { queryRow } from '../db/sqlite';
import { createRng, hashSeed } from '../rng';
import type { Database } from 'sql.js';

// §11.1 "hidden traits (ambition, greed, loyalty, industriousness, risk
// tolerance)", §16's traits table. Only the two that anything reads exist so
// far — both used by entrepreneurship (population/entrepreneurship.ts):
//   - ambition: how readily someone even considers striking out on their own;
//   - risk tolerance: how long a payback they'll accept and how thin a
//     household cushion they'll keep when they do.
// Values are 0..1.
//
// A person's traits are fixed at birth, so they're derived once —
// deterministically from the world seed and the person's id — and stored.
// Deriving rather than drawing from the engine's shared RNG stream means
// adding traits to the world changes no other random outcome: every
// existing seed keeps the same population, rolls and economic history it
// had before traits existed, and NPCs created before this table (older
// saves, immigrants) get theirs the first time anything asks.
export type TraitName = 'ambition' | 'risk_tolerance';

function worldSeed(db: Database): string {
  const row = queryRow(db, 'SELECT rng_seed FROM world_meta WHERE id = 1');
  return String(row?.[0] ?? '');
}

export function getTrait(db: Database, entityId: string, trait: TraitName): number {
  const row = queryRow(db, 'SELECT value FROM traits WHERE entity_id = ? AND trait = ?', [entityId, trait]);
  if (row) return Number(row[0]);
  const value = deriveTrait(db, entityId, trait);
  db.run('INSERT INTO traits (entity_id, trait, value) VALUES (?, ?, ?)', [entityId, trait, value]);
  return value;
}

// The same value getTrait would return, without storing it — for read-only
// callers (profiles, the UI) that must never change world state.
export function peekTrait(db: Database, entityId: string, trait: TraitName): number {
  const row = queryRow(db, 'SELECT value FROM traits WHERE entity_id = ? AND trait = ?', [entityId, trait]);
  return row ? Number(row[0]) : deriveTrait(db, entityId, trait);
}

function deriveTrait(db: Database, entityId: string, trait: TraitName): number {
  return createRng(hashSeed(`${worldSeed(db)}:${entityId}:${trait}`))();
}

// For tests and scenario content that needs a particular personality.
export function setTrait(db: Database, entityId: string, trait: TraitName, value: number): void {
  db.run(
    `INSERT INTO traits (entity_id, trait, value) VALUES (?, ?, ?)
     ON CONFLICT (entity_id, trait) DO UPDATE SET value = excluded.value`,
    [entityId, trait, Math.min(1, Math.max(0, value))],
  );
}
