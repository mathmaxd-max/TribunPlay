import * as engine from "@tribunplay/engine";
import type { TutorialChapterDef } from "./chapters";
import { OPCODE_ENSLAVE, OPCODE_SYM_COMBINE } from "./opcodes";

export type MovementSelector = "1T" | "1" | "2/2T" | "3/3T" | "4/4T" | "6/6T" | "8/8T";

type MovementSelectorRule = {
  heights: engine.Height[];
  tribunMode: "only" | "exclude" | "any";
};

const MOVEMENT_SELECTOR_RULES: Record<MovementSelector, MovementSelectorRule> = {
  "1T": { heights: [1], tribunMode: "only" },
  "1": { heights: [1], tribunMode: "exclude" },
  "2/2T": { heights: [2], tribunMode: "any" },
  "3/3T": { heights: [3], tribunMode: "any" },
  "4/4T": { heights: [4], tribunMode: "any" },
  "6/6T": { heights: [6], tribunMode: "any" },
  "8/8T": { heights: [8], tribunMode: "any" },
};

function actionOriginCid(action: number): number | null {
  const decoded = engine.decodeAction(action);
  if (decoded.opcode === 0) return decoded.fields.fromCid;
  if (decoded.opcode === 1) return decoded.fields.attackerCid;
  return null;
}

export function isOpcodeAllowed(opcode: number, chapter: TutorialChapterDef, allowedOpcodes: readonly number[]): boolean {
  if (!allowedOpcodes.includes(opcode)) return false;
  if (chapter.restrictions?.noSymCombine && opcode === OPCODE_SYM_COMBINE) return false;
  if (chapter.restrictions?.noEnslave && opcode === OPCODE_ENSLAVE) return false;
  return true;
}

function matchesMovementSelector(
  state: engine.State,
  action: number,
  selectedUnitType: MovementSelector | null,
): boolean {
  if (!selectedUnitType) return true;
  const originCid = actionOriginCid(action);
  if (originCid === null) return false;
  return unitMatchesMovementSelector(state, originCid, selectedUnitType);
}

export function unitMatchesMovementSelector(
  state: engine.State,
  cid: number,
  selectedUnitType: MovementSelector | null,
): boolean {
  if (!selectedUnitType) return true;
  const unit = engine.unitByteToUnit(state.board[cid]);
  if (!unit || unit.color !== state.turn) return false;
  const rule = MOVEMENT_SELECTOR_RULES[selectedUnitType];
  if (!rule.heights.includes(unit.p)) return false;
  if (rule.tribunMode === "only") return unit.tribun;
  if (rule.tribunMode === "exclude") return !unit.tribun;
  return true;
}

export function filterLegalActions(params: {
  state: engine.State;
  actions: Uint32Array;
  chapter: TutorialChapterDef;
  allowedOpcodes: readonly number[];
  selectedUnitType?: MovementSelector | null;
}): number[] {
  const { state, actions, chapter, allowedOpcodes, selectedUnitType } = params;
  const filtered: number[] = [];

  for (const action of actions) {
    const decoded = engine.decodeAction(action);
    if (!isOpcodeAllowed(decoded.opcode, chapter, allowedOpcodes)) {
      continue;
    }
    if (chapter.id === "movement" && !matchesMovementSelector(state, action, selectedUnitType ?? null)) {
      continue;
    }
    filtered.push(action >>> 0);
  }

  return filtered;
}
