import type { StandaloneClockSettings } from './types';
import { DEFAULT_STANDALONE_SETTINGS } from './types';

const STORAGE_KEY = 'tribunplay_standalone_clock_v1';

export const loadStandaloneClockSettings = (): StandaloneClockSettings => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_STANDALONE_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STANDALONE_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<StandaloneClockSettings>;
    return {
      ...DEFAULT_STANDALONE_SETTINGS,
      ...parsed,
      sharedClock: { ...DEFAULT_STANDALONE_SETTINGS.sharedClock, ...parsed.sharedClock },
      blackClock: { ...DEFAULT_STANDALONE_SETTINGS.blackClock, ...parsed.blackClock },
      whiteClock: { ...DEFAULT_STANDALONE_SETTINGS.whiteClock, ...parsed.whiteClock },
    };
  } catch {
    return { ...DEFAULT_STANDALONE_SETTINGS };
  }
};

export const saveStandaloneClockSettings = (settings: StandaloneClockSettings): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota errors
  }
};
