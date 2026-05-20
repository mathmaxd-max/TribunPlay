import type { PlayLobbyPrefill } from "./types";

const LOCAL_PREFILL_KEY = "tribun.playPrefill.local.v1";
const FRIEND_PREFILL_KEY = "tribun.playPrefill.friend.v1";

function savePrefill(key: string, prefill: PlayLobbyPrefill): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(key, JSON.stringify(prefill));
  } catch {
    // Ignore storage errors.
  }
}

function loadPrefill(key: string): PlayLobbyPrefill | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as PlayLobbyPrefill;
  } catch {
    return null;
  }
}

export function saveLocalLobbyPrefill(prefill: PlayLobbyPrefill): void {
  savePrefill(LOCAL_PREFILL_KEY, prefill);
}

export function loadLocalLobbyPrefill(): PlayLobbyPrefill | null {
  return loadPrefill(LOCAL_PREFILL_KEY);
}

export function clearLocalLobbyPrefill(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(LOCAL_PREFILL_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function saveFriendLobbyPrefill(prefill: PlayLobbyPrefill): void {
  savePrefill(FRIEND_PREFILL_KEY, prefill);
}

export function loadFriendLobbyPrefill(): PlayLobbyPrefill | null {
  return loadPrefill(FRIEND_PREFILL_KEY);
}

export function clearFriendLobbyPrefill(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(FRIEND_PREFILL_KEY);
  } catch {
    // Ignore storage errors.
  }
}
