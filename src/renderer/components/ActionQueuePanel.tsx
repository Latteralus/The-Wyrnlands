import { actionLabel } from '../../shared/gameRules';
import { useCommand } from '../sim/hooks';
import type { QueuedAction } from '../../shared/protocol';

interface ActionQueuePanelProps {
  active: QueuedAction[];
  currentTick: number;
  onError: (message: string) => void;
}

function progressFraction(action: QueuedAction, currentTick: number): number {
  if (action.status !== 'in_progress' || action.startedAtTick === null) return 0;
  const elapsed = currentTick - action.startedAtTick;
  return action.durationTicks > 0 ? Math.min(1, elapsed / action.durationTicks) : 1;
}

// The HUD's "current action + queue" view (§14.2 HUD, §4.3 timed actions):
// shows what the actor is doing now, its live progress, and what's queued
// behind it.
export function ActionQueuePanel({ active, currentTick, onError }: ActionQueuePanelProps) {
  const command = useCommand();

  if (active.length === 0) {
    return <p className="action-queue-empty">No action in progress.</p>;
  }

  const handleInterrupt = () => {
    command('player.interruptAction').catch((error: unknown) =>
      onError(error instanceof Error ? error.message : 'The action could not be stopped.'),
    );
  };

  return (
    <div className="action-queue">
      {active.map((action) => {
        const inProgress = action.status === 'in_progress';
        const fraction = progressFraction(action, currentTick);
        return (
          <div key={action.id} className="action-item">
            <span className="action-item-label">
              {inProgress ? 'Doing' : 'Queued'}: {actionLabel(action.type)}
            </span>
            {inProgress && (
              <div className="action-progress-bar">
                <div className="action-progress-fill" style={{ width: `${fraction * 100}%` }} />
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={handleInterrupt}
        disabled={!active[0] || active[0].status !== 'in_progress'}
      >
        Stop current action
      </button>
    </div>
  );
}
