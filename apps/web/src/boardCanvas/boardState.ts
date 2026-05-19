import * as engine from "@tribunplay/engine";

export type SideToMove = "black" | "white";

export type BoardCanvasState = {
  board: Uint8Array;
  sideToMove: SideToMove;
};

export type EngineStateValidation =
  | { ok: true; state: engine.State }
  | { ok: false; state: engine.State; issues: string[] };

const VALID_CIDS: number[] = (() => {
  const out: number[] = [];
  for (let cid = 0; cid < 121; cid += 1) {
    if (engine.isValidTile(cid)) out.push(cid);
  }
  return out;
})();

export function getValidBoardCids(): readonly number[] {
  return VALID_CIDS;
}

export function createEmptyCanvasBoard(): Uint8Array {
  return new Uint8Array(121);
}

function toEngineColor(sideToMove: SideToMove): engine.Color {
  return sideToMove === "black" ? 0 : 1;
}

function isSlavePropertyValid(primary: engine.Height, secondary: engine.Height): boolean {
  if (secondary <= 0) return true;
  if (primary <= 0) return false;
  return primary <= 4 && primary * 2 >= secondary;
}

function validateBoard(board: Uint8Array): string[] {
  const issues: string[] = [];
  let blackTribuns = 0;
  let whiteTribuns = 0;

  for (const cid of VALID_CIDS) {
    const unit = engine.unitByteToUnit(board[cid]);
    if (!unit) continue;

    if (unit.tribun) {
      if (unit.color === 0) blackTribuns += 1;
      else whiteTribuns += 1;
    }

    if (!isSlavePropertyValid(unit.p, unit.s)) {
      issues.push(`Slave property violated at cid ${cid}`);
    }
    if (unit.tribun && unit.s > 0) {
      issues.push(`Tribun cannot be a slave at cid ${cid}`);
    }
  }

  if (blackTribuns !== 1) issues.push(`Black Tribun count must be 1 (currently ${blackTribuns})`);
  if (whiteTribuns !== 1) issues.push(`White Tribun count must be 1 (currently ${whiteTribuns})`);

  return issues;
}

export function toEngineState(canvas: BoardCanvasState): EngineStateValidation {
  const board = new Uint8Array(121);
  for (const cid of VALID_CIDS) {
    board[cid] = canvas.board[cid] ?? 0;
  }

  const state: engine.State = {
    board,
    turn: toEngineColor(canvas.sideToMove),
    ply: 0,
    drawOfferBy: null,
    drawOfferBlocked: null,
    status: "active",
    winner: null,
  };

  const issues = validateBoard(board);
  if (issues.length > 0) {
    return { ok: false, state, issues };
  }
  return { ok: true, state };
}

export function fromEngineState(state: engine.State): BoardCanvasState {
  return {
    board: new Uint8Array(state.board),
    sideToMove: state.turn === 0 ? "black" : "white",
  };
}

