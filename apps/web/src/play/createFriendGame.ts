import * as engine from "@tribunplay/engine";
import {
  buildIdentityPayload,
  getStoredIdentity,
  mergeIdentityFromParticipant,
  setIdentityFromAuthSuccess,
  setStoredIdentity,
  type AuthSuccessResponse,
  type StoredIdentity,
} from "../auth/identityStore";
import { API_BASE } from "../config";
import { buildLobbyTimeControl } from "../clock/buildTimeControl";
import { clearFriendLobbyPrefill, type PlayLobbyPrefill } from "../navigation";
import { DEFAULT_PLAY_LOBBY_VALUES, type PlayLobbySubmitPayload } from "./types";

export type CreateFriendGameResult = {
  code: string;
  gameId: string;
  token: string;
  seat: string;
};

const clampNumber = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

export function prefillToSubmitPayload(prefill: PlayLobbyPrefill): PlayLobbySubmitPayload {
  const initial = { ...DEFAULT_PLAY_LOBBY_VALUES, ...prefill.initialValues };
  const lockedState = prefill.positionLocked && prefill.initialState ? prefill.initialState : null;
  const lockedStartColor: "black" | "white" | null = lockedState
    ? lockedState.turn === 0
      ? "black"
      : "white"
    : null;

  const setupConfig = engine.normalizeSetupConfig({
    enabled: lockedState ? false : initial.customSetupsEnabled,
    mode: initial.setupMode,
    sharedSelection:
      !lockedState && initial.customSetupsEnabled && initial.setupMode === "shared" && initial.sharedSetupHash.trim()
        ? {
            hash: initial.sharedSetupHash.trim(),
            flipBlack: initial.sharedFlipBlack,
            flipWhite: initial.sharedFlipWhite,
          }
        : null,
    allowedTribunHeights: initial.allowedTribunHeights,
    armySize: {
      min: initial.armyMin === "" ? null : clampNumber(initial.armyMin, 0),
      max: initial.armyMax === "" ? null : clampNumber(initial.armyMax, 0),
    },
  });

  const setupSelections: engine.SetupSelectionsBySide = lockedState
    ? { black: null, white: null }
    : !initial.customSetupsEnabled
      ? { black: null, white: null }
      : initial.setupMode === "shared"
        ? {
            black: initial.sharedSetupHash.trim()
              ? { hash: initial.sharedSetupHash.trim(), flip: initial.sharedFlipBlack }
              : null,
            white: initial.sharedSetupHash.trim()
              ? { hash: initial.sharedSetupHash.trim(), flip: initial.sharedFlipWhite }
              : null,
          }
        : {
            black: initial.freeBlackSetupHash.trim()
              ? { hash: initial.freeBlackSetupHash.trim(), flip: initial.freeBlackFlip }
              : null,
            white: initial.freeWhiteSetupHash.trim()
              ? { hash: initial.freeWhiteSetupHash.trim(), flip: initial.freeWhiteFlip }
              : null,
          };

  return {
    timeControl: buildLobbyTimeControl({
      sameClockSettings: initial.sameClockSettings,
      sharedClock: initial.sharedClock,
      blackClock: initial.blackClock,
      whiteClock: initial.whiteClock,
      maxGameEnabled: initial.maxGameEnabled,
      maxGameMinutesTotal: initial.maxGameMinutesTotal,
    }),
    roomSettings: {
      hostColor: lockedStartColor ?? initial.hostColor,
      startColor: lockedStartColor ?? initial.startColor,
      nextStartColor: initial.nextStartColor,
      setupConfig,
      setupSelections,
    },
  };
}

const refreshSessionOrThrow = async (current: StoredIdentity): Promise<StoredIdentity> => {
  if (current.mode !== "token") return current;
  const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: current.session.refreshToken }),
  });
  if (!refreshResponse.ok) {
    throw new Error("Session expired. Please log in again.");
  }
  const refreshed = (await refreshResponse.json()) as AuthSuccessResponse;
  return setIdentityFromAuthSuccess(refreshed);
};

export const findActivePlayerGameCode = async (): Promise<string | null> => {
  const current = getStoredIdentity();
  if (!current) {
    throw new Error("Identity missing. Return to the landing page and choose an identity.");
  }

  const doLookup = async (payload: unknown) =>
    fetch(`${API_BASE}/api/game/active`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity: payload }),
    });

  let response = await doLookup(buildIdentityPayload(current));
  if (!response.ok && response.status === 401 && current.mode === "token") {
    const nextIdentity = await refreshSessionOrThrow(current);
    response = await doLookup(buildIdentityPayload(nextIdentity));
  }
  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { code?: string | null };
  return typeof data.code === "string" && data.code.trim() ? data.code.trim().toUpperCase() : null;
};

export async function createFriendGameFromPrefill(
  prefill: PlayLobbyPrefill,
  options?: { turnstileToken?: string | null; skipActiveGameCheck?: boolean },
): Promise<CreateFriendGameResult> {
  if (!options?.skipActiveGameCheck) {
    const activeCode = await findActivePlayerGameCode();
    if (activeCode) {
      const conflict = new Error("Already in an ongoing game") as Error & { activeCode: string };
      conflict.activeCode = activeCode;
      throw conflict;
    }
  }

  const current = getStoredIdentity();
  if (!current) {
    throw new Error("Identity missing. Return to the landing page and choose an identity.");
  }

  const submitPayload = prefillToSubmitPayload(prefill);
  const lockedState = prefill.positionLocked && prefill.initialState ? prefill.initialState : null;
  const lockedStartColor = lockedState ? (lockedState.turn === 0 ? "black" : "white") : null;
  const roomSettings = lockedState
    ? {
        ...submitPayload.roomSettings,
        hostColor: lockedStartColor ?? submitPayload.roomSettings.hostColor,
        startColor: lockedStartColor ?? submitPayload.roomSettings.startColor,
        setupConfig: engine.normalizeSetupConfig({ enabled: false }),
        setupSelections: { black: null, white: null },
      }
    : submitPayload.roomSettings;

  const requestBody = {
    timeControl: submitPayload.timeControl,
    roomSettings,
    ...(lockedState
      ? {
          boardBytesB64: engine.packBoard(Uint8Array.from(lockedState.board)),
          initialTurn: lockedState.turn,
        }
      : {}),
    identity: buildIdentityPayload(current),
    ...(options?.turnstileToken ? { turnstileToken: options.turnstileToken } : {}),
  };

  const doCreate = async (identityPayload: unknown) =>
    fetch(`${API_BASE}/api/game/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...requestBody, identity: identityPayload }),
    });

  let response = await doCreate(requestBody.identity);
  if (!response.ok && response.status === 401 && current.mode === "token") {
    const nextIdentity = await refreshSessionOrThrow(current);
    response = await doCreate(buildIdentityPayload(nextIdentity));
  }

  if (!response.ok) {
    if (response.status === 409) {
      const errData = await response.json().catch(() => ({ error: "Already in an ongoing game", code: null }));
      const redirectCode = typeof errData.code === "string" ? errData.code : null;
      if (redirectCode) {
        const conflict = new Error(errData.error || "Already in an ongoing game") as Error & { activeCode: string };
        conflict.activeCode = redirectCode;
        throw conflict;
      }
    }
    const errData = await response.json().catch(() => ({ error: "Failed to create game" }));
    throw new Error(errData.error || "Failed to create game");
  }

  const data = (await response.json()) as {
    code: string;
    gameId: string;
    token: string;
    seat?: string;
    participant?: {
      accountId: string;
      name: string;
      email: string | null;
      mode: "guest" | "token";
    };
  };

  if (data.participant) {
    const merged = mergeIdentityFromParticipant(getStoredIdentity(), data.participant);
    setStoredIdentity(merged);
  }

  localStorage.setItem(`game_token_${data.code}`, data.token);
  localStorage.setItem(`game_id_${data.code}`, data.gameId);
  localStorage.setItem(`game_seat_${data.code}`, data.seat ?? "spectator");

  return {
    code: data.code,
    gameId: data.gameId,
    token: data.token,
    seat: data.seat ?? "spectator",
  };
}

export function persistFriendGameSession(result: CreateFriendGameResult): void {
  localStorage.setItem(`game_token_${result.code}`, result.token);
  localStorage.setItem(`game_id_${result.code}`, result.gameId);
  localStorage.setItem(`game_seat_${result.code}`, result.seat);
}

type NavigateFn = (path: string, options?: { replace?: boolean }) => void;

export async function openFriendLobbyFromPrefill(
  navigate: NavigateFn,
  prefill: PlayLobbyPrefill,
): Promise<boolean> {
  try {
    const result = await createFriendGameFromPrefill(prefill);
    clearFriendLobbyPrefill();
    navigate(`/game/${result.code}`);
    return true;
  } catch (err) {
    const activeCode =
      err && typeof err === "object" && "activeCode" in err && typeof (err as { activeCode?: string }).activeCode === "string"
        ? (err as { activeCode: string }).activeCode
        : null;
    if (activeCode) {
      clearFriendLobbyPrefill();
      navigate(`/game/${activeCode}`, { replace: true });
      return true;
    }
    throw err;
  }
}
