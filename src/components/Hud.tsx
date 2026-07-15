import { ActionQueuePanel } from './ActionQueuePanel';
import { NeedsBar } from './NeedsBar';
import { TimeControls } from './TimeControls';
import type { UiApi } from '../engine/ui-api';
import type { GameClock } from '../hooks/useGameClock';

interface HudProps {
  uiApi: UiApi;
  playerId: string;
  clock: GameClock;
  onRefresh: () => void;
}

// §14.2 HUD: needs, coin, date/season/time, current action + queue, time
// controls.
export function Hud({ uiApi, playerId, clock, onRefresh }: HudProps) {
  const calendar = uiApi.getCalendar();
  const balance = uiApi.getBalance(playerId);
  const needs = uiApi.getNeeds(playerId);
  const wornGear = uiApi.getWornGear(playerId);
  const hasActionInProgress = uiApi.getCurrentAction(playerId)?.status === 'in_progress';

  return (
    <div className="hud">
      <div className="hud-row">
        <span className="hud-stat">
          Year {calendar.year}, {calendar.season}, day {calendar.day}
        </span>
        <span className="hud-stat hud-coin">{balance} coin</span>
      </div>
      {needs && (
        <div className="hud-row hud-needs">
          <NeedsBar label="Hunger" value={needs.hunger} />
          <NeedsBar label="Thirst" value={needs.thirst} />
          <NeedsBar label="Energy" value={needs.energy} />
          <NeedsBar label="Warmth" value={needs.warmth} />
          <span className="hud-gear" title="Worn gear">
            {wornGear.length === 0
              ? 'Barefoot, no gear'
              : wornGear
                  .map((g) => `${g.goodType} (${Math.round((g.durability / g.maxDurability) * 100)}%)`)
                  .join(', ')}
          </span>
        </div>
      )}
      <div className="hud-row">
        <ActionQueuePanel
          uiApi={uiApi}
          actorId={playerId}
          currentTick={uiApi.getTick()}
          onInterrupt={onRefresh}
        />
        <TimeControls clock={clock} actorId={playerId} hasActionInProgress={hasActionInProgress} />
      </div>
    </div>
  );
}
