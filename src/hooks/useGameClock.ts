import { useEffect, useRef, useState } from 'react';
import { MINUTES_PER_DAY, type UiApi } from '../engine/ui-api';

export type Speed = 'paused' | 1 | 4 | 16;

const TICK_INTERVAL_MS = 200;
// Placeholder pacing (§4.3): 5 game-minutes per real-time interval at 1x, so
// a full day passes in ~8 real minutes. Not a balanced number — revisit with
// the balance harness (§17) once real play sessions exist to tune against.
const BASE_TICKS_PER_INTERVAL = 5;

export interface GameClock {
  speed: Speed;
  setSpeed: (speed: Speed) => void;
  skipToMorning: () => void;
  skipToActionComplete: (actorId: string) => void;
}

// Drives the continuous tick loop for pause/1x/4x/16x, plus the two skip
// shortcuts (§4.3). `onAdvance` is called after every batch of ticks so the
// caller can trigger a re-render — the engine itself has no notion of "now."
export function useGameClock(uiApi: UiApi | null, onAdvance: () => void): GameClock {
  const [speed, setSpeed] = useState<Speed>('paused');
  const speedRef = useRef(speed);
  const onAdvanceRef = useRef(onAdvance);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    onAdvanceRef.current = onAdvance;
  }, [onAdvance]);

  useEffect(() => {
    if (!uiApi) return;
    const interval = setInterval(() => {
      const currentSpeed = speedRef.current;
      if (currentSpeed === 'paused') return;
      uiApi.advanceTicks(BASE_TICKS_PER_INTERVAL * currentSpeed);
      onAdvanceRef.current();
    }, TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [uiApi]);

  const skipToMorning = () => {
    if (!uiApi) return;
    const { minuteOfDay } = uiApi.getCalendar();
    const remaining = minuteOfDay === 0 ? MINUTES_PER_DAY : MINUTES_PER_DAY - minuteOfDay;
    uiApi.advanceTicks(remaining);
    onAdvanceRef.current();
  };

  const skipToActionComplete = (actorId: string) => {
    if (!uiApi) return;
    const current = uiApi.getCurrentAction(actorId);
    const inProgress = current?.status === 'in_progress' ? current : null;
    if (!inProgress || inProgress.endsAtTick === null) return;
    const remaining = inProgress.endsAtTick - uiApi.getTick();
    if (remaining > 0) uiApi.advanceTicks(remaining);
    onAdvanceRef.current();
  };

  return { speed, setSpeed, skipToMorning, skipToActionComplete };
}
