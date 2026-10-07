import { recordLedgerEntry } from '../companies/companies';
import { wearCompanyTool } from '../companies/tools';
import { getEntityName } from '../entities';
import { findFirstActiveItem, listActiveItemsInContainer, transferItem } from '../inventory/items';
import { getBalance, transferCoin } from '../inventory/wallet';
import { getHouseholdIdForMember } from '../population/households';
import { getRecipeForSkill, inputPerShift } from '../production/recipes';
import { runProductionShift } from '../production/shift';
import { addXp, getLevel, getSuccessChance } from '../skills/skills';
import { getActiveEmploymentForSlot, getJobSlot } from './jobs';
import type { ActionDefinition } from '../actions/types';

// Shared with NPCs' batched weekly shifts (population/cadence.ts) — same rules.
export const TOOL_WEAR_PER_SHIFT = 3;
// Shared with NPC shifts (population/cadence.ts) — same rules.
export const SHIFT_XP = 40;

// A timed "work a shift" action bound to one job slot (§9.8: "workers
// commit timed shifts; presence = labor-ticks = production"). jobSlotId is
// baked in like createBuyActionDefinition bakes in (siteId, goodType); the
// employment/job-slot/tool state itself is looked up live at resolve time,
// same pattern. Production math comes from production/recipes.ts — the
// same table NPCs' daily shifts (population/cadence.ts) read — so the
// player's own shift can never drift out of sync with it the way it used
// to (this used to hardcode grain-specific yields directly here, which
// also meant a player working the *logging* job slot silently produced
// grain instead of firewood — a real latent bug, fixed by this unification,
// not something Stage 5 introduced).
export function createWorkShiftActionDefinition(
  jobSlotId: string,
  config: { durationTicks: number; scheduledNpc?: boolean; type?: string },
): ActionDefinition {
  const release = (ctx: Parameters<NonNullable<ActionDefinition['applyOutcome']>>[0]) => {
    const slot = getJobSlot(ctx.db, jobSlotId);
    if (!slot || !ctx.action) return;
    for (const item of listActiveItemsInContainer(ctx.db, `work-input:${ctx.action.id}`)) {
      transferItem(ctx.db, ctx.bus, item.id, slot.companyId, ctx.tick, {
        scope: 'business',
        note: 'Unused work materials returned.',
      });
    }
  };
  return {
    type: config.type ?? `work_shift_${jobSlotId}`,
    durationTicks: config.durationTicks,
    onStart: (ctx) => {
      const slot = getJobSlot(ctx.db, jobSlotId);
      if (slot)
        ctx.db.run(
          'UPDATE entities SET current_site_id = (SELECT site_id FROM companies WHERE id = ?) WHERE id = ?',
          [slot.companyId, ctx.actorId],
        );
    },
    ...(config.scheduledNpc
      ? ({
          onStart: (ctx) => {
            const slot = getJobSlot(ctx.db, jobSlotId);
            if (slot)
              ctx.db.run(
                'UPDATE entities SET current_site_id = (SELECT site_id FROM companies WHERE id = ?) WHERE id = ?',
                [slot.companyId, ctx.actorId],
              );
            const recipe = slot ? getRecipeForSkill(slot.skill) : null;
            if (!slot || !recipe?.inputGood || !ctx.action) return;
            const items = listActiveItemsInContainer(ctx.db, slot.companyId)
              .filter((i) => i.type === recipe.inputGood)
              .slice(0, inputPerShift(recipe));
            for (const item of items)
              transferItem(ctx.db, ctx.bus, item.id, `work-input:${ctx.action.id}`, ctx.tick, {
                actorId: ctx.actorId,
                scope: 'business',
                note: 'Materials committed to a production run.',
              });
          },
          onInterrupt: release,
        } satisfies Partial<ActionDefinition>)
      : {}),
    startMessage: (ctx) => {
      const jobSlot = getJobSlot(ctx.db, jobSlotId);
      return jobSlot
        ? `You head to ${jobSlot.companyName} for your shift as ${jobSlot.title.toLowerCase()}.`
        : 'You head off to work.';
    },
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

      // The pay the shift will bring (applyOutcome pays it): the agreed
      // wage, or whatever the employer can still afford.
      const pay = Math.max(0, Math.min(employment.wage, getBalance(ctx.db, jobSlot.companyId)));
      const paid = pay > 0 ? `and are paid ${pay} coin` : `but ${jobSlot.companyName} can't pay you today`;
      const chance = getSuccessChance(ctx.db, ctx.actorId, jobSlot.skill);
      return rng() < chance
        ? {
            success: true,
            message: `You finish your shift at ${jobSlot.companyName} — solid work — ${paid}.`,
          }
        : {
            success: false,
            message: `A poor shift at ${jobSlot.companyName}: the work goes badly, half of it wasted. You finish ${paid.replace(/^and are/, 'and are still').replace(/^but/, 'but')}.`,
          };
    },
    applyOutcome: (ctx, outcome) => {
      if (outcome.data?.reason === 'no_tool') {
        release(ctx);
        return;
      }

      const employment = getActiveEmploymentForSlot(ctx.db, ctx.actorId, jobSlotId);
      if (!employment) {
        release(ctx);
        return;
      }
      const jobSlot = getJobSlot(ctx.db, jobSlotId);
      if (!jobSlot) return;

      // §13.2: "each labor-tick grants XP" regardless of the attempt's
      // outcome (a failed skill check still teaches something).
      if (!config.scheduledNpc) addXp(ctx.db, ctx.actorId, jobSlot.skill, SHIFT_XP);
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
          config.scheduledNpc ? (getHouseholdIdForMember(ctx.db, ctx.actorId) ?? ctx.actorId) : ctx.actorId,
          affordableWage,
          ctx.tick,
          `${jobSlot.companyName} pays you ${affordableWage} coin for your shift.`,
          config.scheduledNpc ? 'business' : 'personal',
        );
        recordLedgerEntry(ctx.db, jobSlot.companyId, ctx.tick, 'wage', affordableWage, 'Shift wage.');
      }

      const recipe = getRecipeForSkill(jobSlot.skill);
      if (!recipe) {
        release(ctx);
        return;
      }

      const made = runProductionShift(ctx.db, ctx.bus, {
        companyId: jobSlot.companyId,
        companyName: jobSlot.companyName,
        workerId: ctx.actorId,
        recipe,
        succeeded: outcome.success,
        qualityTier: 1 + Math.floor(getLevel(ctx.db, ctx.actorId, jobSlot.skill) / 2),
        tick: ctx.tick,
        scope: config.scheduledNpc ? 'business' : 'personal',
        ...(config.scheduledNpc && ctx.action ? { inputContainerId: `work-input:${ctx.action.id}` } : {}),
      });
      if (config.scheduledNpc) {
        addXp(ctx.db, ctx.actorId, jobSlot.skill, SHIFT_XP);
        release(ctx);
        ctx.bus.emit({
          tick: ctx.tick,
          scope: 'business',
          actorId: jobSlot.companyId,
          type: 'business.workday',
          message: `1 hand works a shift (${getEntityName(ctx.db, ctx.actorId)}), turning out ${made} ${recipe.outputGood}; ${affordableWage} coin paid.`,
          data: { hands: 1, wages: affordableWage, made: { [recipe.outputGood]: made } },
        });
      }
    },
  };
}
