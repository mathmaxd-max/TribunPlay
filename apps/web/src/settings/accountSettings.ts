export type AccountSettings = {
  // Default stays off so existing click semantics do not change unexpectedly for current players.
  singleClickCancelReselect: boolean;
};

const STORAGE_KEY = 'tribun.accountSettings.v1';

const DEFAULT_ACCOUNT_SETTINGS: AccountSettings = {
  singleClickCancelReselect: false,
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const getAccountSettings = (): AccountSettings => {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_ACCOUNT_SETTINGS };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ACCOUNT_SETTINGS };
    const parsed = JSON.parse(raw) as unknown;
    if (!isObject(parsed)) return { ...DEFAULT_ACCOUNT_SETTINGS };
    return {
      singleClickCancelReselect:
        typeof parsed.singleClickCancelReselect === 'boolean'
          ? parsed.singleClickCancelReselect
          : DEFAULT_ACCOUNT_SETTINGS.singleClickCancelReselect,
    };
  } catch {
    return { ...DEFAULT_ACCOUNT_SETTINGS };
  }
};

export const setAccountSettings = (nextSettings: AccountSettings): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
  } catch {
    // Ignore storage failures.
  }
};

export const updateAccountSettings = (
  patch: Partial<AccountSettings>,
): AccountSettings => {
  const current = getAccountSettings();
  const next = {
    ...current,
    ...patch,
  };
  setAccountSettings(next);
  return next;
};
