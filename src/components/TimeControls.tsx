import type { GameClock, Speed } from '../hooks/useGameClock';

interface TimeControlsProps {
  clock: GameClock;
  actorId: string;
  hasActionInProgress: boolean;
}

const SPEEDS: Speed[] = ['paused', 1, 4, 16];

// §4.3: "pause / 1x / 4x / 16x plus skip-to-action-complete and
// skip-to-morning" — acceleration is always available offline/single-player.
export function TimeControls({ clock, actorId, hasActionInProgress }: TimeControlsProps) {
  return (
    <div className="time-controls">
      {SPEEDS.map((speed) => (
        <button
          key={speed}
          type="button"
          className={clock.speed === speed ? 'active' : ''}
          onClick={() => clock.setSpeed(speed)}
        >
          {speed === 'paused' ? 'Pause' : `${speed}×`}
        </button>
      ))}
      <button
        type="button"
        onClick={() => clock.skipToActionComplete(actorId)}
        disabled={!hasActionInProgress}
      >
        Skip to action done
      </button>
      <button type="button" onClick={clock.skipToMorning}>
        Skip to morning
      </button>
    </div>
  );
}
