import type { ColorClock, PlayerColor } from './types';

export const advanceClockSnapshot = (
  clocks: ColorClock,
  buffers: ColorClock,
  activeColor: PlayerColor,
  elapsedMs: number,
): { clocksMs: ColorClock; buffersMs: ColorClock } => {
  const elapsed = Math.max(0, elapsedMs);
  const bufferStart = buffers[activeColor];
  const bufferRemaining = Math.max(0, bufferStart - elapsed);
  const clockDeduction = Math.max(0, elapsed - bufferStart);
  const clockRemaining = Math.max(0, clocks[activeColor] - clockDeduction);

  return {
    clocksMs: { ...clocks, [activeColor]: clockRemaining },
    buffersMs: { ...buffers, [activeColor]: bufferRemaining },
  };
};
