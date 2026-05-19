import type { ColorClock, PlayerColor, TimeControl } from './types';

export type ApplyTurnEndResult = {
  clocksMs: ColorClock;
  buffersMs: ColorClock;
  timedOut: boolean;
};

/**
 * Apply buffer deduction, increment, and full buffer refill after a turn ends.
 * Mirrors GameRoom.updateClocksAfterAction.
 */
export const applyTurnEnd = (params: {
  clocksMs: ColorClock;
  buffersMs: ColorClock;
  timeControl: TimeControl;
  mover: PlayerColor;
  elapsedMs: number;
}): ApplyTurnEndResult => {
  const { clocksMs, timeControl, mover, elapsedMs } = params;
  const elapsed = Math.max(0, elapsedMs);
  const bufferFull = timeControl.bufferMs[mover];
  const timeOverBuffer = Math.max(0, elapsed - bufferFull);

  const nextClock = Math.max(0, clocksMs[mover] - timeOverBuffer);
  let timedOut = false;
  let clocksAfterIncrement = nextClock;

  if (nextClock <= 0) {
    clocksAfterIncrement = 0;
    timedOut = true;
  } else {
    clocksAfterIncrement = Math.max(0, nextClock + timeControl.incrementMs[mover]);
  }

  const nextClocks: ColorClock = { ...clocksMs, [mover]: clocksAfterIncrement };
  const nextBuffers: ColorClock = {
    black: timeControl.bufferMs.black,
    white: timeControl.bufferMs.white,
  };

  return {
    clocksMs: nextClocks,
    buffersMs: nextBuffers,
    timedOut,
  };
};
