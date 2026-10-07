import { consumeActiveItems, countActiveItemsOfType, produceItem } from '../inventory/items';
import { planShift, type Recipe } from './recipes';
import type { Database } from '../db/sqlite';
import type { EventBus, EventScope } from '../eventBus';

// One worker's shift of production at a company (§9.1): consume input on
// hand (whole batches only), produce output into the company's own stock.
// The player's work_shift action (jobs/shifts.ts) and NPC shifts
// (population/cadence.ts) both call this, so the same recipe rules apply to
// everyone (pillar 2). Returns how many output units were produced.
export function runProductionShift(
  db: Database,
  bus: EventBus,
  params: {
    companyId: string;
    companyName: string;
    workerId: string;
    recipe: Recipe;
    succeeded: boolean;
    qualityTier: number;
    tick: number;
    scope: EventScope;
  },
): number {
  const { recipe, companyId } = params;
  const laborOutput = params.succeeded ? recipe.outputPerShiftSuccess : recipe.outputPerShiftFailure;
  const available = recipe.inputGood ? countActiveItemsOfType(db, companyId, recipe.inputGood) : 0;
  const { consume, produce } = planShift(recipe, laborOutput, available);
  if (produce <= 0) return 0;

  if (recipe.inputGood && consume > 0) {
    consumeActiveItems(db, bus, companyId, recipe.inputGood, consume, params.tick, {
      actorId: params.workerId,
      note: `${recipe.inputGood} used at ${params.companyName}.`,
      scope: params.scope,
    });
  }
  for (let i = 0; i < produce; i++) {
    produceItem(db, bus, {
      id: `${companyId}-${recipe.outputGood}-${params.tick}-${params.workerId}-${i}`,
      type: recipe.outputGood,
      qualityTier: params.qualityTier,
      containerId: companyId,
      tick: params.tick,
      actorId: params.workerId,
      note: `${recipe.outputGood} produced at ${params.companyName}.`,
      scope: params.scope,
    });
  }
  return produce;
}
