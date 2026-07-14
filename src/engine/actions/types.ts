import type { Rng } from '../rng';

export type ActionStatus = 'queued' | 'in_progress' | 'complete' | 'failed' | 'interrupted';

export interface ActionOutcome {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

export interface ActionDefinition {
  type: string;
  durationTicks: number;
  // Called once, when the action's duration has elapsed. Draws from the
  // engine's seeded RNG so outcomes stay reproducible for a given seed.
  resolve: (rng: Rng) => ActionOutcome;
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
