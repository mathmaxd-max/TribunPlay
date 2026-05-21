import * as engine from "@tribunplay/engine";
import boardsJson from "./boards.json";

type RawBoardColor = "black" | "white";
type RawBoardTurn = "black" | "white";
type RawHeight = 1 | 2 | 3 | 4 | 6 | 8;

type RawBoardUnit = {
  x: number;
  y: number;
  color: RawBoardColor;
  p: RawHeight;
  s?: RawHeight;
  tribun?: boolean;
};

type RawBoardDefinition = {
  useEngineDefault?: boolean;
  turn?: RawBoardTurn;
  units?: RawBoardUnit[];
};

type RawBoardsFile = {
  boards: Record<string, RawBoardDefinition>;
};

const HEIGHTS = new Set([1, 2, 3, 4, 6, 8]);

const rawData = boardsJson as RawBoardsFile;

export const TUTORIAL_BOARD_IDS = Object.keys(rawData.boards) as string[];
export type TutorialBoardPresetId = (typeof TUTORIAL_BOARD_IDS)[number];

function toEngineColor(color: RawBoardColor | RawBoardTurn): engine.Color {
  return color === "black" ? 0 : 1;
}

function assertValidHeight(value: number, label: string): asserts value is RawHeight {
  if (!HEIGHTS.has(value)) {
    throw new Error(`Invalid ${label} height: ${value}`);
  }
}

function createEngineState(board: Uint8Array, turn: engine.Color): engine.State {
  return {
    board,
    turn,
    ply: 0,
    drawOfferBy: null,
    drawOfferBlocked: null,
    status: "active",
    winner: null,
  };
}

export function loadTutorialBoardState(boardId: TutorialBoardPresetId): engine.State {
  const definition = rawData.boards[boardId];
  if (!definition) {
    throw new Error(`Unknown tutorial board id: ${boardId}`);
  }
  if (definition.useEngineDefault) {
    return createEngineState(engine.createInitialBoard(), 0);
  }
  if (!definition.turn) {
    throw new Error(`Board "${boardId}" is missing "turn".`);
  }
  if (!definition.units || !Array.isArray(definition.units)) {
    throw new Error(`Board "${boardId}" is missing "units".`);
  }

  const board = new Uint8Array(121);
  definition.units.forEach((unit, index) => {
    if (!Number.isFinite(unit.x) || !Number.isFinite(unit.y)) {
      throw new Error(`Board "${boardId}" unit #${index} has invalid coordinates.`);
    }
    if (unit.color !== "black" && unit.color !== "white") {
      throw new Error(`Board "${boardId}" unit #${index} has invalid color.`);
    }
    assertValidHeight(unit.p, "primary");
    if (unit.s !== undefined) {
      assertValidHeight(unit.s, "secondary");
    }
    const cid = engine.encodeCoord(unit.x, unit.y);
    if (board[cid] !== 0) {
      throw new Error(`Board "${boardId}" has duplicate unit placement at (${unit.x}, ${unit.y}).`);
    }
    board[cid] = engine.unitToUnitByte({
      color: toEngineColor(unit.color),
      tribun: Boolean(unit.tribun),
      p: unit.p,
      s: unit.s ?? 0,
    });
  });

  return createEngineState(board, toEngineColor(definition.turn));
}

