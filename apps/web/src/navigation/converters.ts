import * as engine from "@tribunplay/engine";
import { fromEngineState } from "../boardCanvas/boardState";
import type { SideToMove } from "../boardCanvas/boardState";
import type { PlayLobbyFormValues } from "../play/types";
import type {
  BoardCanvasImport,
  PlayLobbyPrefill,
  SerializedEngineState,
  SetupCellSnapshot,
} from "./types";

export const OWN_SETUP_CIDS = [
  120, 119, 109, 118, 108, 98, 117, 107, 97, 87, 116, 106, 96, 86, 76, 115, 105, 95, 85, 75, 65,
  104, 94, 84, 74, 64, 103, 93, 83, 73, 63, 53, 92, 82, 72, 62, 52,
] as const;

export const ENEMY_SETUP_CIDS = OWN_SETUP_CIDS.map((ownCid) => {
  const { x, y } = engine.decodeCoord(ownCid);
  return engine.encodeCoord(-x, -y);
});

const BLACK_SETUP_CIDS = ENEMY_SETUP_CIDS;
const WHITE_SETUP_CIDS = OWN_SETUP_CIDS;

const BLACK_CID_TO_INDEX = new Map<number, number>();
const WHITE_CID_TO_INDEX = new Map<number, number>();
for (let i = 0; i < OWN_SETUP_CIDS.length; i += 1) {
  BLACK_CID_TO_INDEX.set(BLACK_SETUP_CIDS[i], i);
  WHITE_CID_TO_INDEX.set(WHITE_SETUP_CIDS[i], i);
}

type SetupMasks = {
  tribTile: number;
  mask3: bigint;
  mask2: bigint;
  mask1: bigint;
};

function createEmptySetupCells(): SetupCellSnapshot[] {
  return Array.from({ length: OWN_SETUP_CIDS.length }, () => ({ height: 0 as const, tribun: false }));
}

function cellsToSetupMasks(cells: SetupCellSnapshot[]): SetupMasks | null {
  let tribTile = -1;
  let mask3 = 0n;
  let mask2 = 0n;
  let mask1 = 0n;
  for (let i = 0; i < cells.length; i += 1) {
    const cell = cells[i];
    if (cell.height === 0) continue;
    if (cell.tribun) {
      if (tribTile !== -1) return null;
      tribTile = i;
    }
    if (cell.height === 3) mask3 |= 1n << BigInt(i);
    else if (cell.height === 2) mask2 |= 1n << BigInt(i);
    else if (cell.height === 1) mask1 |= 1n << BigInt(i);
    else return null;
  }
  if (tribTile === -1) return null;
  return { tribTile, mask3, mask2, mask1 };
}

function encodeSetupHash(cells: SetupCellSnapshot[]): string | null {
  const masks = cellsToSetupMasks(cells);
  if (!masks) return null;
  const encoded = engine.encodePositionDetailed(masks);
  if (!encoded.ok) return null;
  return encoded.code;
}

export function serializeEngineState(state: engine.State): SerializedEngineState {
  return {
    board: Array.from(state.board),
    turn: state.turn,
    ply: state.ply,
    drawOfferBy: state.drawOfferBy,
    drawOfferBlocked: state.drawOfferBlocked ?? null,
    status: state.status,
    winner: state.winner ?? null,
  };
}

export function deserializeEngineState(value: SerializedEngineState): engine.State {
  return {
    board: Uint8Array.from(value.board),
    turn: value.turn,
    ply: value.ply,
    drawOfferBy: value.drawOfferBy,
    drawOfferBlocked: value.drawOfferBlocked,
    status: value.status,
    winner: value.winner,
  };
}

export function toPlayerColor(turn: engine.Color): "black" | "white" {
  return turn === 0 ? "black" : "white";
}

export function normalizeStateForContinue(state: engine.State): engine.State {
  return {
    board: Uint8Array.from(state.board),
    turn: state.turn,
    ply: state.ply,
    drawOfferBy: null,
    drawOfferBlocked: null,
    status: "active",
    winner: null,
  };
}

export function buildCanvasLocalPrefill(state: engine.State): PlayLobbyPrefill {
  return buildPlayLobbyPrefillFromEngineState(state);
}

export function buildPlayLobbyPrefillFromEngineState(state: engine.State): PlayLobbyPrefill {
  const startColor = toPlayerColor(state.turn);
  return {
    initialValues: {
      hostColor: startColor,
      startColor,
      customSetupsEnabled: false,
      sharedSetupHash: "",
      freeBlackSetupHash: "",
      freeWhiteSetupHash: "",
      sharedFlipBlack: false,
      sharedFlipWhite: false,
      freeBlackFlip: false,
      freeWhiteFlip: false,
    },
    initialState: serializeEngineState(state),
    resolvedStartColor: startColor,
    positionLocked: true,
  };
}

export type ContinueTargetsFromState = {
  boardCanvasImport: BoardCanvasImport;
  localPrefill: PlayLobbyPrefill;
  friendPrefill: PlayLobbyPrefill | null;
  friendDisabledReason: string | null;
};

export function buildContinueTargetsFromEngineState(state: engine.State): ContinueTargetsFromState {
  const boardCanvasImport = fromEngineState(state);
  const playableState = normalizeStateForContinue(state);
  const localPrefill = buildPlayLobbyPrefillFromEngineState(playableState);
  const friendPrefill = buildPlayLobbyPrefillFromEngineState(playableState);
  return {
    boardCanvasImport,
    localPrefill,
    friendPrefill,
    friendDisabledReason: null,
  };
}

export function setupExplorerToBoardCanvasImport(input: {
  ownCells: SetupCellSnapshot[];
  enemyCells: SetupCellSnapshot[];
  previewMode: "empty" | "hash";
  playerColor: "black" | "white";
}): BoardCanvasImport | null {
  const { ownCells, enemyCells, previewMode, playerColor } = input;
  if (ownCells.length !== OWN_SETUP_CIDS.length || enemyCells.length !== OWN_SETUP_CIDS.length) {
    return null;
  }

  const board = new Uint8Array(121);
  const ownIsBlack = playerColor === "black";
  const ownColor: engine.Color = ownIsBlack ? 0 : 1;
  const enemyColor: engine.Color = ownIsBlack ? 1 : 0;
  const ownSetupCids = ownIsBlack ? ENEMY_SETUP_CIDS : OWN_SETUP_CIDS;
  const enemySetupCids = ownIsBlack ? OWN_SETUP_CIDS : ENEMY_SETUP_CIDS;

  // Setup index 0..36 is stable canonical setup space. We only remap to board CIDs per chosen side.
  for (let i = 0; i < ownCells.length; i += 1) {
    const ownCell = ownCells[i];
    if (ownCell.height > 0) {
      board[ownSetupCids[i]] = engine.unitToUnitByte({
        color: ownColor,
        tribun: ownCell.tribun,
        p: ownCell.height,
        s: 0,
      });
    }
    if (previewMode === "hash") {
      const enemyCell = enemyCells[i];
      if (enemyCell.height > 0) {
        board[enemySetupCids[i]] = engine.unitToUnitByte({
          color: enemyColor,
          tribun: enemyCell.tribun,
          p: enemyCell.height,
          s: 0,
        });
      }
    }
  }

  return {
    board: Array.from(board),
    sideToMove: "black",
  };
}

export function makeFreeUnrestrictedLobbyPrefill(params: {
  black: { hash: string; flip: boolean };
  white: { hash: string; flip: boolean };
}): Partial<PlayLobbyFormValues> {
  const { black, white } = params;
  // M08 prefill mapping: custom setups on, free mode, unrestricted constraints, black/white hash+flip selections.
  return {
    customSetupsEnabled: true,
    setupMode: "free",
    allowedTribunHeights: [1, 2, 3],
    armyMin: "",
    armyMax: "",
    freeBlackSetupHash: black.hash,
    freeBlackFlip: black.flip,
    freeWhiteSetupHash: white.hash,
    freeWhiteFlip: white.flip,
  };
}

export function tryEncodeCanvasAsSetupHashes(board: Uint8Array): {
  ok: true;
  blackHash: string;
  whiteHash: string;
} | {
  ok: false;
  reason: string;
} {
  const blackCells = createEmptySetupCells();
  const whiteCells = createEmptySetupCells();
  let blackTribuns = 0;
  let whiteTribuns = 0;

  for (let cid = 0; cid < board.length; cid += 1) {
    if (!engine.isValidTile(cid)) continue;
    const unit = engine.unitByteToUnit(board[cid]);
    if (!unit) continue;

    if (unit.s > 0) {
      return { ok: false, reason: "Position has slave units." };
    }
    if (unit.p < 1 || unit.p > 3) {
      return { ok: false, reason: "Position has heights outside setup range." };
    }

    if (unit.color === 0) {
      const idx = BLACK_CID_TO_INDEX.get(cid);
      if (idx === undefined) {
        return { ok: false, reason: "Black has units outside setup region." };
      }
      if (blackCells[idx].height > 0) {
        return { ok: false, reason: "Black setup overlap detected." };
      }
      blackCells[idx] = { height: unit.p, tribun: unit.tribun };
      if (unit.tribun) blackTribuns += 1;
      continue;
    }

    const idx = WHITE_CID_TO_INDEX.get(cid);
    if (idx === undefined) {
      return { ok: false, reason: "White has units outside setup region." };
    }
    if (whiteCells[idx].height > 0) {
      return { ok: false, reason: "White setup overlap detected." };
    }
    whiteCells[idx] = { height: unit.p, tribun: unit.tribun };
    if (unit.tribun) whiteTribuns += 1;
  }

  if (blackTribuns !== 1 || whiteTribuns !== 1) {
    return { ok: false, reason: "Each side must have exactly one Tribun." };
  }

  const blackHash = encodeSetupHash(blackCells);
  const whiteHash = encodeSetupHash(whiteCells);
  if (!blackHash || !whiteHash) {
    return { ok: false, reason: "Position cannot be encoded as setup hashes." };
  }

  return { ok: true, blackHash, whiteHash };
}

export function toBoardCanvasArray(board: Uint8Array): number[] {
  return Array.from(board);
}

export function fromBoardCanvasArray(board: number[]): Uint8Array {
  return Uint8Array.from(board);
}

export function toSideLabel(turn: engine.Color): SideToMove {
  return turn === 0 ? "black" : "white";
}
