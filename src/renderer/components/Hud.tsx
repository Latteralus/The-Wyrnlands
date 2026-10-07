import { useView } from '../sim/hooks';
import { ActionQueuePanel } from './ActionQueuePanel';
import { NeedsBar } from './NeedsBar';
import { TimeControls } from './TimeControls';
import type { GameClock } from '../hooks/useGameClock';

interface HudProps {
  clock: GameClock;
  onError: (message: string) => void;
}

// §14.2 HUD: needs, coin, date/season/time, current action + queue, time
// controls.
export function Hud({ clock, onError }: HudProps) {
  const hud = useView('view.hud', undefined).data;
  const hasActionInProgress = hud?.activeActions[0]?.status === 'in_progress';

  return (
    <div className="hud">
      <div className="hud-row">
        <span className="hud-stat">
          {hud ? `Year ${hud.calendar.year}, ${hud.calendar.season}, day ${hud.calendar.day}` : '…'}
        </span>
        <span className="hud-stat hud-coin">{hud ? `${hud.balance} coin` : ''}</span>
      </div>
      {hud?.needs && (
        <div className="hud-row hud-needs">
          <NeedsBar label="Hunger" value={hud.needs.hunger} />
          <NeedsBar label="Thirst" value={hud.needs.thirst} />
          <NeedsBar label="Energy" value={hud.needs.energy} />
          <NeedsBar label="Warmth" value={hud.needs.warmth} />
          <span className="hud-gear" title="Worn gear">
            {hud.wornGear.length === 0
              ? 'Barefoot, no gear'
              : hud.wornGear
                  .map((g) => `${g.goodType} (${Math.round((g.durability / g.maxDurability) * 100)}%)`)
                  .join(', ')}
          </span>
        </div>
      )}
      <div className="hud-row">
        <ActionQueuePanel active={hud?.activeActions ?? []} currentTick={hud?.tick ?? 0} onError={onError} />
        <TimeControls clock={clock} hasActionInProgress={hasActionInProgress} />
      </div>
    </div>
  );
}
