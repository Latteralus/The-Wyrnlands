import { useCommand, useSimulationValue } from '../sim/hooks';
import type { Speed } from '../../shared/protocol';

export type { Speed };

export interface GameClock {
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  skipToMorning: () => void;
  skipToActionComplete: () => void;
}

// pause / 1× / 4× / 16× and the two skips (§4.3). The clock itself runs in
// the simulation process (sim-host/clock.ts); these only ask it to change
// speed or skip, and the displayed speed is whatever it reports back — so a
// slow render can never slow the world down or speed it up.
export function useGameClock(onError: (message: string) => void): GameClock {
  const speed = useSimulationValue((s) => s.speed);
  const command = useCommand();
  const report = (error: unknown) => onError(error instanceof Error ? error.message : String(error));
  return {
    speed,
    setSpeed: (next) => void command('clock.setSpeed', { speed: next }).catch(report),
    skipToMorning: () => void command('clock.skipToMorning').catch(report),
    skipToActionComplete: () => void command('clock.skipToActionComplete').catch(report),
  };
}
