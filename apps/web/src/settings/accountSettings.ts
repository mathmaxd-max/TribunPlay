import { API_BASE } from '../config';
import { getStoredIdentity } from '../auth/identityStore';

export type PreferredSeatColor = 'black' | 'white' | 'none';

export type BoardSfxPreferences = {
  muted: boolean;
  volume: number;
};

export type AccountPreferences = {
  singleClickCancelReselect: boolean;
  preferredSeatColor: PreferredSeatColor;
  streamerMode: boolean;
  boardSfx: BoardSfxPreferences;
};

export type AccountPreferencesPatch = Partial<{
  singleClickCancelReselect: boolean;
  preferredSeatColor: PreferredSeatColor;
  streamerMode: boolean;
  boardSfx: Partial<BoardSfxPreferences>;
}>;

/** @deprecated Use AccountPreferences */
export type AccountSettings = AccountPreferences;

const STORAGE_KEY = 'tribun.accountPreferences.v1';
const LEGACY_SETTINGS_KEY = 'tribun.accountSettings.v1';
const LEGACY_SFX_KEY = 'tribun.boardSfx.v1';

const DEFAULT_ACCOUNT_PREFERENCES: AccountPreferences = {
  singleClickCancelReselect: false,
  preferredSeatColor: 'none',
  streamerMode: false,
  boardSfx: {
    muted: false,
    volume: 1,
  },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const clampVolume = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_ACCOUNT_PREFERENCES.boardSfx.volume;
  return Math.max(0, Math.min(2, value));
};

const normalizeBoardSfx = (raw: unknown): BoardSfxPreferences => {
  if (!isObject(raw)) return { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx };
  return {
    muted: typeof raw.muted === 'boolean' ? raw.muted : DEFAULT_ACCOUNT_PREFERENCES.boardSfx.muted,
    volume: clampVolume(raw.volume),
  };
};

export const normalizeAccountPreferences = (raw: unknown | null): AccountPreferences => {
  if (raw === null || raw === undefined) {
    return {
      ...DEFAULT_ACCOUNT_PREFERENCES,
      boardSfx: { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx },
    };
  }

  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        ...DEFAULT_ACCOUNT_PREFERENCES,
        boardSfx: { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx },
      };
    }
  }

  if (!isObject(parsed)) {
    return {
      ...DEFAULT_ACCOUNT_PREFERENCES,
      boardSfx: { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx },
    };
  }

  const preferredSeatColor =
    parsed.preferredSeatColor === 'black' ||
    parsed.preferredSeatColor === 'white' ||
    parsed.preferredSeatColor === 'none'
      ? parsed.preferredSeatColor
      : DEFAULT_ACCOUNT_PREFERENCES.preferredSeatColor;

  return {
    singleClickCancelReselect:
      typeof parsed.singleClickCancelReselect === 'boolean'
        ? parsed.singleClickCancelReselect
        : DEFAULT_ACCOUNT_PREFERENCES.singleClickCancelReselect,
    preferredSeatColor,
    streamerMode:
      typeof parsed.streamerMode === 'boolean' ? parsed.streamerMode : DEFAULT_ACCOUNT_PREFERENCES.streamerMode,
    boardSfx: normalizeBoardSfx(parsed.boardSfx),
  };
};

const mergePreferencesPatch = (
  current: AccountPreferences,
  patch: AccountPreferencesPatch,
): AccountPreferences =>
  normalizeAccountPreferences({
    singleClickCancelReselect:
      patch.singleClickCancelReselect !== undefined
        ? patch.singleClickCancelReselect
        : current.singleClickCancelReselect,
    preferredSeatColor:
      patch.preferredSeatColor !== undefined ? patch.preferredSeatColor : current.preferredSeatColor,
    streamerMode: patch.streamerMode !== undefined ? patch.streamerMode : current.streamerMode,
    boardSfx: patch.boardSfx
      ? {
          muted: patch.boardSfx.muted !== undefined ? patch.boardSfx.muted : current.boardSfx.muted,
          volume: patch.boardSfx.volume !== undefined ? clampVolume(patch.boardSfx.volume) : current.boardSfx.volume,
        }
      : current.boardSfx,
  });

let memoryCache: AccountPreferences | null = null;
let loadPromise: Promise<AccountPreferences> | null = null;

const readFromLocalStorage = (): AccountPreferences | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeAccountPreferences(JSON.parse(raw));
  } catch {
    return null;
  }
};

const readLegacyLocalPreferences = (): AccountPreferencesPatch | null => {
  if (typeof window === 'undefined') return null;
  const patch: AccountPreferencesPatch = {};
  let hasLegacy = false;

  try {
    const legacySettings = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (legacySettings) {
      const parsed = JSON.parse(legacySettings) as unknown;
      if (isObject(parsed)) {
        if (typeof parsed.singleClickCancelReselect === 'boolean') {
          patch.singleClickCancelReselect = parsed.singleClickCancelReselect;
          hasLegacy = true;
        }
        if (
          parsed.preferredSeatColor === 'black' ||
          parsed.preferredSeatColor === 'white' ||
          parsed.preferredSeatColor === 'none'
        ) {
          patch.preferredSeatColor = parsed.preferredSeatColor;
          hasLegacy = true;
        }
      }
    }
  } catch {
    // Ignore.
  }

  try {
    const legacySfx = window.localStorage.getItem(LEGACY_SFX_KEY);
    if (legacySfx) {
      const parsed = JSON.parse(legacySfx) as unknown;
      if (isObject(parsed)) {
        patch.boardSfx = {
          muted: typeof parsed.muted === 'boolean' ? parsed.muted : undefined,
          volume: typeof parsed.volume === 'number' ? clampVolume(parsed.volume) : undefined,
        };
        hasLegacy = true;
      }
    }
  } catch {
    // Ignore.
  }

  return hasLegacy ? patch : null;
};

const clearLegacyLocalKeys = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_SETTINGS_KEY);
    window.localStorage.removeItem(LEGACY_SFX_KEY);
  } catch {
    // Ignore.
  }
};

const writeCache = (preferences: AccountPreferences): AccountPreferences => {
  const next = normalizeAccountPreferences(preferences);
  memoryCache = next;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage failures.
    }
  }
  return next;
};

const fetchAccountFromApi = async (accessToken: string): Promise<{
  preferences: AccountPreferences;
  hasStoredPreferences: boolean;
}> => {
  const response = await fetch(`${API_BASE}/api/account`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const data = (await response.json()) as {
    preferences?: unknown;
    hasStoredPreferences?: boolean;
  };
  const preferences = normalizeAccountPreferences(data.preferences ?? null);
  return {
    preferences,
    hasStoredPreferences: Boolean(data.hasStoredPreferences),
  };
};

const patchPreferencesOnApi = async (
  accessToken: string,
  patch: AccountPreferencesPatch,
): Promise<AccountPreferences> => {
  const response = await fetch(`${API_BASE}/api/account/preferences`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({} as { error?: string }));
    throw new Error(data.error ?? `HTTP ${response.status}`);
  }
  const data = (await response.json()) as { preferences: AccountPreferences };
  return normalizeAccountPreferences(data.preferences);
};

export const getAccountPreferences = (): AccountPreferences => {
  if (memoryCache) return { ...memoryCache, boardSfx: { ...memoryCache.boardSfx } };
  const stored = readFromLocalStorage();
  if (stored) {
    memoryCache = stored;
    return { ...stored, boardSfx: { ...stored.boardSfx } };
  }
  return {
    ...DEFAULT_ACCOUNT_PREFERENCES,
    boardSfx: { ...DEFAULT_ACCOUNT_PREFERENCES.boardSfx },
  };
};

/** @deprecated Use getAccountPreferences */
export const getAccountSettings = getAccountPreferences;

export const shouldHideSensitiveIdentity = (): boolean => getAccountPreferences().streamerMode;

export const ensureAccountPreferencesLoaded = async (
  accessToken?: string,
): Promise<AccountPreferences> => {
  const identity = getStoredIdentity();
  if (!identity || identity.mode !== 'token') {
    const legacy = readLegacyLocalPreferences();
    const base = getAccountPreferences();
    return writeCache(legacy ? mergePreferencesPatch(base, legacy) : base);
  }

  const token = accessToken ?? identity.session.accessToken;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const { preferences: serverPreferences, hasStoredPreferences } = await fetchAccountFromApi(token);
      const legacy = readLegacyLocalPreferences();

      if (legacy && !hasStoredPreferences) {
        const merged = mergePreferencesPatch(serverPreferences, legacy);
        const uploaded = await patchPreferencesOnApi(token, merged);
        clearLegacyLocalKeys();
        return writeCache(uploaded);
      }

      if (legacy) {
        clearLegacyLocalKeys();
      }

      return writeCache(serverPreferences);
    } catch {
      const legacy = readLegacyLocalPreferences();
      const base = getAccountPreferences();
      return writeCache(legacy ? mergePreferencesPatch(base, legacy) : base);
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
};

export const patchAccountPreferences = async (
  patch: AccountPreferencesPatch,
): Promise<AccountPreferences> => {
  const current = getAccountPreferences();
  const next = mergePreferencesPatch(current, patch);
  writeCache(next);

  const identity = getStoredIdentity();
  if (!identity || identity.mode !== 'token') {
    return next;
  }

  try {
    const saved = await patchPreferencesOnApi(identity.session.accessToken, patch);
    return writeCache(saved);
  } catch {
    return next;
  }
};

/** @deprecated Use patchAccountPreferences */
export const updateAccountSettings = (patch: AccountPreferencesPatch): AccountPreferences => {
  const next = mergePreferencesPatch(getAccountPreferences(), patch);
  writeCache(next);
  void patchAccountPreferences(patch);
  return next;
};

/** @deprecated Use writeCache via patchAccountPreferences */
export const setAccountSettings = (nextSettings: AccountPreferences): void => {
  writeCache(nextSettings);
};
