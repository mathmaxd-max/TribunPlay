import type { RouteKey } from "./types";

const SNAPSHOT_PREFIX = "tribun.pageSnapshot.v1";
const MAX_SNAPSHOT_BYTES = 240_000;

function buildSnapshotKey(routeKey: RouteKey): string {
  return `${SNAPSHOT_PREFIX}.${routeKey}`;
}

export function savePageSnapshot<T>(routeKey: RouteKey, snapshot: T): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = JSON.stringify(snapshot);
    if (raw.length > MAX_SNAPSHOT_BYTES) return false;
    window.sessionStorage.setItem(buildSnapshotKey(routeKey), raw);
    return true;
  } catch {
    return false;
  }
}

export function loadPageSnapshot<T>(routeKey: RouteKey): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(buildSnapshotKey(routeKey));
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function clearPageSnapshot(routeKey: RouteKey): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(buildSnapshotKey(routeKey));
  } catch {
    // Ignore storage errors.
  }
}
