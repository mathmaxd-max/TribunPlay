export type IdentityMode = "guest" | "token";

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAtMs: number;
};

export type StoredIdentity =
  | {
      mode: "guest";
      name: string;
      email: null;
      accountId?: string;
    }
  | {
      mode: "token";
      name: string;
      email: string;
      accountId: string;
      session: AuthSession;
    };

export type IdentityPayload =
  | { mode: "guest"; name: string; accountId?: string }
  | { mode: "token"; accessToken: string };

export type AuthSuccessResponse = {
  identity: {
    mode: "token";
    accountId: string;
    name: string;
    email: string;
  };
  session: {
    accessToken: string;
    refreshToken: string;
    expiresInSec: number;
    expiresAtMs: number;
  };
};

import { ensureAccountPreferencesLoaded } from "../settings/accountSettings";

const STORAGE_KEY = "tribun_identity_v1";

const normalizeName = (value: string): string => value.trim().replace(/\s+/g, " ");

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseGuestIdentity = (parsed: Record<string, unknown>): StoredIdentity | null => {
  if (parsed.mode !== "guest") return null;
  if (typeof parsed.name !== "string") return null;
  const name = normalizeName(parsed.name);
  if (!name) return null;

  return {
    mode: "guest",
    name,
    email: null,
    accountId: typeof parsed.accountId === "string" ? parsed.accountId : undefined,
  };
};

const parseTokenIdentity = (parsed: Record<string, unknown>): StoredIdentity | null => {
  if (parsed.mode !== "token") return null;
  if (typeof parsed.name !== "string" || typeof parsed.email !== "string" || typeof parsed.accountId !== "string") {
    return null;
  }

  const session = parsed.session;
  if (!isObject(session)) return null;
  if (
    typeof session.accessToken !== "string" ||
    typeof session.refreshToken !== "string" ||
    typeof session.expiresAtMs !== "number"
  ) {
    return null;
  }

  const name = normalizeName(parsed.name);
  if (!name) return null;

  return {
    mode: "token",
    name,
    email: parsed.email,
    accountId: parsed.accountId,
    session: {
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresAtMs: session.expiresAtMs,
    },
  };
};

export const getStoredIdentity = (): StoredIdentity | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsedUnknown = JSON.parse(raw) as unknown;
    if (!isObject(parsedUnknown) || typeof parsedUnknown.mode !== "string") {
      return null;
    }

    if (parsedUnknown.mode === "guest") {
      return parseGuestIdentity(parsedUnknown);
    }

    if (parsedUnknown.mode === "token") {
      return parseTokenIdentity(parsedUnknown);
    }

    return null;
  } catch {
    return null;
  }
};

export const setStoredIdentity = (identity: StoredIdentity): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
};

export const clearStoredIdentity = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(STORAGE_KEY);
};

export const buildIdentityPayload = (identity: StoredIdentity): IdentityPayload => {
  if (identity.mode === "token") {
    if (!identity.session.accessToken) {
      throw new Error("Session missing access token. Please sign in again.");
    }

    return {
      mode: "token",
      accessToken: identity.session.accessToken,
    };
  }

  return {
    mode: "guest",
    name: normalizeName(identity.name),
    accountId: identity.accountId,
  };
};

export const setIdentityFromAuthSuccess = (auth: AuthSuccessResponse): StoredIdentity => {
  const nextIdentity: StoredIdentity = {
    mode: "token",
    name: normalizeName(auth.identity.name),
    email: auth.identity.email,
    accountId: auth.identity.accountId,
    session: {
      accessToken: auth.session.accessToken,
      refreshToken: auth.session.refreshToken,
      expiresAtMs: auth.session.expiresAtMs,
    },
  };

  setStoredIdentity(nextIdentity);
  void ensureAccountPreferencesLoaded(auth.session.accessToken);
  return nextIdentity;
};

export const mergeIdentityFromParticipant = (
  current: StoredIdentity | null,
  participant: {
    accountId: string;
    name: string;
    email: string | null;
    mode: IdentityMode;
  },
): StoredIdentity => {
  if (participant.mode === "token") {
    if (current?.mode !== "token") {
      throw new Error("Authenticated session missing. Please sign in again.");
    }

    const next: StoredIdentity = {
      ...current,
      name: normalizeName(participant.name),
      email: participant.email ?? current.email,
      accountId: participant.accountId,
    };
    return next;
  }

  return {
    mode: "guest",
    name: normalizeName(participant.name),
    email: null,
    accountId: participant.accountId,
  };
};
