import { ActionQueuePanel } from './ActionQueuePanel';
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
// controls. Needs tracking itself doesn't land until Stage 2 (§Stage 2), so
// it's a labeled stub here rather than faked data.
export function Hud({ uiApi, playerId, clock, onRefresh }: HudProps) {
  const calendar = uiApi.getCalendar();
  const balance = uiApi.getBalance(playerId);
  const hasActionInProgress = uiApi.getActorActions(playerId).some((a) => a.status === 'in_progress');

  return (
    <div className="hud">
      <div className="hud-row">
        <span className="hud-stat">
          Year {calendar.year}, {calendar.season}, day {calendar.day}
        </span>
        <span className="hud-stat hud-coin">{balance} coin</span>
        <span className="hud-stat hud-needs-stub" title="Needs tracking arrives in Stage 2">
          Needs: —
        </span>
      </div>
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
