export type PlayerColor = 'black' | 'white';

export type ColorClock = { black: number; white: number };

export type ClockInput = {
  initialSeconds: number | '';
  bufferSeconds: number | '';
  incrementSeconds: number | '';
};

export type ClockField = keyof ClockInput;

export type RawTimeControl = {
  initialMs?: number | ColorClock;
  bufferMs?: number | ColorClock;
  incrementMs?: number | ColorClock;
  maxGameMs?: number | null;
};

export type TimeControl = {
  initialMs: ColorClock;
  bufferMs: ColorClock;
  incrementMs: ColorClock;
  maxGameMs?: number | null;
};

/** Time-control shape shared with lobby create (local table clock only; no network). */
export type LobbyTimeControlPayload = {
  initialMs: number | ColorClock;
  bufferMs: number | ColorClock;
  incrementMs: number | ColorClock;
  maxGameMs: number | null;
};

export type StartColorOption = 'black' | 'white' | 'random';

export type StandaloneClockStatus = 'active' | 'paused' | 'ended';

export type StandaloneEndReason =
  | { kind: 'timeout-player'; loser: PlayerColor; winner: PlayerColor }
  | { kind: 'timeout-game-tie' };

export type StandaloneClockSettings = {
  sameClockSettings: boolean;
  sharedClock: ClockInput;
  blackClock: ClockInput;
  whiteClock: ClockInput;
  maxGameEnabled: boolean;
  maxGameMinutesTotal: number | '';
  startColor: StartColorOption;
};

export const DEFAULT_CLOCK_INPUT: ClockInput = {
  initialSeconds: 300,
  bufferSeconds: 20,
  incrementSeconds: 0,
};

export const DEFAULT_TIME_CONTROL: TimeControl = {
  initialMs: { black: 300000, white: 300000 },
  bufferMs: { black: 20000, white: 20000 },
  incrementMs: { black: 0, white: 0 },
  maxGameMs: null,
};

export const DEFAULT_STANDALONE_SETTINGS: StandaloneClockSettings = {
  sameClockSettings: true,
  sharedClock: { ...DEFAULT_CLOCK_INPUT },
  blackClock: { ...DEFAULT_CLOCK_INPUT },
  whiteClock: { ...DEFAULT_CLOCK_INPUT },
  maxGameEnabled: false,
  maxGameMinutesTotal: 60,
  startColor: 'black',
};
