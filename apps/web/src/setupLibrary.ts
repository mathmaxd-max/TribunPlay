import * as engine from "@tribunplay/engine";
import { API_BASE } from "./config";
import {
  getStoredIdentity,
  setIdentityFromAuthSuccess,
  type AuthSuccessResponse,
  type StoredIdentity,
} from "./auth/identityStore";
import { getFlippedSetupHash } from "./setupHashFlip";

type SetupLibraryResponse = {
  items: engine.SetupLibraryItem[];
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

const getTokenIdentityOrThrow = (): Extract<StoredIdentity, { mode: "token" }> => {
  const identity = getStoredIdentity();
  if (!identity || identity.mode !== "token") {
    throw new Error("Setup library is only available for signed-in accounts.");
  }
  return identity;
};

const withAuthRetry = async <T>(request: (accessToken: string) => Promise<Response>, read: (response: Response) => Promise<T>): Promise<T> => {
  let tokenIdentity = getTokenIdentityOrThrow();
  let accessToken = tokenIdentity.session.accessToken;
  let response = await request(accessToken);
  if (!response.ok && response.status === 401) {
    tokenIdentity = await refreshTokenIdentityOrThrow(tokenIdentity);
    accessToken = tokenIdentity.session.accessToken;
    response = await request(accessToken);
  }
  return read(response);
};

const normalizeResponseItem = (item: engine.SetupLibraryItem): engine.SetupLibraryItem => ({
  ...item,
  hash: engine.normalizeSetupHash(item.hash),
});

export const isSetupLibraryAvailable = (): boolean => {
  const identity = getStoredIdentity();
  return identity?.mode === "token";
};

export const findSetupLibraryIdentityMatch = (
  items: engine.SetupLibraryItem[],
  rawHash: string,
): engine.SetupLibraryItem | null => {
  const hash = engine.normalizeSetupHash(rawHash);
  const flipped = getFlippedSetupHash(hash);
  // Hash and flipped-hash encode mirrored variants of the same setup identity.
  return items.find((item) => item.hash === hash || (flipped !== null && item.hash === flipped)) ?? null;
};

export const loadSetupLibrary = async (): Promise<engine.SetupLibraryItem[]> =>
  withAuthRetry(
    (accessToken) =>
      fetch(`${API_BASE}/api/setup-library`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to load setup library" }));
        throw new Error(err.error || "Failed to load setup library");
      }
      const data = (await response.json()) as SetupLibraryResponse;
      return (data.items ?? []).map(normalizeResponseItem);
    },
  );

export const addSetupToLibrary = async (params: {
  name: string;
  hash: string;
  armySize: number;
  tribunHeight: 1 | 2 | 3;
}): Promise<engine.SetupLibraryItem> => {
  const normalizedHash = engine.normalizeSetupHash(params.hash);
  const trimmedName = params.name.trim();
  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  return withAuthRetry(
    (accessToken) =>
      fetch(`${API_BASE}/api/setup-library`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: trimmedName, hash: normalizedHash }),
      }),
    async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to save setup" }));
        throw new Error(err.error || "Failed to save setup");
      }
      const data = (await response.json()) as { item: engine.SetupLibraryItem };
      return normalizeResponseItem(data.item);
    },
  );
};

export const renameSetupLibraryItem = async (params: {
  itemId: string;
  name: string;
}): Promise<engine.SetupLibraryItem> => {
  const trimmedName = params.name.trim();
  if (!trimmedName) {
    throw new Error("Name is required.");
  }

  return withAuthRetry(
    (accessToken) =>
      fetch(`${API_BASE}/api/setup-library/${encodeURIComponent(params.itemId)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: trimmedName }),
      }),
    async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to rename setup" }));
        throw new Error(err.error || "Failed to rename setup");
      }
      const data = (await response.json()) as { item: engine.SetupLibraryItem };
      return normalizeResponseItem(data.item);
    },
  );
};

export const deleteSetupLibraryItem = async (itemId: string): Promise<void> =>
  withAuthRetry(
    (accessToken) =>
      fetch(`${API_BASE}/api/setup-library/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }),
    async (response) => {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Failed to delete setup" }));
        throw new Error(err.error || "Failed to delete setup");
      }
    },
  );
