import type { EventBus } from '../eventBus';
import type { Rng } from '../rng';
import type { Database } from 'sql.js';

export type ActionStatus = 'queued' | 'in_progress' | 'complete' | 'failed' | 'interrupted' | 'cancelled';

export interface ActionOutcome {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
  // The completion line is left out of the log because applyOutcome writes
  // a fuller one once it knows the result (a purchase: whose stock, at what
  // price).
  quiet?: boolean;
}

// Read/write access resolve()/applyOutcome() get at resolution time — a
// skill check needs to read the actor's skill row, a gather action needs to
// produce an item. Kept as a narrow bundle (not the full Engine) so action
// definitions stay engine-internal plumbing, not a second UI surface.
export interface ActionEffectContext {
  db: Database;
  bus: EventBus;
  actorId: string;
  tick: number;
}

export interface ActionDefinition {
  type: string;
  durationTicks: number;
  // A line for the actor's log when they set about it ("You head to Oster
  // Farm for your shift.") — omit it and starting is bookkeeping, not news:
  // the completion line tells the story.
  startMessage?: (ctx: ActionEffectContext) => string;
  // Needs this action restores steadily while it's under way, per tick, in
  // place of their usual decay (needs.ts) — sleep restores energy through
  // the night rather than letting it run down until the moment you wake.
  restoresPerTick?: Partial<Record<'hunger' | 'thirst' | 'energy' | 'warmth', number>>;
  // Called once, when the action's duration has elapsed. Draws from the
  // engine's seeded RNG so outcomes stay reproducible for a given seed;
  // ctx is read access for skill/gear checks, not a place to mutate state.
  resolve: (rng: Rng, ctx: ActionEffectContext) => ActionOutcome;
  // Optional: apply the mechanical consequences of the outcome (produce/
  // consume items, restore needs, spend coin, wear gear...) once it's known.
  // Separate from resolve() so resolve() stays focused on "did it work,"
  // not "what happens as a result."
  applyOutcome?: (ctx: ActionEffectContext, outcome: ActionOutcome) => void;
}

export interface QueuedAction {
  id: number;
  actorId: string;
  type: string;
  status: ActionStatus;
  queuedAtTick: number;
  startedAtTick: number | null;
  endsAtTick: number | null;
  durationTicks: number;
  progressTicks: number;
  outcome: ActionOutcome | null;
  sequence: number;
}
