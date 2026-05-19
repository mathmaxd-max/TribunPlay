import type { LocalLobbyPayload } from './types';

const STORAGE_KEY = 'tribun.localLobbyPayload.v1';

export const saveLocalLobbyPayload = (payload: LocalLobbyPayload): void => {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore session storage failures.
  }
};

export const loadLocalLobbyPayload = (): LocalLobbyPayload | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LocalLobbyPayload;
  } catch {
    return null;
  }
};
