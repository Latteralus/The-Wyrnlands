import { queryRows } from '../db/sqlite';
import { getGoodDefinition } from '../goods/catalog';
import type { Database } from 'sql.js';

// Placeholder tuning (§14.2 "inventory (weight-limited)") — a person can
// reasonably carry about this much on their back without a cart. Revisit
// once carts/wagons (Stage 7) give a real point of comparison.
export const PERSONAL_CARRY_CAPACITY_KG = 20;

export function getCarriedWeightKg(db: Database, containerId: string): number {
  const rows = queryRows(db, "SELECT type FROM items WHERE container_id = ? AND status = 'active'", [
    containerId,
  ]);
  return rows.reduce((total, row) => total + getGoodDefinition(String(row[0])).weightKg, 0);
}

export function canCarry(db: Database, containerId: string, additionalWeightKg: number): boolean {
  return getCarriedWeightKg(db, containerId) + additionalWeightKg <= PERSONAL_CARRY_CAPACITY_KG;
}
