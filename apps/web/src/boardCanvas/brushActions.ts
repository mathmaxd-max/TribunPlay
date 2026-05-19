import * as engine from "@tribunplay/engine";

export type BrushHeight = 1 | 2 | 3 | 4 | 6 | 8 | "eraser";

export type BrushToolState = {
  activeColor: engine.Color;
  height: BrushHeight;
  tribun: boolean;
  enslave: boolean;
  overwrite: boolean;
};

export type BoardCanvasCell = engine.Unit | null;

export type BrushActionResult = {
  board: Uint8Array;
  feedback: string;
  clearedTribunCids: number[];
};

const VALID_BRUSH_HEIGHTS = new Set<engine.Height>([1, 2, 3, 4, 6, 8]);

function cloneBoard(board: Uint8Array): Uint8Array {
  return new Uint8Array(board);
}

function unitsEqual(a: BoardCanvasCell, b: BoardCanvasCell): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.color === b.color && a.tribun === b.tribun && a.p === b.p && a.s === b.s;
}

function getUnit(board: Uint8Array, cid: number): BoardCanvasCell {
  return engine.unitByteToUnit(board[cid]);
}

function setUnit(board: Uint8Array, cid: number, unit: BoardCanvasCell): void {
  board[cid] = engine.unitToUnitByte(unit);
}

function liberateSecondary(unit: engine.Unit): engine.Unit {
  return {
    color: unit.color === 0 ? 1 : 0,
    tribun: false,
    p: unit.s,
    s: 0,
  };
}

function isSlavePropertyValid(primary: engine.Height, secondary: engine.Height): boolean {
  if (secondary <= 0) return true;
  if (primary <= 0) return false;
  return primary <= 4 && primary * 2 >= secondary;
}

function clearOtherTribuns(board: Uint8Array, targetCid: number, color: engine.Color): number[] {
  const cleared: number[] = [];
  for (let cid = 0; cid < 121; cid += 1) {
    if (cid === targetCid || !engine.isValidTile(cid)) continue;
    const unit = getUnit(board, cid);
    if (!unit || !unit.tribun || unit.color !== color) continue;
    cleared.push(cid);
    if (unit.s > 0) {
      setUnit(board, cid, liberateSecondary(unit));
      continue;
    }
    setUnit(board, cid, null);
  }
  return cleared;
}

/**
 * Left-click mutation order (normative):
 * 1) Branch by tile occupancy/ownership (empty, own, enemy).
 * 2) Apply eraser or placement mutation gates (overwrite/enslave) for that branch.
 * 3) If placing with tribun toggle, force this tile to tribun and clear other tribuns
 *    of the same side, liberating removed slave tribuns.
 */
export function applyLeftBrush(board: Uint8Array, cid: number, tool: BrushToolState): BrushActionResult | null {
  if (!engine.isValidTile(cid)) return null;
  if (tool.height !== "eraser" && !VALID_BRUSH_HEIGHTS.has(tool.height)) return null;

  const current = getUnit(board, cid);
  const selectedHeight = tool.height === "eraser" ? null : (tool.height as engine.Height);
  let nextAtTile: BoardCanvasCell = current;
  let feedback = "No changes";

  if (!current) {
    if (tool.height === "eraser") return null;
    nextAtTile = { color: tool.activeColor, tribun: false, p: selectedHeight as engine.Height, s: 0 };
    feedback = "Placed unit";
  } else if (current.color === tool.activeColor) {
    if (tool.height === "eraser") {
      nextAtTile = current.s > 0 ? liberateSecondary(current) : null;
      feedback = current.s > 0 ? "Liberated own slave unit" : "Erased own unit";
    } else {
      if (!tool.overwrite) return null;
      const keepSecondary = tool.enslave ? current.s : 0;
      nextAtTile = {
        color: current.color,
        tribun: current.tribun,
        p: selectedHeight as engine.Height,
        s: keepSecondary,
      };
      feedback = current.s > 0 && !tool.enslave ? "Overwrote own unit and cleared slave" : "Overwrote own unit";
    }
  } else {
    if (tool.height === "eraser") {
      if (tool.enslave && current.s > 0) {
        nextAtTile = liberateSecondary(current);
        feedback = "Liberated enemy slave unit";
      } else {
        nextAtTile = null;
        feedback = "Erased enemy unit";
      }
    } else if (tool.enslave && !current.tribun && current.s === 0) {
      if (!isSlavePropertyValid(selectedHeight as engine.Height, current.p)) return null;
      nextAtTile = {
        color: tool.activeColor,
        tribun: false,
        p: selectedHeight as engine.Height,
        s: current.p,
      };
      feedback = "Enslaved enemy unit";
    } else if (!tool.enslave && tool.overwrite) {
      nextAtTile = {
        color: tool.activeColor,
        tribun: false,
        p: selectedHeight as engine.Height,
        s: 0,
      };
      feedback = "Replaced enemy unit";
    } else {
      return null;
    }
  }

  if (nextAtTile && !isSlavePropertyValid(nextAtTile.p, nextAtTile.s)) {
    return null;
  }

  const nextBoard = cloneBoard(board);
  const hadTileChange = !unitsEqual(current, nextAtTile);
  if (hadTileChange) {
    setUnit(nextBoard, cid, nextAtTile);
  }

  let clearedTribunCids: number[] = [];
  if (tool.height !== "eraser" && tool.tribun) {
    const placed = getUnit(nextBoard, cid);
    if (placed) {
      if (!placed.tribun) {
        setUnit(nextBoard, cid, { ...placed, tribun: true });
      }
      clearedTribunCids = clearOtherTribuns(nextBoard, cid, placed.color);
      if (clearedTribunCids.length > 0) {
        feedback = `Set Tribun and cleared ${clearedTribunCids.length} other Tribun${clearedTribunCids.length === 1 ? "" : "s"}`;
      } else if (!placed.tribun) {
        feedback = "Set Tribun";
      }
    }
  }

  if (!hadTileChange) {
    const now = getUnit(nextBoard, cid);
    const tileChangedByTribunToggle = !unitsEqual(current, now);
    if (!tileChangedByTribunToggle && clearedTribunCids.length === 0) return null;
  }

  return {
    board: nextBoard,
    feedback,
    clearedTribunCids,
  };
}

export function applyRightErase(board: Uint8Array, cid: number, tool?: Pick<BrushToolState, "enslave">): BrushActionResult | null {
  if (!engine.isValidTile(cid)) return null;
  const current = getUnit(board, cid);
  if (!current) return null;
  const nextBoard = cloneBoard(board);
  const shouldLiberate = Boolean(tool?.enslave) && current.s > 0;
  setUnit(nextBoard, cid, shouldLiberate ? liberateSecondary(current) : null);
  return {
    board: nextBoard,
    feedback: shouldLiberate ? "Liberated slave unit" : "Erased tile",
    clearedTribunCids: current.tribun ? [cid] : [],
  };
}
