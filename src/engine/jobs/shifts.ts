import { wearCompanyTool } from '../companies/tools';
import { findFirstActiveItem, produceItem } from '../inventory/items';
import { getBalance, transferCoin } from '../inventory/wallet';
import { addXp, getLevel, getSuccessChance } from '../skills/skills';
import { getActiveEmploymentForSlot, getJobSlot } from './jobs';
import type { ActionDefinition } from '../actions/types';

// Placeholder pacing (flagged like every other unbalanced constant so far —
// revisit with the balance harness, §17).
const GRAIN_YIELD_SUCCESS = 4;
const GRAIN_YIELD_FAILURE = 1; // §13.2: failure wastes time/materials, not the whole shift
const TOOL_WEAR_PER_SHIFT = 3;
const SHIFT_XP = 40;

// A timed "work a shift" action bound to one job slot (§9.8: "workers
// commit timed shifts; presence = labor-ticks = production"). jobSlotId is
// baked in like createBuyActionDefinition bakes in (siteId, goodType); the
// employment/job-slot/tool state itself is looked up live at resolve time,
// same pattern.
export function createWorkShiftActionDefinition(
  jobSlotId: string,
  config: { durationTicks: number },
): ActionDefinition {
  return {
    type: `work_shift_${jobSlotId}`,
    durationTicks: config.durationTicks,
    resolve: (rng, ctx) => {
      const employment = getActiveEmploymentForSlot(ctx.db, ctx.actorId, jobSlotId);
      if (!employment) {
        return { success: false, message: "You don't work here." };
      }
      const jobSlot = getJobSlot(ctx.db, jobSlotId);
      if (!jobSlot) throw new Error(`Unknown job slot: "${jobSlotId}"`);

      // §9.4: "a new hire uses company equipment from day one" — no tool,
      // no shift. Company equipment *purchasing* (replacing a broken tool)
      // is Stage 5 (§15), so this stays a hard stop for now, not a retry.
      if (jobSlot.toolGoodType && !findFirstActiveItem(ctx.db, jobSlot.companyId, jobSlot.toolGoodType)) {
        return {
          success: false,
          message: `There's no ${jobSlot.toolGoodType} to work with — the shift can't go ahead.`,
          data: { reason: 'no_tool' },
        };
      }

      const chance = getSuccessChance(ctx.db, ctx.actorId, jobSlot.skill);
      return rng() < chance
        ? { success: true, message: 'A solid day of work in the fields.' }
        : { success: false, message: 'The work goes poorly — a wasted stretch of the row.' };
    },
    applyOutcome: (ctx, outcome) => {
      if (outcome.data?.reason === 'no_tool') return; // no shift happened — nothing to apply

      const employment = getActiveEmploymentForSlot(ctx.db, ctx.actorId, jobSlotId);
      if (!employment) return; // resolve() already failed for this reason — nothing to apply
      const jobSlot = getJobSlot(ctx.db, jobSlotId);
      if (!jobSlot) return;

      // §13.2: "each labor-tick grants XP" regardless of the attempt's
      // outcome (a failed skill check still teaches something).
      addXp(ctx.db, ctx.actorId, jobSlot.skill, SHIFT_XP);
      if (jobSlot.toolGoodType) {
        wearCompanyTool(
          ctx.db,
          ctx.bus,
          jobSlot.companyId,
          jobSlot.toolGoodType,
          TOOL_WEAR_PER_SHIFT,
          ctx.tick,
        );
      }

      // Presence = labor-ticks = production (§9.8): the wage pays for the
      // shift worked, not piece-rate on the harvest — skill instead governs
      // how much (and how good) that labor actually produces below.
      //
      // Capped at what the company can actually afford — with §Stage 4's
      // NPCs now drawing wages from the same company wallet on their own
      // weekly cadence, an insolvent employer is a real (if rare) outcome,
      // not just a hypothetical. A worker still shows up and does the work;
      // an employer that can't pay is harsh but shouldn't crash the game —
      // same "cap, don't throw" pattern as population/cadence.ts's own
      // weekly wage payment.
      const affordableWage = Math.max(0, Math.min(employment.wage, getBalance(ctx.db, jobSlot.companyId)));
      if (affordableWage > 0) {
        transferCoin(
          ctx.db,
          ctx.bus,
          jobSlot.companyId,
          ctx.actorId,
          affordableWage,
          ctx.tick,
          `${jobSlot.companyName} pays you ${affordableWage} coin for your shift.`,
        );
      }

      const qualityTier = 1 + Math.floor(getLevel(ctx.db, ctx.actorId, jobSlot.skill) / 2);
      const quantity = outcome.success ? GRAIN_YIELD_SUCCESS : GRAIN_YIELD_FAILURE;
      for (let i = 0; i < quantity; i++) {
        produceItem(ctx.db, ctx.bus, {
          id: `${jobSlot.companyId}-grain-${ctx.tick}-${i}`,
          type: 'grain',
          qualityTier,
          containerId: jobSlot.companyId,
          tick: ctx.tick,
          actorId: ctx.actorId,
          note: `Grain harvested at ${jobSlot.companyName}.`,
        });
      }
    },
  };
}
