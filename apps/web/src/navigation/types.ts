import * as engine from "@tribunplay/engine";
import type { BrushToolState } from "../boardCanvas/brushActions";
import type { SideToMove } from "../boardCanvas/boardState";
import type { PlayLobbyFormValues } from "../play/types";

export type RouteKey = "setup-explorer" | "board-canvas";

export type SetupCellSnapshot = {
  height: 0 | 1 | 2 | 3;
  tribun: boolean;
};

export type SetupExplorerSnapshot = {
  ownCells: SetupCellSnapshot[];
  enemyCells: SetupCellSnapshot[];
  previewMode: "empty" | "hash";
  brush: "1" | "2" | "3" | "eraser";
  tribunBrush: boolean;
  onlyEmpty: boolean;
  userFlip180: boolean;
  playerColor: "black" | "white";
  unitViewMode: "icon" | "number";
  defenseMode: "none" | "empty" | "occupied" | "all";
  ownHashInput: string;
  enemyHashInput: string;
  scrollY: number;
};

export type BoardCanvasSnapshot = {
  board: number[];
  sideToMove: SideToMove;
  tool: BrushToolState;
  userFlip180: boolean;
  unitViewMode: "icon" | "number";
  scrollY: number;
};

export type BoardCanvasImport = {
  board: number[];
  sideToMove: SideToMove;
};

export type SerializedEngineState = {
  board: number[];
  turn: engine.Color;
  ply: number;
  drawOfferBy: engine.Color | null;
  drawOfferBlocked: engine.Color | null;
  status: "active" | "ended";
  winner: engine.Color | null;
};

export type PlayLobbyPrefill = {
  initialValues?: Partial<PlayLobbyFormValues>;
  initialState?: SerializedEngineState;
  resolvedStartColor?: "black" | "white";
  /** True when a fixed board position is imported and setup UI must stay hidden. */
  positionLocked?: boolean;
};

export type SetupExplorerRouteState = {
  fresh?: boolean;
};

export type BoardCanvasRouteState = {
  fresh?: boolean;
  boardCanvasImport?: BoardCanvasImport;
};

export type LobbyRouteState = {
  playLobbyPrefill?: PlayLobbyPrefill;
};
