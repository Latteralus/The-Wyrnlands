import { SPEEDS } from '../../shared/protocol';
import type { GameClock } from '../hooks/useGameClock';

interface TimeControlsProps {
  clock: GameClock;
  hasActionInProgress: boolean;
}

// §4.3: "pause / 1x / 4x / 16x plus skip-to-action-complete and
// skip-to-morning" — acceleration is always available offline/single-player.
export function TimeControls({ clock, hasActionInProgress }: TimeControlsProps) {
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
      <button type="button" onClick={clock.skipToActionComplete} disabled={!hasActionInProgress}>
        Skip to action done
      </button>
      <button type="button" onClick={clock.skipToMorning}>
        Skip to morning
      </button>
    </div>
  );
}
