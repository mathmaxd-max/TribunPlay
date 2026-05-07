import * as engine from "@tribunplay/engine";
import { API_BASE } from "./config";
import { getStoredIdentity, setIdentityFromAuthSuccess, type AuthSuccessResponse, type StoredIdentity } from "./auth/identityStore";

type SetupLibraryResponse = {
  items: engine.SetupLibraryItem[];
};

const guestStorageKey = (identity: Extract<StoredIdentity, { mode: "guest" }>) =>
  `setup_library_guest_${identity.accountId ?? identity.name.toLowerCase()}`;

const normalizeGuestItems = (raw: unknown): engine.SetupLibraryItem[] => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Partial<engine.SetupLibraryItem>;
      if (
        typeof row.id !== "string" ||
        typeof row.name !== "string" ||
        typeof row.hash !== "string" ||
        typeof row.armySize !== "number" ||
        (row.tribunHeight !== 1 && row.tribunHeight !== 2 && row.tribunHeight !== 3) ||
        typeof row.createdAt !== "string" ||
        typeof row.updatedAt !== "string"
      ) {
        return null;
      }
      return {
        id: row.id,
        name: row.name,
        hash: engine.normalizeSetupHash(row.hash),
        armySize: row.armySize,
        tribunHeight: row.tribunHeight,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    })
    .filter((item): item is engine.SetupLibraryItem => item !== null);
};

const loadGuestItems = (identity: Extract<StoredIdentity, { mode: "guest" }>): engine.SetupLibraryItem[] => {
  const raw = localStorage.getItem(guestStorageKey(identity));
  if (!raw) return [];
  try {
    return normalizeGuestItems(JSON.parse(raw));
  } catch {
    return [];
  }
};

const saveGuestItems = (identity: Extract<StoredIdentity, { mode: "guest" }>, items: engine.SetupLibraryItem[]) => {
  localStorage.setItem(guestStorageKey(identity), JSON.stringify(items));
};

const refreshTokenIdentityOrThrow = async (
  current: Extract<StoredIdentity, { mode: "token" }>,
): Promise<Extract<StoredIdentity, { mode: "token" }>> => {
  const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: current.session.refreshToken }),
  });
  if (!refreshResponse.ok) {
    throw new Error("Session expired. Please log in again.");
  }
  const refreshed = (await refreshResponse.json()) as AuthSuccessResponse;
  return setIdentityFromAuthSuccess(refreshed) as Extract<StoredIdentity, { mode: "token" }>;
};

export const loadSetupLibrary = async (): Promise<engine.SetupLibraryItem[]> => {
  const identity = getStoredIdentity();
  if (!identity) return [];
  if (identity.mode === "guest") {
    return loadGuestItems(identity);
  }

  let tokenIdentity = identity;
  let accessToken = tokenIdentity.session.accessToken;
  const doFetch = async () =>
    fetch(`${API_BASE}/api/setup-library`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

  let response = await doFetch();
  if (!response.ok && response.status === 401) {
    tokenIdentity = await refreshTokenIdentityOrThrow(tokenIdentity);
    accessToken = tokenIdentity.session.accessToken;
    response = await doFetch();
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to load setup library" }));
    throw new Error(err.error || "Failed to load setup library");
  }
  const data = (await response.json()) as SetupLibraryResponse;
  return (data.items ?? []).map((item) => ({
    ...item,
    hash: engine.normalizeSetupHash(item.hash),
  }));
};

export const addSetupToLibrary = async (params: {
  name: string;
  hash: string;
  armySize: number;
  tribunHeight: 1 | 2 | 3;
}): Promise<engine.SetupLibraryItem> => {
  const identity = getStoredIdentity();
  if (!identity) {
    throw new Error("Identity missing.");
  }
  const normalizedHash = engine.normalizeSetupHash(params.hash);
  const trimmedName = params.name.trim();
  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  if (identity.mode === "guest") {
    const nowIso = new Date().toISOString();
    const existing = loadGuestItems(identity);
    const idx = existing.findIndex((item) => item.hash === normalizedHash);
    const nextItem: engine.SetupLibraryItem =
      idx >= 0
        ? {
            ...existing[idx],
            name: trimmedName,
            armySize: params.armySize,
            tribunHeight: params.tribunHeight,
            updatedAt: nowIso,
          }
        : {
            id: crypto.randomUUID(),
            name: trimmedName,
            hash: normalizedHash,
            armySize: params.armySize,
            tribunHeight: params.tribunHeight,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
    const next = idx >= 0 ? existing.map((item, itemIdx) => (itemIdx === idx ? nextItem : item)) : [nextItem, ...existing];
    saveGuestItems(identity, next);
    return nextItem;
  }

  let tokenIdentity = identity;
  let accessToken = tokenIdentity.session.accessToken;
  const payload = { name: trimmedName, hash: normalizedHash };
  const doCreate = async () =>
    fetch(`${API_BASE}/api/setup-library`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(payload),
    });

  let response = await doCreate();
  if (!response.ok && response.status === 401) {
    tokenIdentity = await refreshTokenIdentityOrThrow(tokenIdentity);
    accessToken = tokenIdentity.session.accessToken;
    response = await doCreate();
  }
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Failed to save setup" }));
    throw new Error(err.error || "Failed to save setup");
  }
  const data = (await response.json()) as { item: engine.SetupLibraryItem };
  return {
    ...data.item,
    hash: engine.normalizeSetupHash(data.item.hash),
  };
};
