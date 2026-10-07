import {
  cancelQueuedActions,
  enqueueAction,
  getCurrentAction,
  interruptCurrentAction,
} from '../actions/actionQueue';
import { getCompany } from '../companies/companies';
import { companyNeedsSupplies, purchaseCompanySupplies } from '../companies/decisions';
import { queryRow, queryRows } from '../db/sqlite';
import { createEntity, getEntityName, isBackgroundActor } from '../entities';
import { getGoodDefinition } from '../goods/catalog';
import { countActiveItemsOfType, listActiveItemsInContainer, transferItem } from '../inventory/items';
import { getBalance } from '../inventory/wallet';
import {
  applyForJob,
  countActiveEmploymentsForSlot,
  getActiveEmployment,
  getJobSlot,
  listJobSlotsForCompany,
} from '../jobs/jobs';
import { createWorkShiftActionDefinition } from '../jobs/shifts';
import { buyFromMarket, getListing, sellSurplusToMarket } from '../market/market';
import { applyMerchantTrade } from '../market/merchant';
import { getRecipeForSkill, listRecipes } from '../production/recipes';
import { travelDurationTicks } from '../world/grid';
import { distanceBetweenSites, getSite } from '../world/sites';
import {
  applyNpcJobSeekingWeeklyCadence,
  eatNpcMeal,
  evaluateHouseholdBudget,
  isWorkday,
  poolMemberCoin,
  restNpc,
} from './cadence';
import { getHousehold, getHouseholdIdForMember, listHouseholdMembers } from './households';
import { drawWater, stockUpOnBread, supplyDays, WATER_PAILS_PER_PERSON_PER_DAY } from './provisions';
import type { ActionDefinition, ActionEffectContext } from '../actions/types';
import type { Engine } from '../engine';
import type { EngineEvent } from '../eventBus';

// All wakeups are ordinary actions. No heap, timer table, or per-minute NPC
// decisions: completion/interrupt -> choose once -> commit a timed activity.
const DAY = 1440;
const RETRY = 180;
const WORK_PREFIX = 'settlement:work:';
const OFFICE = 'settlement-labor-office';
const MERCHANT = 'merchant';

export function activityOffset(id: string, range: number): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (Math.imul(hash, 31) + id.charCodeAt(i)) >>> 0;
  return hash % range;
}

export class SettlementActivities {
  private detach: () => void;
  private engine: Engine;

  constructor(engine: Engine) {
    this.engine = engine;
    this.register();
    for (const row of queryRows(
      engine.db,
      "SELECT DISTINCT type FROM actions WHERE type LIKE 'settlement:work:%' AND status IN ('queued', 'in_progress')",
    )) {
      this.ensureWork(String(row[0]).slice(WORK_PREFIX.length));
    }
    this.detach = engine.bus.subscribe((event) => this.changed(event));
  }

  dispose(): void {
    this.detach();
  }

  private queue(
    actorId: string,
    type: string,
    tick: number,
    duration: number,
    payload: Record<string, unknown> = {},
  ): void {
    enqueueAction(this.engine.db, this.engine.actions, actorId, type, tick, {
      durationTicks: Math.max(1, duration),
      payload,
      transient: true,
    });
  }

  // An hourly membership reconciliation only discovers newly created actors;
  // existing actors already have a persisted action and are never reconsidered.
  reconcile(tick: number): void {
    const db = this.engine.db;
    db.run(`INSERT INTO settlement_activity_state(actor_id) SELECT id FROM households
      WHERE NOT EXISTS (SELECT 1 FROM settlement_activity_state WHERE actor_id = households.id)`);
    for (const row of queryRows(
      db,
      `SELECT entities.id, households.home_site_id FROM entities
      JOIN household_members ON household_members.entity_id = entities.id
      JOIN households ON households.id = household_members.household_id
      WHERE entities.simulation_mode = 'background' AND households.departed_at_tick IS NULL
        AND NOT EXISTS (SELECT 1 FROM settlement_activity_state WHERE actor_id = entities.id)
      ORDER BY entities.id`,
    )) {
      const id = String(row[0]);
      db.run('INSERT INTO settlement_activity_state(actor_id) VALUES (?)', [id]);
      db.run('UPDATE entities SET current_site_id = COALESCE(current_site_id, ?) WHERE id = ?', [
        String(row[1]),
        id,
      ]);
      if (!getCurrentAction(db, id)) this.plan(id, tick);
    }
    for (const row of queryRows(
      db,
      `SELECT id FROM companies WHERE closed_at_tick IS NULL
      AND NOT EXISTS (SELECT 1 FROM settlement_activity_state WHERE actor_id = companies.id) ORDER BY id`,
    )) {
      const id = String(row[0]);
      db.run('INSERT INTO settlement_activity_state(actor_id) VALUES (?)', [id]);
      this.plan(id, tick);
    }
    if (getSite(db, 'market')) {
      for (const id of [OFFICE, MERCHANT]) {
        createEntity(db, id, id === OFFICE ? 'Settlement labor exchange' : 'Travelling merchant');
        if (!queryRow(db, 'SELECT 1 FROM settlement_activity_state WHERE actor_id = ?', [id])) {
          db.run('INSERT INTO settlement_activity_state(actor_id) VALUES (?)', [id]);
          this.plan(id, tick);
        }
      }
    }
  }

  private travelTicks(from: string | null, to: string, cargo = false): number {
    const db = this.engine.db;
    if (!from || from === to || !getSite(db, from) || !getSite(db, to)) return 0;
    return travelDurationTicks(distanceBetweenSites(db, from, to), {
      mode: cargo ? 'handcart' : 'foot',
      cargoLoadFraction: cargo ? 0.5 : 0,
      season: this.engine.calendar.season,
    });
  }

  private at(actorId: string, siteId: string, tick: number): boolean {
    const current = queryRow(this.engine.db, 'SELECT current_site_id FROM entities WHERE id = ?', [
      actorId,
    ])?.[0];
    if (current === siteId) return true;
    if (!getSite(this.engine.db, siteId)) return true; // isolated engine fixtures can have no sites
    this.queue(
      actorId,
      'settlement:travel',
      tick,
      this.travelTicks(typeof current === 'string' ? current : null, siteId),
      { destination: siteId, origin: typeof current === 'string' ? current : null },
    );
    return false;
  }

  private wait(
    actorId: string,
    tick: number,
    until: number,
    label = 'At home',
    waitingFor: string | null = null,
  ): void {
    this.queue(actorId, 'settlement:wait', tick, until - tick, { label, waitingFor });
  }

  plan(actorId: string, tick: number, knownIdle = false): void {
    const db = this.engine.db;
    if (!knownIdle && getCurrentAction(db, actorId)) return;
    if (!queryRow(db, 'SELECT 1 FROM settlement_activity_state WHERE actor_id = ?', [actorId])) return;
    const day = Math.floor(tick / DAY);
    const minute = tick % DAY;
    const base = day * DAY;
    if (actorId === OFFICE) {
      this.queue(
        actorId,
        'settlement:hiring',
        tick,
        minute < 8 * 60 ? 8 * 60 - minute : DAY - minute + 8 * 60,
      );
      return;
    }
    if (actorId === MERCHANT) {
      // One visit/day preserves the daily import/export cap. Loading and the
      // road take time; new shortages cannot summon an unlimited merchant.
      this.queue(
        actorId,
        'settlement:merchant',
        tick,
        minute < 11 * 60 ? 11 * 60 - minute : DAY - minute + 11 * 60,
        { label: 'Merchant travelling to market' },
      );
      return;
    }
    const company = getCompany(db, actorId);
    if (company) {
      this.planCompany(actorId, tick);
      return;
    }
    if (!isBackgroundActor(db, actorId)) return;
    const householdId = getHouseholdIdForMember(db, actorId);
    const household = householdId ? getHousehold(db, householdId) : null;
    if (!household || household.departedAtTick !== null) return;
    const state = queryRow(
      db,
      `SELECT last_shift_day, last_meal_day, last_rest_day, last_visit_day,
      last_supply_tick, offered_job_slot_id FROM settlement_activity_state WHERE actor_id = ?`,
      [actorId],
    );
    if (!state) return;
    const home = household.homeSiteId;
    const dinner = 18 * 60 + activityOffset(actorId, 90);
    const sleep = 22 * 60;
    const dawn = 6 * 60 + activityOffset(actorId, 90);
    if (listActiveItemsInContainer(db, `errand:${actorId}`).length > 0) {
      if (!this.at(actorId, home, tick)) return;
      this.queue(actorId, 'settlement:unload', tick, 10, { householdId: household.id });
      return;
    }
    if (minute < dawn) {
      if (!this.at(actorId, home, tick)) return;
      this.queue(actorId, 'settlement:rest', tick, dawn - minute);
      return;
    }
    if (minute >= sleep && state[1] === day) {
      if (!this.at(actorId, home, tick)) return;
      this.queue(actorId, 'settlement:rest', tick, DAY - minute + dawn);
      return;
    }
    if (typeof state[5] === 'string') {
      const offered = getJobSlot(db, state[5]);
      if (
        offered &&
        !getActiveEmployment(db, actorId) &&
        countActiveEmploymentsForSlot(db, offered.id) < offered.capacity
      ) {
        const destination = getSite(db, 'notice_board')
          ? 'notice_board'
          : (getCompany(db, offered.companyId)?.siteId ?? home);
        if (!this.at(actorId, destination, tick)) return;
        this.queue(actorId, 'settlement:seek_work', tick, 30);
        return;
      }
      db.run('UPDATE settlement_activity_state SET offered_job_slot_id = NULL WHERE actor_id = ?', [actorId]);
    }
    const members = listHouseholdMembers(db, household.id).filter((id) => isBackgroundActor(db, id));
    // An unemployed member does errands while the others work. Every family
    // has exactly one shopper, preventing duplicate stock orders.
    const shopper = members.find((id) => !getActiveEmployment(db, id)) ?? members[0];
    const pails = Math.ceil(members.length * WATER_PAILS_PER_PERSON_PER_DAY);
    const wantsShopping =
      countActiveItemsOfType(db, household.id, 'bread') < members.length * supplyDays('bread', false) ||
      (this.engine.calendar.season === 'winter' &&
        countActiveItemsOfType(db, household.id, 'firewood') === 0);
    const errandsDue =
      minute < dinner ||
      (state[1] !== day && countActiveItemsOfType(db, household.id, 'bread') < members.length);
    if (shopper === actorId && errandsDue && minute < sleep && tick - Number(state[4]) >= RETRY) {
      if (countActiveItemsOfType(db, household.id, 'water') < pails * 2 && getSite(db, 'well')) {
        if (!this.at(actorId, 'well', tick)) return;
        this.queue(actorId, 'settlement:water', tick, 20, { householdId: household.id });
        return;
      }
      if (wantsShopping) {
        if (!this.at(actorId, 'market', tick)) return;
        this.queue(actorId, 'settlement:shopping', tick, 20, { householdId: household.id });
        db.run('UPDATE settlement_activity_state SET last_supply_tick = ? WHERE actor_id = ?', [
          tick,
          actorId,
        ]);
        return;
      }
    }
    const employment = getActiveEmployment(db, actorId);
    const slot = employment ? getJobSlot(db, employment.jobSlotId) : null;
    const employer = employment ? getCompany(db, employment.companyId) : null;
    const shiftStart = 7 * 60 + activityOffset(actorId, 120);
    // Day zero is the first workday. The historical midnight pass used the
    // following day's number; +DAY preserves six shifts in each seven days.
    const workday = isWorkday(tick + DAY);
    if (workday && slot && employer?.closedAtTick === null && state[0] !== day && minute < 15 * 60) {
      const depart = shiftStart - this.travelTicks(home, employer.siteId);
      if (minute >= depart) {
        const recipe = getRecipeForSkill(slot.skill);
        const tool = !slot.toolGoodType || countActiveItemsOfType(db, employer.id, slot.toolGoodType) > 0;
        const input =
          !recipe?.inputGood ||
          countActiveItemsOfType(db, employer.id, recipe.inputGood) >= recipe.inputUnits;
        if (tool && input) {
          if (!this.at(actorId, employer.siteId, tick)) return;
          if (minute < shiftStart) {
            this.wait(actorId, tick, base + shiftStart, 'Waiting for shift');
            return;
          }
          const type = this.ensureWork(slot.id);
          db.run('UPDATE settlement_activity_state SET last_shift_day = ? WHERE actor_id = ?', [
            day,
            actorId,
          ]);
          this.queue(actorId, type, tick, slot.shiftDurationTicks, { label: `Working at ${employer.name}` });
          return;
        }
      }
    }
    if (minute >= dinner && state[1] !== day) {
      if (!this.at(actorId, home, tick)) return;
      this.queue(actorId, 'settlement:eating', tick, 20);
      return;
    }
    if (
      minute >= 19 * 60 &&
      minute < 21 * 60 &&
      state[3] !== day &&
      activityOffset(actorId, 2) === 0 &&
      getSite(db, 'tavern')
    ) {
      if (!this.at(actorId, 'tavern', tick)) return;
      db.run('UPDATE settlement_activity_state SET last_visit_day = ? WHERE actor_id = ?', [day, actorId]);
      this.queue(actorId, 'settlement:visit', tick, 60);
      return;
    }
    if (!this.at(actorId, home, tick)) return;
    const boundaries = [base + dinner, base + 19 * 60, base + sleep];
    if (workday && slot && state[0] !== day && minute < 15 * 60) {
      boundaries.push(base + shiftStart - this.travelTicks(home, employer?.siteId ?? home));
      boundaries.push(tick + RETRY);
    }
    if (shopper === actorId && errandsDue && minute < sleep && wantsShopping)
      boundaries.push(Math.max(tick + 1, Number(state[4]) + RETRY));
    const waitingFor =
      shopper === actorId && wantsShopping
        ? 'bread'
        : slot && state[0] !== day
          ? (getRecipeForSkill(slot.skill)?.inputGood ?? slot.toolGoodType)
          : null;
    const next = boundaries.filter((t) => t > tick);
    this.wait(
      actorId,
      tick,
      next.length ? Math.min(...next) : base + DAY + 6 * 60,
      'At home',
      waitingFor ?? null,
    );
  }

  private planCompany(actorId: string, tick: number): void {
    const db = this.engine.db;
    const company = getCompany(db, actorId);
    if (!company || company.closedAtTick !== null || !getSite(db, 'market')) return;
    const minute = tick % DAY;
    const opening = 6 * 60 + activityOffset(actorId, 90);
    if (minute < opening || minute >= 21 * 60) {
      this.wait(
        actorId,
        tick,
        Math.floor(tick / DAY) * DAY + (minute < opening ? opening : DAY + opening),
        'Business closed for the night',
      );
      return;
    }
    const state = queryRow(
      db,
      'SELECT last_supply_tick, last_delivery_tick FROM settlement_activity_state WHERE actor_id = ?',
      [actorId],
    );
    const trip = this.travelTicks(company.siteId, 'market', true);
    if (
      state &&
      tick - Number(state[0]) >= RETRY &&
      companyNeedsSupplies(db, company, tick, Math.floor(Number(state[0]) / DAY) < Math.floor(tick / DAY))
    ) {
      db.run('UPDATE settlement_activity_state SET last_supply_tick = ? WHERE actor_id = ?', [tick, actorId]);
      this.queue(actorId, 'settlement:supplies', tick, 30 + 2 * trip, {
        label: 'Purchasing and delivering supplies',
      });
      return;
    }
    const outputs = new Set(
      listJobSlotsForCompany(db, actorId)
        .map((slot) => getRecipeForSkill(slot.skill)?.outputGood)
        .filter((good): good is string => !!good),
    );
    if ([...outputs].some((good) => countActiveItemsOfType(db, actorId, good) > 0)) {
      db.run('UPDATE settlement_activity_state SET last_delivery_tick = ? WHERE actor_id = ?', [
        tick,
        actorId,
      ]);
      this.queue(actorId, 'settlement:delivery', tick, trip + 20, { label: 'Delivering goods to market' });
      return;
    }
    this.wait(
      actorId,
      tick,
      Math.min(tick + RETRY, Math.floor(tick / DAY) * DAY + 21 * 60),
      'Business awaiting orders or output',
    );
  }

  private ensureWork(slotId: string): string {
    const type = WORK_PREFIX + slotId;
    if (!this.engine.actions.has(type)) {
      const slot = getJobSlot(this.engine.db, slotId);
      if (!slot) throw new Error(`Missing scheduled work slot: ${slotId}`);
      this.engine.actions.register(
        createWorkShiftActionDefinition(slotId, {
          durationTicks: slot.shiftDurationTicks,
          scheduledNpc: true,
          type,
        }),
      );
    }
    return type;
  }

  private register(): void {
    const register = (type: string, effects: Partial<ActionDefinition> = {}) =>
      this.engine.actions.register({
        type: `settlement:${type}`,
        durationTicks: 1,
        resolve: () => ({ success: true, message: '', quiet: true }),
        ...effects,
      });
    register('wait');
    register('travel', {
      onStart: (ctx) => ctx.db.run('UPDATE entities SET current_site_id = NULL WHERE id = ?', [ctx.actorId]),
      onInterrupt: (ctx) =>
        ctx.db.run('UPDATE entities SET current_site_id = ? WHERE id = ?', [
          typeof ctx.action?.payload?.origin === 'string' ? ctx.action.payload.origin : null,
          ctx.actorId,
        ]),
      applyOutcome: (ctx) =>
        ctx.db.run('UPDATE entities SET current_site_id = ? WHERE id = ?', [
          String(ctx.action?.payload?.destination),
          ctx.actorId,
        ]),
    });
    register('rest', {
      applyOutcome: (ctx) => {
        const day = Math.floor(ctx.tick / DAY);
        const last = queryRow(
          ctx.db,
          'SELECT last_rest_day FROM settlement_activity_state WHERE actor_id = ?',
          [ctx.actorId],
        )?.[0];
        if (last !== day) {
          restNpc(ctx.db, ctx.actorId);
          ctx.db.run('UPDATE settlement_activity_state SET last_rest_day = ? WHERE actor_id = ?', [
            day,
            ctx.actorId,
          ]);
        }
      },
    });
    register('visit');
    register('eating', {
      applyOutcome: (ctx) =>
        eatNpcMeal(ctx.db, ctx.bus, ctx.actorId, ctx.tick, this.engine.calendar.season === 'winter'),
    });
    register('water', {
      applyOutcome: (ctx) => {
        const householdId = String(ctx.action?.payload?.householdId);
        const size = listHouseholdMembers(ctx.db, householdId).filter((id) =>
          isBackgroundActor(ctx.db, id),
        ).length;
        const target =
          Math.ceil(size * WATER_PAILS_PER_PERSON_PER_DAY) * (supplyDays('water', false) + 1) -
          countActiveItemsOfType(ctx.db, householdId, 'water');
        drawWater(ctx.db, ctx.bus, `errand:${ctx.actorId}`, target, ctx.tick, ctx.actorId);
      },
    });
    register('unload', {
      applyOutcome: (ctx) => {
        for (const item of listActiveItemsInContainer(ctx.db, `errand:${ctx.actorId}`))
          transferItem(ctx.db, ctx.bus, item.id, String(ctx.action?.payload?.householdId), ctx.tick, {
            actorId: ctx.actorId,
            scope: 'business',
            note: 'Supplies carried home.',
          });
      },
    });
    register('shopping', { applyOutcome: (ctx) => this.shop(ctx) });
    register('supplies', {
      applyOutcome: (ctx) => {
        const company = getCompany(ctx.db, ctx.actorId);
        if (company) purchaseCompanySupplies(ctx.db, ctx.bus, company, ctx.tick);
      },
    });
    register('delivery', {
      onStart: (ctx) => {
        const goods = new Set(
          listJobSlotsForCompany(ctx.db, ctx.actorId).map(
            (slot) => getRecipeForSkill(slot.skill)?.outputGood,
          ),
        );
        for (const item of listActiveItemsInContainer(ctx.db, ctx.actorId)) {
          if (goods.has(item.type))
            transferItem(ctx.db, ctx.bus, item.id, `freight:${ctx.actorId}`, ctx.tick, {
              actorId: ctx.actorId,
              scope: 'business',
              note: 'Loaded for market delivery.',
            });
        }
      },
      onInterrupt: (ctx) => this.returnFreight(ctx),
      applyOutcome: (ctx) => {
        const company = getCompany(ctx.db, ctx.actorId);
        if (!company || company.closedAtTick !== null) {
          this.returnFreight(ctx);
          return;
        }
        const goods = new Map<string, number>();
        for (const item of listActiveItemsInContainer(ctx.db, `freight:${ctx.actorId}`))
          goods.set(item.type, (goods.get(item.type) ?? 0) + 1);
        for (const [good, quantity] of goods)
          sellSurplusToMarket(
            ctx.db,
            ctx.bus,
            ctx.actorId,
            'market',
            good,
            quantity,
            getListing(ctx.db, 'market', good)?.price ?? getGoodDefinition(good).basePrice,
            ctx.tick,
            `freight:${ctx.actorId}`,
          );
      },
    });
    register('merchant', { applyOutcome: (ctx) => applyMerchantTrade(ctx.db, ctx.bus, ctx.tick) });
    register('hiring', {
      applyOutcome: (ctx) =>
        applyNpcJobSeekingWeeklyCadence(
          ctx.db,
          ctx.bus,
          ctx.tick,
          () => this.engine.nextRandom(),
          (id, slot, strained) => {
            ctx.db.run(
              'UPDATE settlement_activity_state SET offered_job_slot_id = ?, offered_for_hardship = ? WHERE actor_id = ?',
              [slot, strained ? 1 : 0, id],
            );
            this.wake(id, ctx.tick);
          },
        ),
    });
    register('seek_work', {
      applyOutcome: (ctx) => {
        const state = queryRow(
          ctx.db,
          'SELECT offered_job_slot_id, offered_for_hardship FROM settlement_activity_state WHERE actor_id = ?',
          [ctx.actorId],
        );
        const slot = typeof state?.[0] === 'string' ? getJobSlot(ctx.db, state[0]) : null;
        ctx.db.run('UPDATE settlement_activity_state SET offered_job_slot_id = NULL WHERE actor_id = ?', [
          ctx.actorId,
        ]);
        const company = slot ? getCompany(ctx.db, slot.companyId) : null;
        if (
          !slot ||
          company?.closedAtTick !== null ||
          getActiveEmployment(ctx.db, ctx.actorId) ||
          countActiveEmploymentsForSlot(ctx.db, slot.id) >= slot.capacity
        )
          return;
        applyForJob(
          ctx.db,
          ctx.bus,
          ctx.actorId,
          slot.id,
          ctx.tick,
          { haggle: this.engine.nextRandom() < 0.5, scope: 'settlement' },
          () => this.engine.nextRandom(),
        );
        const householdId = getHouseholdIdForMember(ctx.db, ctx.actorId);
        if (state?.[1] && householdId)
          ctx.bus.emit({
            tick: ctx.tick,
            scope: 'settlement',
            actorId: householdId,
            type: 'household.hardship.member_works',
            message: `${getEntityName(ctx.db, ctx.actorId)} takes on work to help the household through a hard stretch.`,
            data: { entityId: ctx.actorId, jobSlotId: slot.id },
          });
      },
    });
  }

  private returnFreight(ctx: ActionEffectContext): void {
    for (const item of listActiveItemsInContainer(ctx.db, `freight:${ctx.actorId}`))
      transferItem(ctx.db, ctx.bus, item.id, ctx.actorId, ctx.tick, {
        scope: 'business',
        note: 'Cancelled delivery returned to storage.',
      });
  }

  private shop(ctx: ActionEffectContext): void {
    const id = String(ctx.action?.payload?.householdId);
    const household = getHousehold(ctx.db, id);
    if (!household || household.departedAtTick !== null) return;
    const members = listHouseholdMembers(ctx.db, id).filter((member) => isBackgroundActor(ctx.db, member));
    poolMemberCoin(ctx.db, ctx.bus, household, members, ctx.tick);
    const day = Math.floor(ctx.tick / DAY);
    const last = queryRow(
      ctx.db,
      'SELECT last_budget_day FROM settlement_activity_state WHERE actor_id = ?',
      [id],
    )?.[0];
    if (last !== day) {
      const before = getBalance(ctx.db, id);
      evaluateHouseholdBudget(ctx.db, ctx.bus, household, members.length, ctx.tick);
      // Rechecking before spending is not itself receiving relief. If the
      // purchase creates an urgent need later today, it can still seek help;
      // a real sale/alms transfer is limited to once per day.
      if (getBalance(ctx.db, id) !== before)
        ctx.db.run('UPDATE settlement_activity_state SET last_budget_day = ? WHERE actor_id = ?', [day, id]);
    }
    const target = members.length * (supplyDays('bread', getBalance(ctx.db, id) > 150) + 1);
    stockUpOnBread(
      ctx.db,
      ctx.bus,
      id,
      target,
      0,
      ctx.tick,
      `${household.name} shops for bread.`,
      `errand:${ctx.actorId}`,
    );
    if (this.engine.calendar.season === 'winter' && countActiveItemsOfType(ctx.db, id, 'firewood') === 0) {
      const fuel = getListing(ctx.db, 'market', 'firewood');
      if (fuel && fuel.quantity > 0 && getBalance(ctx.db, id) >= fuel.price) {
        buyFromMarket(ctx.db, ctx.bus, id, 'market', 'firewood', 1, ctx.tick, {
          scope: 'business',
          note: `${household.name} buys hearth fuel.`,
          destinationContainerId: `errand:${ctx.actorId}`,
        });
      }
    }
  }

  private wake(actorId: string, tick: number, delay = 15): void {
    // Only a waiting decision is advanced. Work, travel, sleep, and committed
    // purchases keep their real end ticks. Repeated events coalesce in one row.
    this.engine.db.run(
      `UPDATE actions SET ends_at_tick = MIN(ends_at_tick, ?),
      duration_ticks = MIN(duration_ticks, MAX(1, ? - started_at_tick))
      WHERE actor_id = ? AND type IN ('settlement:wait', 'settlement:hiring') AND status = 'in_progress'`,
      [tick + delay, tick + delay, actorId],
    );
  }

  private changed(event: EngineEvent): void {
    const db = this.engine.db;
    const tick = event.tick;
    if (event.type === 'coin.transferred' || event.type === 'coin.faucet' || event.type === 'coin.sink') {
      // Intraday sales reset a cash-crunch clock immediately. Observing only
      // midnight cash falsely called a shop continuously insolvent even when
      // it earned and spent money every morning.
      const ids =
        event.type === 'coin.transferred'
          ? [String(event.data?.from), String(event.data?.to)]
          : [event.actorId ?? ''];
      for (const id of ids) {
        const changed = queryRow(
          db,
          `UPDATE companies SET insolvent_since_tick =
          CASE WHEN (SELECT balance FROM wallets WHERE owner_id = companies.id) <= 0 THEN ? ELSE NULL END
          WHERE id = ? AND closed_at_tick IS NULL AND
            (((SELECT balance FROM wallets WHERE owner_id = companies.id) <= 0 AND insolvent_since_tick IS NULL)
              OR ((SELECT balance FROM wallets WHERE owner_id = companies.id) > 0 AND insolvent_since_tick IS NOT NULL))
          RETURNING name, insolvent_since_tick`,
          [tick, id],
        );
        if (changed && changed[1] !== null) {
          const day = Math.floor(tick / DAY);
          const last = queryRow(
            db,
            'SELECT last_distress_day FROM settlement_activity_state WHERE actor_id = ?',
            [id],
          )?.[0];
          if (last !== day) {
            db.run('UPDATE settlement_activity_state SET last_distress_day = ? WHERE actor_id = ?', [
              day,
              id,
            ]);
            this.engine.bus.emit({
              tick,
              scope: 'settlement',
              actorId: id,
              type: 'business.distressed',
              message: `${String(changed[0])} has run out of coin.`,
              data: {},
            });
          }
        }
      }
    }
    if (event.type === 'job.quit' && event.actorId) {
      const action = getCurrentAction(db, event.actorId);
      if (action?.type.startsWith(WORK_PREFIX)) {
        interruptCurrentAction(db, this.engine.bus, event.actorId, tick, this.engine.actions);
        cancelQueuedActions(db, this.engine.bus, event.actorId, tick);
        this.plan(event.actorId, tick);
      } else this.wake(event.actorId, tick);
      this.wake(OFFICE, tick, 60);
    }
    if ((event.type === 'business.closed' || event.type === 'company.closing') && event.actorId) {
      interruptCurrentAction(db, this.engine.bus, event.actorId, tick, this.engine.actions);
      cancelQueuedActions(db, this.engine.bus, event.actorId, tick);
    }
    if (
      event.type === 'business.founded' ||
      event.type === 'business.upgraded' ||
      event.type === 'company.hiring'
    )
      this.wake(OFFICE, tick, 60);
    if (event.type === 'job.hired' && event.actorId) this.wake(event.actorId, tick);
    if (
      event.type === 'business.workday' ||
      event.type === 'business.bought' ||
      event.type === 'business.sold' ||
      event.type === 'company.equipment_purchased'
    ) {
      if (event.actorId) this.wake(event.actorId, tick);
      if (
        (event.type === 'business.bought' || event.type === 'company.equipment_purchased') &&
        event.actorId
      ) {
        for (const row of queryRows(
          db,
          "SELECT entity_id FROM employment WHERE company_id = ? AND status = 'active' ORDER BY entity_id",
          [event.actorId],
        ))
          this.wake(String(row[0]), tick);
      }
    }
    if (
      event.type === 'business.consigned' ||
      event.type === 'market.imported' ||
      event.type === 'business.direct_sale'
    ) {
      // Wake only blocked shoppers/buyers interested in this good. The SQL
      // update coalesces hundreds of item transfers into one decision wakeup.
      const good = typeof event.data?.goodType === 'string' ? event.data.goodType : '';
      db.run(
        `UPDATE actions SET ends_at_tick = MIN(ends_at_tick, ?), duration_ticks = MIN(duration_ticks, MAX(1, ? - started_at_tick))
        WHERE type = 'settlement:wait' AND status = 'in_progress' AND json_extract(payload, '$.waitingFor') = ?`,
        [tick + 15, tick + 15, good],
      );
      const skills = listRecipes()
        .filter((recipe) => recipe.inputGood === good)
        .map((recipe) => recipe.skill);
      for (const skill of skills)
        db.run(
          `UPDATE actions SET ends_at_tick = MIN(ends_at_tick, ?), duration_ticks = MIN(duration_ticks, MAX(1, ? - started_at_tick))
        WHERE type = 'settlement:wait' AND status = 'in_progress' AND actor_id IN (SELECT company_id FROM job_slots WHERE skill = ?)`,
          [tick + 15, tick + 15, skill],
        );
    }
    if (event.type === 'household.departing' && event.actorId) {
      for (const id of listHouseholdMembers(db, event.actorId)) {
        db.run('UPDATE settlement_activity_state SET offered_job_slot_id = NULL WHERE actor_id = ?', [id]);
        interruptCurrentAction(db, this.engine.bus, id, tick, this.engine.actions);
        cancelQueuedActions(db, this.engine.bus, id, tick);
        for (const item of listActiveItemsInContainer(db, `errand:${id}`))
          transferItem(db, this.engine.bus, item.id, event.actorId, tick, {
            scope: 'business',
            note: 'Travel supplies returned before departure.',
          });
      }
    }
  }
}
