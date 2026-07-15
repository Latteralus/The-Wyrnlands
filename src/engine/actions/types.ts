import type { EventBus } from '../eventBus';
import type { Rng } from '../rng';
import type { Database } from 'sql.js';

export type ActionStatus = 'queued' | 'in_progress' | 'complete' | 'failed' | 'interrupted' | 'cancelled';

export interface ActionOutcome {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
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
