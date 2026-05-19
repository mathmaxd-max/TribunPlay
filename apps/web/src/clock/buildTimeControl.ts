import type {
  ClockInput,
  ColorClock,
  LobbyTimeControlPayload,
  RawTimeControl,
  StandaloneClockSettings,
  TimeControl,
} from './types';
import { DEFAULT_TIME_CONTROL } from './types';

const clampNumber = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

export const secondsToMs = (seconds: number) => Math.round(clampNumber(seconds, 0) * 1000);
export const minutesToMs = (minutes: number) => Math.round(clampNumber(minutes, 0) * 60000);

export const coerceSeconds = (value: number | ''): number => (value === '' ? 0 : clampNumber(value, 0));

export const isClockNonZero = (clock: { initialSeconds: number | ''; bufferSeconds: number | '' }): boolean =>
  coerceSeconds(clock.initialSeconds) > 0 || coerceSeconds(clock.bufferSeconds) > 0;

export const normalizeClockInput = (clock: ClockInput) => ({
  initialSeconds: coerceSeconds(clock.initialSeconds),
  bufferSeconds: coerceSeconds(clock.bufferSeconds),
  incrementSeconds: coerceSeconds(clock.incrementSeconds),
});

export const readColorClock = (raw: number | ColorClock | undefined, fallback: ColorClock): ColorClock => {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { black: raw, white: raw };
  }
  if (raw && typeof raw === 'object') {
    return {
      black: Number.isFinite(raw.black) ? raw.black : fallback.black,
      white: Number.isFinite(raw.white) ? raw.white : fallback.white,
    };
  }
  return fallback;
};

export const normalizeTimeControl = (raw?: RawTimeControl | null): TimeControl => {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TIME_CONTROL };
  }
  const initialMs = readColorClock(raw.initialMs, DEFAULT_TIME_CONTROL.initialMs);
  const bufferMs = readColorClock(raw.bufferMs, DEFAULT_TIME_CONTROL.bufferMs);
  const incrementMs = readColorClock(raw.incrementMs, DEFAULT_TIME_CONTROL.incrementMs);
  const maxGameMs =
    raw.maxGameMs === null || Number.isFinite(raw.maxGameMs)
      ? raw.maxGameMs
      : (DEFAULT_TIME_CONTROL.maxGameMs ?? null);
  return { initialMs, bufferMs, incrementMs, maxGameMs };
};

export type BuildTimeControlOptions = {
  sameClockSettings: boolean;
  sharedClock: ClockInput;
  blackClock: ClockInput;
  whiteClock: ClockInput;
  maxGameEnabled: boolean;
  maxGameMinutesTotal: number | '';
};

export const buildLobbyTimeControl = (options: BuildTimeControlOptions): LobbyTimeControlPayload => {
  const normalizedMaxMinutesTotal =
    options.maxGameMinutesTotal === '' ? 0 : clampNumber(options.maxGameMinutesTotal, 0);
  const maxGameMs =
    options.maxGameEnabled && normalizedMaxMinutesTotal > 0
      ? minutesToMs(normalizedMaxMinutesTotal)
      : null;

  if (options.sameClockSettings) {
    const normalized = normalizeClockInput(options.sharedClock);
    return {
      initialMs: secondsToMs(normalized.initialSeconds),
      bufferMs: secondsToMs(normalized.bufferSeconds),
      incrementMs: secondsToMs(normalized.incrementSeconds),
      maxGameMs,
    };
  }

  const normalizedBlack = normalizeClockInput(options.blackClock);
  const normalizedWhite = normalizeClockInput(options.whiteClock);

  return {
    initialMs: {
      black: secondsToMs(normalizedBlack.initialSeconds),
      white: secondsToMs(normalizedWhite.initialSeconds),
    },
    bufferMs: {
      black: secondsToMs(normalizedBlack.bufferSeconds),
      white: secondsToMs(normalizedWhite.bufferSeconds),
    },
    incrementMs: {
      black: secondsToMs(normalizedBlack.incrementSeconds),
      white: secondsToMs(normalizedWhite.incrementSeconds),
    },
    maxGameMs,
  };
};

export const lobbyPayloadToTimeControl = (payload: LobbyTimeControlPayload): TimeControl =>
  normalizeTimeControl(payload);

export const settingsToLobbyPayload = (settings: StandaloneClockSettings): LobbyTimeControlPayload =>
  buildLobbyTimeControl({
    sameClockSettings: settings.sameClockSettings,
    sharedClock: settings.sharedClock,
    blackClock: settings.blackClock,
    whiteClock: settings.whiteClock,
    maxGameEnabled: settings.maxGameEnabled,
    maxGameMinutesTotal: settings.maxGameMinutesTotal,
  });

export const resolveStartColor = (option: StandaloneClockSettings['startColor']): 'black' | 'white' => {
  if (option === 'black') return 'black';
  if (option === 'white') return 'white';
  return Math.random() < 0.5 ? 'black' : 'white';
};

export type NextStartOption = 'same' | 'other' | 'random';

export const opponentOf = (color: 'black' | 'white'): 'black' | 'white' => (color === 'black' ? 'white' : 'black');

export const resolveNextStartColor = (
  option: NextStartOption,
  previousStart: 'black' | 'white',
): 'black' | 'white' => {
  if (option === 'same') return previousStart;
  if (option === 'other') return opponentOf(previousStart);
  return Math.random() < 0.5 ? 'black' : 'white';
};
