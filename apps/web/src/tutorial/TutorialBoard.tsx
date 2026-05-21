import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import * as engine from "@tribunplay/engine";
import { getBaseColor, getHexagonColor, type HexagonState } from "../hexagonColors";
import { SplitUnitGlyph, UnitGlyph } from "../ui/UnitGlyph";
import { areAllUnitIconsReady, preloadAllUnitIcons } from "../ui/unitIcons";
import { useBoardSfx } from "../audio/boardSfx";
import type { UiMoveCache } from "../ui/cache/UiMoveCache";
import { buildTutorialCache } from "./buildTutorialCache";
import type { TutorialChapterDef } from "./chapters";
import { modeAllowsOwnPrimary, modeAllowsSymmetry, type TutorialInteractionMode } from "./interactionMode";
import { filterLegalActions, type MovementSelector, unitMatchesMovementSelector } from "./policy";
import MovementPatternDiagram from "./movementDiagram/MovementPatternDiagram";
import { createTutorialPresetState, type TutorialBoardPresetId } from "./presets";

type EmptyCache = UiMoveCache["empty"] extends Map<any, infer T> ? T : never;

type EmptySymmetryState = {
  mode: "sym3+" | "sym3-" | "sym6";
  donate: number;
  savedDonors: Map<number, number>;
  donorCids: number[];
};

type UIState =
  | { type: "idle" }
  | { type: "enemy"; targetCid: number; optionIndex: number }
  | { type: "empty"; centerCid: number; donors: Map<number, number>; optionIndex: number; symmetry?: EmptySymmetryState }
  | { type: "own_primary"; originCid: number; targetCid: number | null; optionIndex: number }
  | { type: "own_secondary"; originCid: number; allocations: number[] };

type PreviewOverlayUnit = { p: number; s: number; color: engine.Color; tribun: boolean };
type PreviewOverlay = { units: Map<number, PreviewOverlayUnit>; empty: Set<number> };
type TilePixelData = { cid: number; x: number; y: number; centerX: number; centerY: number; hexX: number; hexY: number };

type TutorialBoardProps = {
  chapter: TutorialChapterDef;
  boardPreset: TutorialBoardPresetId;
  allowedOpcodes: number[];
  interactionMode: TutorialInteractionMode;
  resetKey?: string;
};

const MOVEMENT_SELECTOR_OPTIONS: MovementSelector[] = ["1T", "1", "2/2T", "3/3T", "4/4T", "6/6T", "8/8T"];

const TUTORIAL_PANEL_STYLE = {
  width: "100%",
  border: "2px solid #3c3226",
  borderRadius: "16px",
  background: "rgba(255, 250, 242, 0.88)",
} as const;
const NEIGHBOR_VECTORS = [[1, 1], [1, 0], [0, 1], [-1, -1], [-1, 0], [0, -1]] as const;
const VALID_HEIGHTS = new Set([0, 1, 2, 3, 4, 6, 8]);
const VALID_SPLIT_HEIGHTS = new Set([0, 1, 2, 3, 4, 6]);

const isValidHeight = (value: number): boolean => VALID_HEIGHTS.has(value);
const isValidSplitHeight = (value: number): boolean => VALID_SPLIT_HEIGHTS.has(value);
const cycleIndex = (currentIndex: number, delta: number, length: number) => (length <= 0 ? 0 : ((currentIndex + delta) % length + length) % length);

const isUiStateEqual = (a: UIState, b: UIState): boolean => {
  if (a.type !== b.type) return false;
  if (a.type === "idle") return true;
  if (a.type === "enemy" && b.type === "enemy") return a.targetCid === b.targetCid && a.optionIndex === b.optionIndex;
  if (a.type === "own_primary" && b.type === "own_primary") return a.originCid === b.originCid && a.targetCid === b.targetCid && a.optionIndex === b.optionIndex;
  if (a.type === "own_secondary" && b.type === "own_secondary") return a.originCid === b.originCid && a.allocations.every((value, index) => value === b.allocations[index]);
  if (a.type === "empty" && b.type === "empty") {
    if (a.centerCid !== b.centerCid || a.optionIndex !== b.optionIndex || a.donors.size !== b.donors.size) return false;
    for (const [cid, value] of a.donors.entries()) if (b.donors.get(cid) !== value) return false;
    if (!a.symmetry && !b.symmetry) return true;
    if (!a.symmetry || !b.symmetry) return false;
    if (a.symmetry.mode !== b.symmetry.mode || a.symmetry.donate !== b.symmetry.donate) return false;
    if (a.symmetry.donorCids.length !== b.symmetry.donorCids.length) return false;
    for (let i = 0; i < a.symmetry.donorCids.length; i += 1) if (a.symmetry.donorCids[i] !== b.symmetry.donorCids[i]) return false;
    return true;
  }
  return false;
};

function modeLabel(mode: TutorialInteractionMode): string {
  if (mode === "move-only") return "Movement mode";
  if (mode === "damage-only") return "Damage mode";
  if (mode === "combine-only") return "Combine mode";
  if (mode === "split-only") return "Split mode";
  if (mode === "traditional") return "Traditional mode";
  if (mode === "sym-combine-only") return "Sym-combine mode";
  if (mode === "impero-a") return "Impero A mode";
  return "Impero B mode";
}

function getNeighborDirection(centerCid: number, neighborCid: number): number | null {
  try {
    const { x: cx, y: cy } = engine.decodeCoord(centerCid);
    const { x: nx, y: ny } = engine.decodeCoord(neighborCid);
    const dx = nx - cx;
    const dy = ny - cy;
    for (let dir = 0; dir < NEIGHBOR_VECTORS.length; dir += 1) {
      const [vx, vy] = NEIGHBOR_VECTORS[dir];
      if (vx === dx && vy === dy) return dir;
    }
  } catch {
    return null;
  }
  return null;
}

function buildBoardMetrics(): { tiles: TilePixelData[]; width: number; height: number } {
  const innerHexSize = 45;
  const borderWidth = 2;
  const spacingMultiplier = 0.98;
  const outerHexSize = innerHexSize + borderWidth;
  const centerSize = outerHexSize * spacingMultiplier;
  const d = (Math.sqrt(3) / 2) * centerSize;
  const outerHexWidth = 2 * outerHexSize;
  const outerHexHeight = Math.sqrt(3) * outerHexSize;
  const validTiles: Array<{ cid: number; x: number; y: number }> = [];
  for (let cid = 0; cid < 121; cid += 1) {
    if (engine.isValidTile(cid)) {
      const { x, y } = engine.decodeCoord(cid);
      validTiles.push({ cid, x, y });
    }
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  validTiles.forEach(({ x, y }) => {
    const displayX = -x;
    const displayY = -y;
    const z = displayY - displayX;
    const centerX = (3 * z / 2) * centerSize;
    const centerY = (displayX + displayY) * d;
    minX = Math.min(minX, centerX - outerHexWidth / 2);
    maxX = Math.max(maxX, centerX + outerHexWidth / 2);
    minY = Math.min(minY, centerY - outerHexHeight / 2);
    maxY = Math.max(maxY, centerY + outerHexHeight / 2);
  });
  const tiles = validTiles.map(({ cid, x, y }) => {
    const displayX = -x;
    const displayY = -y;
    const z = displayY - displayX;
    const centerX = (3 * z / 2) * centerSize;
    const centerY = (displayX + displayY) * d;
    return { cid, x, y, centerX: centerX - minX, centerY: centerY - minY, hexX: centerX - outerHexWidth / 2 - minX, hexY: centerY - outerHexHeight / 2 - minY };
  });
  return { tiles, width: maxX - minX + 2, height: maxY - minY + 2 };
}

export default function TutorialBoard({ chapter, boardPreset, allowedOpcodes, interactionMode, resetKey }: TutorialBoardProps) {
  const [movementSelector, setMovementSelector] = useState<MovementSelector>("1");
  const resolvedBoardPreset = useMemo(() => {
    if (chapter.hasMovementSelector && chapter.boardPresetByMovementSelector) {
      return chapter.boardPresetByMovementSelector[movementSelector];
    }
    return boardPreset;
  }, [chapter.hasMovementSelector, chapter.boardPresetByMovementSelector, movementSelector, boardPreset]);
  const [state, setState] = useState<engine.State>(() => createTutorialPresetState(resolvedBoardPreset));
  const [uiState, setUiState] = useState<UIState>({ type: "idle" });
  const [message, setMessage] = useState<string | null>(null);
  const [boardViewportWidth, setBoardViewportWidth] = useState(0);
  const [boardViewportHeight, setBoardViewportHeight] = useState(0);
  const [hoveredBoardCid, setHoveredBoardCid] = useState<number | null>(null);
  const [unitIconsReady, setUnitIconsReady] = useState(() => areAllUnitIconsReady());
  const boardViewportRef = useRef<HTMLDivElement | null>(null);
  const uiStateRef = useRef<UIState>({ type: "idle" });
  const { playSfx } = useBoardSfx();

  useEffect(() => {
    setState(createTutorialPresetState(resolvedBoardPreset));
    setUiState({ type: "idle" });
    uiStateRef.current = { type: "idle" };
    setMessage(null);
  }, [resolvedBoardPreset, resetKey]);

  useEffect(() => {
    uiStateRef.current = uiState;
  }, [uiState]);

  useEffect(() => {
    const element = boardViewportRef.current;
    if (!element) return;
    const updateSize = () => {
      setBoardViewportWidth(element.clientWidth);
      setBoardViewportHeight(element.clientHeight);
    };
    updateSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }
    const observer = new ResizeObserver(() => updateSize());
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (areAllUnitIconsReady()) {
      setUnitIconsReady(true);
      return;
    }
    let active = true;
    void preloadAllUnitIcons().then(() => {
      if (active) setUnitIconsReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const boardMetrics = useMemo(() => buildBoardMetrics(), []);
  const rawLegalActions = useMemo(() => engine.generateLegalActions(state), [state]);
  const filteredActions = useMemo(() => filterLegalActions({ state, actions: rawLegalActions, chapter, allowedOpcodes, selectedUnitType: chapter.hasMovementSelector ? movementSelector : null }), [state, rawLegalActions, chapter, allowedOpcodes, movementSelector]);
  const cache = useMemo(() => buildTutorialCache(state, filteredActions, interactionMode, movementSelector), [state, filteredActions, interactionMode, movementSelector]);

  const commitUiState = (nextState: UIState) => {
    const previous = uiStateRef.current;
    if (isUiStateEqual(previous, nextState)) return;
    uiStateRef.current = nextState;
    setUiState(nextState);
  };

  const getDonorDisplayHeight = (emptyCache: EmptyCache, donors: Map<number, number>, donorCid: number, symmetry?: EmptySymmetryState) => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return null;
    if (symmetry && symmetry.donorCids.includes(donorCid)) return rule.actualPrimary - symmetry.donate;
    return donors.get(donorCid) ?? rule.actualPrimary;
  };
  const getDonorDonation = (emptyCache: EmptyCache, donors: Map<number, number>, donorCid: number, symmetry?: EmptySymmetryState) => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return null;
    const displayHeight = getDonorDisplayHeight(emptyCache, donors, donorCid, symmetry);
    if (displayHeight === null) return null;
    return rule.actualPrimary - displayHeight;
  };
  const getParticipatingDonors = (emptyCache: EmptyCache, donors: Map<number, number>, symmetry?: EmptySymmetryState) => {
    const participating: Array<{ cid: number; donate: number }> = [];
    for (const donorCid of emptyCache.donorCids) {
      const donate = getDonorDonation(emptyCache, donors, donorCid, symmetry);
      if (donate && donate > 0) participating.push({ cid: donorCid, donate });
    }
    return participating;
  };
  const getDonationOptions = (emptyCache: EmptyCache, donorCid: number): number[] => {
    const rule = emptyCache.donorRules.get(donorCid);
    if (!rule) return [];
    const options: number[] = [];
    for (const displayHeight of rule.allowedDisplayedHeights) {
      const donate = rule.actualPrimary - displayHeight;
      if (donate > 0) options.push(donate);
    }
    return options;
  };
  const canPairWithAnyDonations = (emptyCache: EmptyCache, donorCidA: number, donorCidB: number): boolean => {
    const optionsA = getDonationOptions(emptyCache, donorCidA);
    const optionsB = getDonationOptions(emptyCache, donorCidB);
    for (const donateA of optionsA) {
      for (const donateB of optionsB) {
        if (emptyCache.canPair(donorCidA, donorCidB, donateA, donateB)) return true;
      }
    }
    return false;
  };
  const applySymmetryDonations = (emptyCache: EmptyCache, baseDonors: Map<number, number>, donorCids: number[], donate: number) => {
    const next = new Map(baseDonors);
    for (const donorCid of donorCids) {
      const rule = emptyCache.donorRules.get(donorCid);
      if (rule) next.set(donorCid, rule.actualPrimary - donate);
    }
    return next;
  };

  const getIdleSelectionState = (cid: number): UIState | null => {
    const ownPrimaryCache = cache.ownPrimary.get(cid);
    const ownSecondaryCache = cache.ownSecondary.get(cid);
    const hasPrimaryMoves = Boolean(ownPrimaryCache && ownPrimaryCache.targets.size > 0);
    const hasSecondaryMoves = Boolean(ownSecondaryCache && ownSecondaryCache.split.emptyAdjDirs.length > 0);
    if (interactionMode === "move-only") {
      if (!unitMatchesMovementSelector(state, cid, movementSelector)) return null;
      return hasPrimaryMoves ? { type: "own_primary", originCid: cid, targetCid: null, optionIndex: 0 } : null;
    }
    if (interactionMode === "damage-only") return cache.enemy.has(cid) ? { type: "enemy", targetCid: cid, optionIndex: 0 } : null;
    if (interactionMode === "combine-only" || interactionMode === "sym-combine-only") return cache.empty.has(cid) ? { type: "empty", centerCid: cid, donors: new Map(), optionIndex: 0 } : null;
    if (interactionMode === "split-only") return hasSecondaryMoves ? { type: "own_secondary", originCid: cid, allocations: [0, 0, 0, 0, 0, 0] } : null;
    if (interactionMode === "impero-a") {
      if (hasPrimaryMoves) return { type: "own_primary", originCid: cid, targetCid: null, optionIndex: 0 };
      return cache.enemy.has(cid) ? { type: "enemy", targetCid: cid, optionIndex: 0 } : null;
    }
    if (interactionMode === "impero-b") {
      if (cache.empty.has(cid)) return { type: "empty", centerCid: cid, donors: new Map(), optionIndex: 0 };
      return hasSecondaryMoves ? { type: "own_secondary", originCid: cid, allocations: [0, 0, 0, 0, 0, 0] } : null;
    }
    if (cache.enemy.has(cid)) return { type: "enemy", targetCid: cid, optionIndex: 0 };
    if (cache.empty.has(cid)) return { type: "empty", centerCid: cid, donors: new Map(), optionIndex: 0 };
    if (hasPrimaryMoves) return { type: "own_primary", originCid: cid, targetCid: null, optionIndex: 0 };
    return hasSecondaryMoves ? { type: "own_secondary", originCid: cid, allocations: [0, 0, 0, 0, 0, 0] } : null;
  };

  const handleTileClick = (cid: number, d = 1) => {
    const prevState = uiStateRef.current;
    let nextState: UIState = prevState;
    if (prevState.type === "idle") nextState = getIdleSelectionState(cid) ?? prevState;
    if (prevState.type === "enemy") {
      if (cid !== prevState.targetCid) nextState = { type: "idle" };
      else {
        const enemyCache = cache.enemy.get(prevState.targetCid);
        if (enemyCache && enemyCache.options.length > 0) nextState = { ...prevState, optionIndex: cycleIndex(prevState.optionIndex, d, enemyCache.options.length) };
      }
    }
    if (prevState.type === "empty") {
      const emptyCache = cache.empty.get(prevState.centerCid);
      if (!emptyCache) nextState = { type: "idle" };
      else if (cid === prevState.centerCid) nextState = { ...prevState, donors: new Map(), optionIndex: 0, symmetry: undefined };
      else {
        const donorRule = emptyCache.donorRules.get(cid);
        if (!donorRule) nextState = { type: "idle" };
        else if (prevState.symmetry) {
          if (!modeAllowsSymmetry(interactionMode) || !prevState.symmetry.donorCids.includes(cid)) nextState = { type: "idle" };
          else {
            const allowed = emptyCache.allowedSymmetricDonations(prevState.symmetry.mode);
            const nextDonate = allowed[cycleIndex(Math.max(0, allowed.indexOf(prevState.symmetry.donate)), d, allowed.length)];
            nextState = nextDonate === 0
              ? { type: "empty", centerCid: prevState.centerCid, donors: new Map(prevState.symmetry.savedDonors), optionIndex: 0 }
              : { ...prevState, donors: applySymmetryDonations(emptyCache, prevState.symmetry.savedDonors, prevState.symmetry.donorCids, nextDonate), optionIndex: 0, symmetry: { ...prevState.symmetry, donate: nextDonate } };
          }
        } else {
          const validValues = donorRule.allowedDisplayedHeights;
          const currentDisp = prevState.donors.get(cid) ?? donorRule.actualPrimary;
          const newDisp = validValues[cycleIndex(Math.max(0, validValues.indexOf(currentDisp)), -d, validValues.length)];
          const nextDonate = donorRule.actualPrimary - newDisp;
          const currentDonate = donorRule.actualPrimary - currentDisp;
          const participating = getParticipatingDonors(emptyCache, prevState.donors, prevState.symmetry);
          const otherParticipating = participating.filter((entry) => entry.cid !== cid);
          if (currentDonate <= 0 && nextDonate > 0) {
            if (otherParticipating.length === 1 && !canPairWithAnyDonations(emptyCache, otherParticipating[0].cid, cid)) {
              nextState = { type: "idle" };
            } else if (otherParticipating.length === 2) {
              if (!modeAllowsSymmetry(interactionMode) || interactionMode === "combine-only") {
                nextState = { type: "idle" };
              } else {
                const symmetryMode = emptyCache.symmetryModeForThird([otherParticipating[0].cid, otherParticipating[1].cid, cid]);
                if (symmetryMode === null) {
                  nextState = { type: "idle" };
                } else {
                  const symmetryDonorCids = symmetryMode === "sym6" ? [...emptyCache.donorCids] : [otherParticipating[0].cid, otherParticipating[1].cid, cid];
                  const allowed = emptyCache.allowedSymmetricDonations(symmetryMode);
                  const defaultDonate = allowed.includes(nextDonate) ? nextDonate : allowed.find((value) => value > 0) ?? 0;
                  if (defaultDonate <= 0) {
                    nextState = { type: "idle" };
                  } else {
                    const savedDonors = new Map(prevState.donors);
                    nextState = {
                      type: "empty",
                      centerCid: prevState.centerCid,
                      donors: applySymmetryDonations(emptyCache, savedDonors, symmetryDonorCids, defaultDonate),
                      optionIndex: 0,
                      symmetry: { mode: symmetryMode, donate: defaultDonate, savedDonors, donorCids: symmetryDonorCids },
                    };
                  }
                }
              }
            } else if (otherParticipating.length >= 3) {
              nextState = { type: "idle" };
            }
          }
          if (isUiStateEqual(nextState, prevState)) {
            const donors = new Map(prevState.donors);
            donors.set(cid, newDisp);
            nextState = { ...prevState, donors, optionIndex: 0 };
          }
        }
      }
    }
    if (prevState.type === "own_primary") {
      if (cid === prevState.originCid) {
        if (prevState.targetCid !== null) nextState = { ...prevState, targetCid: null, optionIndex: 0 };
        else if (interactionMode === "traditional") {
          const primaryCache = cache.ownPrimary.get(prevState.originCid);
          const secondaryCache = cache.ownSecondary.get(prevState.originCid);
          if (secondaryCache && secondaryCache.split.emptyAdjDirs.length > 0 && primaryCache?.canEnterSecondary) nextState = { type: "own_secondary", originCid: prevState.originCid, allocations: [0, 0, 0, 0, 0, 0] };
        }
      } else {
        const primaryCache = cache.ownPrimary.get(prevState.originCid);
        const targetOptions = primaryCache?.targets.get(cid);
        if (!primaryCache || !primaryCache.highlighted.has(cid) || !targetOptions || targetOptions.options.length === 0) nextState = { type: "idle" };
        else if (prevState.targetCid === cid) nextState = targetOptions.options.length <= 1 ? prevState : { ...prevState, optionIndex: cycleIndex(prevState.optionIndex, d, targetOptions.options.length) };
        else nextState = { ...prevState, targetCid: cid, optionIndex: d === -1 ? targetOptions.options.length - 1 : 0 };
      }
    }
    if (prevState.type === "own_secondary") {
      if (cid === prevState.originCid) {
        nextState = prevState.allocations.some((value) => value > 0)
          ? { ...prevState, allocations: [0, 0, 0, 0, 0, 0] }
          : modeAllowsOwnPrimary(interactionMode)
          ? { type: "own_primary", originCid: prevState.originCid, targetCid: null, optionIndex: 0 }
          : { type: "idle" };
      } else {
        const dir = getNeighborDirection(prevState.originCid, cid);
        const secondaryCache = dir === null ? null : cache.ownSecondary.get(prevState.originCid);
        if (dir === null || !secondaryCache || !secondaryCache.split.emptyAdjDirs.includes(dir)) nextState = { type: "idle" };
        else {
          const allowed = secondaryCache.split.allowedAllocValues(dir, prevState.allocations);
          const current = prevState.allocations[dir];
          const nextAlloc = allowed[cycleIndex(Math.max(0, allowed.indexOf(current)), d, allowed.length)];
          const allocations = [...prevState.allocations];
          allocations[dir] = nextAlloc;
          nextState = { ...prevState, allocations };
        }
      }
    }
    commitUiState(nextState);
  };

  const getEmptyStateAction = (): number | null => {
    if (uiState.type !== "empty") return null;
    const emptyCache = cache.empty.get(uiState.centerCid);
    if (!emptyCache) return null;
    if (uiState.symmetry) return modeAllowsSymmetry(interactionMode) && uiState.symmetry.donate > 0 ? emptyCache.constructSymCombineAction(uiState.symmetry.mode, uiState.symmetry.donate) : null;
    const participating = getParticipatingDonors(emptyCache, uiState.donors, uiState.symmetry);
    if (interactionMode === "sym-combine-only") return null;
    if (participating.length === 2) return emptyCache.constructCombineAction(participating[0].cid, participating[1].cid, participating[0].donate, participating[1].donate);
    if (!modeAllowsSymmetry(interactionMode)) return null;
    if (participating.length === 3) {
      const mode = emptyCache.symmetryModeForThird(participating.map((entry) => entry.cid));
      if (!mode || mode === "sym6") return null;
      const donate = participating[0].donate;
      if (donate <= 0 || !participating.every((entry) => entry.donate === donate)) return null;
      return emptyCache.constructSymCombineAction(mode, donate);
    }
    if (participating.length === 6) {
      const donate = participating[0].donate;
      if (donate <= 0 || !participating.every((entry) => entry.donate === donate)) return null;
      return emptyCache.constructSymCombineAction("sym6", donate);
    }
    return null;
  };
  const getOwnSecondaryAction = (): number | null => {
    if (uiState.type !== "own_secondary") return null;
    const secondaryCache = cache.ownSecondary.get(uiState.originCid);
    const originUnit = engine.unitByteToUnit(state.board[uiState.originCid]);
    if (!secondaryCache || !originUnit) return null;
    const allocations = uiState.allocations;
    if (!secondaryCache.split.isRemainingValid(allocations)) return null;
    const backstabbAction = secondaryCache.split.deriveBackstabbAction(allocations);
    if (backstabbAction !== null) return backstabbAction;
    if (allocations.some((value) => value > 0 && value >= originUnit.p) || allocations.some((value) => !isValidSplitHeight(value))) return null;
    const totalAllocated = allocations.reduce((a, b) => a + b, 0);
    const remainder = originUnit.p - totalAllocated;
    if (remainder < 0 || !isValidHeight(remainder)) return null;
    return allocations.filter((value) => value > 0).length + (remainder > 0 ? 1 : 0) < 2 ? null : secondaryCache.split.constructSplitAction(allocations);
  };
  const pendingAction = (() => {
    if (uiState.type === "enemy") return cache.enemy.get(uiState.targetCid)?.options[uiState.optionIndex] ?? null;
    if (uiState.type === "empty") return getEmptyStateAction();
    if (uiState.type === "own_primary" && uiState.targetCid !== null) return cache.ownPrimary.get(uiState.originCid)?.targets.get(uiState.targetCid)?.options[uiState.optionIndex] ?? null;
    if (uiState.type === "own_secondary") return getOwnSecondaryAction();
    return null;
  })();
  const canSubmit = Boolean(pendingAction !== null && cache.legalSet.has((pendingAction ?? 0) >>> 0) && state.status !== "ended");

  const previewOverlay: PreviewOverlay | null = (() => {
    if (uiState.type === "empty") {
      const emptyCache = cache.empty.get(uiState.centerCid);
      if (!emptyCache) return null;
      const overlay: PreviewOverlay = { units: new Map(), empty: new Set() };
      let totalDonation = 0;
      let tribunTransferred = false;
      let hasParticipation = false;
      for (const cid of emptyCache.donorCids) {
        const donorRule = emptyCache.donorRules.get(cid);
        if (!donorRule) continue;
        const display = getDonorDisplayHeight(emptyCache, uiState.donors, cid, uiState.symmetry);
        if (display === null) continue;
        const donate = donorRule.actualPrimary - display;
        if (donate <= 0) continue;
        const unit = engine.unitByteToUnit(state.board[cid]);
        if (!unit) continue;
        hasParticipation = true;
        totalDonation += donate;
        const remaining = unit.p - donate;
        if (remaining > 0) overlay.units.set(cid, { p: remaining, s: unit.s, color: unit.color, tribun: unit.tribun });
        else if (unit.s > 0) overlay.units.set(cid, { p: 0, s: unit.s, color: unit.color, tribun: false });
        else overlay.empty.add(cid);
        if (unit.tribun && donate === unit.p) tribunTransferred = true;
      }
      if (!hasParticipation) return null;
      if (totalDonation > 0) overlay.units.set(uiState.centerCid, { p: totalDonation, s: 0, color: state.turn, tribun: tribunTransferred });
      return overlay;
    }
    if (uiState.type === "own_secondary") {
      const originUnit = engine.unitByteToUnit(state.board[uiState.originCid]);
      if (!originUnit) return null;
      const overlay: PreviewOverlay = { units: new Map(), empty: new Set() };
      const totalAllocated = uiState.allocations.reduce((a, b) => a + b, 0);
      const remainder = originUnit.p - totalAllocated;
      const { x: ox, y: oy } = engine.decodeCoord(uiState.originCid);
      for (let dir = 0; dir < 6; dir += 1) {
        if (uiState.allocations[dir] > 0) {
          const [dx, dy] = NEIGHBOR_VECTORS[dir];
          try {
            overlay.units.set(engine.encodeCoord(ox + dx, oy + dy), { p: uiState.allocations[dir], s: 0, color: originUnit.color, tribun: false });
          } catch {
            // ignore off-board
          }
        }
      }
      if (remainder > 0) overlay.units.set(uiState.originCid, { p: remainder, s: originUnit.s, color: originUnit.color, tribun: originUnit.tribun });
      else if (originUnit.s > 0) overlay.units.set(uiState.originCid, { p: 0, s: originUnit.s, color: originUnit.color, tribun: originUnit.tribun });
      else overlay.empty.add(uiState.originCid);
      return overlay;
    }
    return null;
  })();

  const previewState = previewOverlay || pendingAction === null ? null : (() => {
    try {
      return engine.applyAction(state, pendingAction);
    } catch {
      return null;
    }
  })();
  const displayBoard = previewState?.board ?? state.board;

  const baseTileStates = useMemo(() => {
    const states: Array<"default" | "selectable"> = new Array(121).fill("default");
    for (const cid of cache.enemy.keys()) states[cid] = "selectable";
    for (const cid of cache.empty.keys()) states[cid] = "selectable";
    for (const cid of cache.ownPrimary.keys()) if ((cache.ownPrimary.get(cid)?.targets.size ?? 0) > 0) states[cid] = "selectable";
    for (const cid of cache.ownSecondary.keys()) if ((cache.ownSecondary.get(cid)?.split.emptyAdjDirs.length ?? 0) > 0) states[cid] = "selectable";
    return states;
  }, [cache]);

  const submitPendingAction = () => {
    if (!canSubmit || pendingAction === null) {
      setMessage("Build a legal move on the board first.");
      return;
    }
    const actorTurn = state.turn;
    const next = engine.applyAction(state, pendingAction);
    setState(chapter.practiceMode === "alternating" ? next : { ...next, turn: actorTurn });
    commitUiState({ type: "idle" });
    setMessage(null);
  };

  const resetPractice = () => {
    setState(createTutorialPresetState(resolvedBoardPreset));
    commitUiState({ type: "idle" });
    setMessage(null);
  };

  const selectedTiles: number[] = [];
  const interactableTiles: number[] = [];
  if (uiState.type === "enemy") {
    selectedTiles.push(uiState.targetCid);
    interactableTiles.push(uiState.targetCid);
  } else if (uiState.type === "empty") {
    selectedTiles.push(uiState.centerCid);
    const emptyCache = cache.empty.get(uiState.centerCid);
    if (emptyCache) {
      const participating = getParticipatingDonors(emptyCache, uiState.donors, uiState.symmetry);
      const emptyInteractable = new Set<number>();
      if (uiState.symmetry) {
        for (const donorCid of uiState.symmetry.donorCids) emptyInteractable.add(donorCid);
      } else {
        for (const participant of participating) emptyInteractable.add(participant.cid);
        if (participating.length === 0) {
          for (const donorCid of emptyCache.donorCids) emptyInteractable.add(donorCid);
        } else if (participating.length === 1) {
          const participant = participating[0];
          for (const donorCid of emptyCache.donorCids) {
            if (donorCid === participant.cid || canPairWithAnyDonations(emptyCache, participant.cid, donorCid)) emptyInteractable.add(donorCid);
          }
        } else if (participating.length === 2) {
          const [first, second] = participating;
          for (const donorCid of emptyCache.donorCids) {
            if (donorCid === first.cid || donorCid === second.cid) {
              emptyInteractable.add(donorCid);
              continue;
            }
            const symmetryMode = emptyCache.symmetryModeForThird([first.cid, second.cid, donorCid]);
            if (symmetryMode !== null) emptyInteractable.add(donorCid);
          }
        }
      }
      interactableTiles.push(...Array.from(emptyInteractable));
    }
  } else if (uiState.type === "own_primary") {
    selectedTiles.push(uiState.originCid);
    if (uiState.targetCid !== null) selectedTiles.push(uiState.targetCid);
    const primaryCache = cache.ownPrimary.get(uiState.originCid);
    if (primaryCache) interactableTiles.push(...Array.from(primaryCache.highlighted).filter((cid) => cid !== uiState.originCid));
  } else if (uiState.type === "own_secondary") {
    selectedTiles.push(uiState.originCid);
    const secondaryCache = cache.ownSecondary.get(uiState.originCid);
    if (secondaryCache) {
      const { x: ox, y: oy } = engine.decodeCoord(uiState.originCid);
      for (const dir of secondaryCache.split.emptyAdjDirs) {
        const [dx, dy] = NEIGHBOR_VECTORS[dir];
        try {
          interactableTiles.push(engine.encodeCoord(ox + dx, oy + dy));
        } catch {
          // ignore off-board
        }
      }
    }
  }
  const selectedSet = new Set(selectedTiles);
  const interactableSet = new Set(interactableTiles);

  const renderVisualUnit = (unit: PreviewOverlayUnit, mode: "icon" | "number" = "icon") => {
    if (unit.p <= 0 && unit.s <= 0) return null;
    const effectiveMode: "icon" | "number" = unitIconsReady && mode === "icon" ? "icon" : "number";
    const textColor = unit.tribun ? (unit.color === 0 ? "#AE0000" : "#00B4FF") : unit.color === 0 ? "#000" : "#fff";
    const textColorSecondary = unit.color === 0 ? "#fff" : "#000";
    const strokeColor = unit.tribun ? (unit.color === 0 ? "#000" : "#fff") : unit.color === 0 ? "#fff" : "#000";
    const strokeColorSecondary = unit.color === 0 ? "#000" : "#fff";
    const sizePx = unit.tribun ? 72 : 64;
    if (unit.s > 0) {
      return (
        <SplitUnitGlyph
          mode={effectiveMode}
          primary={{ height: unit.s, tribun: false }}
          secondary={{ height: unit.p, tribun: unit.tribun }}
          sizePx={sizePx}
          offsetPx={{ x: 12, y: 15 }}
          numberColors={{
            primary: { fill: textColorSecondary, stroke: strokeColorSecondary },
            secondary: { fill: textColor, stroke: strokeColor },
          }}
        />
      );
    }
    return (
      <UnitGlyph
        mode={effectiveMode}
        unit={{ height: unit.p, tribun: unit.tribun }}
        sizePx={sizePx}
        numberColor={{ fill: textColor, stroke: strokeColor }}
      />
    );
  };

  const shouldShowNumbersForOwnUnit = (cid: number, unitColor: engine.Color): boolean => {
    if (unitColor !== state.turn) return false;
    if (uiState.type === "own_secondary") {
      if (cid === uiState.originCid) return true;
      return previewOverlay?.units.has(cid) ?? false;
    }
    if (uiState.type === "empty") {
      if (previewOverlay?.units.has(cid)) return true;
      return interactableSet.has(cid);
    }
    return false;
  };

  const BOARD_Z_FILL = 2;
  const BOARD_Z_RING_DEFAULT = 4;
  const BOARD_Z_RING_FOCUS = 5;
  const BOARD_Z_UNIT = 7;
  const BOARD_Z_HIT = 9;
  const hoverBoardSurfaceZOffset = 10;
  const hoverBoardFillZBump = 1;
  const outerHexWidth = 94;
  const outerHexHeight = 81;
  const tileBorderWidth = 2;
  const tileInnerOffsetX = tileBorderWidth;
  const tileInnerOffsetY = (Math.sqrt(3) / 2) * tileBorderWidth;
  const tileInnerWidth = outerHexWidth - tileBorderWidth * 2;
  const tileInnerHeight = outerHexHeight - Math.sqrt(3) * tileBorderWidth;
  const hexClipPath = "polygon(100% 50%, 75% 0%, 25% 0%, 0% 50%, 25% 100%, 75% 100%)";
  const tileFills: JSX.Element[] = [];
  const tileRings: JSX.Element[] = [];
  const tileUnits: JSX.Element[] = [];
  const tileHits: JSX.Element[] = [];

  boardMetrics.tiles.forEach(({ cid, x, y, hexX, hexY }) => {
    const unit = previewOverlay?.units.get(cid) ?? (previewOverlay?.empty.has(cid) ? null : engine.unitByteToUnit(displayBoard[cid]));
    const isSelected = selectedSet.has(cid);
    const isSelectable = baseTileStates[cid] === "selectable";
    const isInteractable = interactableSet.has(cid);
    const hexState: HexagonState = isSelected ? "selected" : isInteractable ? "interactable" : isSelectable ? "selectable" : "default";
    const baseColor = getBaseColor(-x, -y);
    const canClick = isSelectable || isSelected || isInteractable;
    const isHovered = hoveredBoardCid === cid && canClick;
    const hoverScale = isHovered ? "scale(1.1)" : "scale(1)";
    const ringBaseZ = isSelected || isInteractable ? BOARD_Z_RING_FOCUS : BOARD_Z_RING_DEFAULT;
    const zFill = isHovered ? BOARD_Z_FILL + hoverBoardFillZBump : BOARD_Z_FILL;
    const zRing = ringBaseZ + (isHovered ? hoverBoardSurfaceZOffset : 0);
    const zUnit = isHovered ? BOARD_Z_UNIT + hoverBoardSurfaceZOffset : BOARD_Z_UNIT;
    const zHit = isHovered ? BOARD_Z_HIT + hoverBoardSurfaceZOffset : BOARD_Z_HIT;
    const tileColor = getHexagonColor(baseColor, hexState);
    const fillLeft = hexX + tileInnerOffsetX;
    const fillTop = hexY + tileInnerOffsetY;

    tileFills.push(
      <div
        key={`board-fill-${cid}`}
        style={{
          position: "absolute",
          left: `${fillLeft}px`,
          top: `${fillTop}px`,
          width: `${tileInnerWidth}px`,
          height: `${tileInnerHeight}px`,
          clipPath: hexClipPath,
          background: tileColor,
          zIndex: zFill,
          pointerEvents: "none",
          transform: hoverScale,
          transformOrigin: "50% 50%",
          transition: "transform 0.2s ease",
        }}
      />,
    );

    tileRings.push(
      <div
        key={`board-ring-${cid}`}
        style={{
          position: "absolute",
          left: `${hexX}px`,
          top: `${hexY}px`,
          width: `${outerHexWidth}px`,
          height: `${outerHexHeight}px`,
          zIndex: zRing,
          pointerEvents: "none",
          transform: hoverScale,
          transformOrigin: "50% 50%",
          transition: "transform 0.2s ease",
        }}
      >
        <div style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", clipPath: hexClipPath, background: "#222" }} />
        <div style={{ position: "absolute", left: `${tileInnerOffsetX}px`, top: `${tileInnerOffsetY}px`, width: `${tileInnerWidth}px`, height: `${tileInnerHeight}px`, clipPath: hexClipPath, background: tileColor }} />
      </div>,
    );

    tileUnits.push(
      <div
        key={`board-unit-${cid}`}
        style={{
          position: "absolute",
          left: `${fillLeft}px`,
          top: `${fillTop}px`,
          width: `${tileInnerWidth}px`,
          height: `${tileInnerHeight}px`,
          clipPath: hexClipPath,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: zUnit,
          pointerEvents: "none",
          transform: hoverScale,
          transformOrigin: "50% 50%",
          transition: "transform 0.2s ease",
        }}
      >
        {unit ? renderVisualUnit(unit, shouldShowNumbersForOwnUnit(cid, unit.color) ? "number" : "icon") : null}
      </div>,
    );

    tileHits.push(
      <div
        key={`board-hit-${cid}`}
        style={{
          position: "absolute",
          left: `${hexX}px`,
          top: `${hexY}px`,
          width: `${outerHexWidth}px`,
          height: `${outerHexHeight}px`,
          clipPath: hexClipPath,
          backgroundColor: "transparent",
          cursor: canClick ? "pointer" : "default",
          zIndex: zHit,
          transform: hoverScale,
          transformOrigin: "50% 50%",
          transition: "transform 0.2s ease",
        }}
        onMouseEnter={() => {
          if (canClick) setHoveredBoardCid(cid);
        }}
        onMouseLeave={() => {
          setHoveredBoardCid((prev) => (prev === cid ? null : prev));
        }}
        onClick={() => {
          if (canClick) {
            playSfx("tileClick");
            handleTileClick(cid, 1);
          } else if (uiState.type !== "idle") {
            commitUiState({ type: "idle" });
          }
        }}
        onContextMenu={(event: ReactPointerEvent<HTMLDivElement>) => {
          event.preventDefault();
          if (canClick) {
            playSfx("tileClick");
            handleTileClick(cid, -1);
          } else if (uiState.type !== "idle") {
            commitUiState({ type: "idle" });
          }
        }}
      />,
    );
  });

  const movementDiagramSubtext = chapter.movementDiagramSubtext?.[movementSelector];

  return (
    <section style={{ display: "grid", gap: "12px" }}>
      {chapter.hasMovementSelector ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {MOVEMENT_SELECTOR_OPTIONS.map((option) => (
            <button key={option} type="button" onClick={() => { setMovementSelector(option); commitUiState({ type: "idle" }); setMessage(null); }} style={{ padding: "8px 10px", borderRadius: "999px", border: "2px solid #6f5a38", background: movementSelector === option ? "#d8b178" : "#f7ecdb", color: "#2a2218", fontWeight: 700, cursor: "pointer" }}>{option}</button>
          ))}
        </div>
      ) : null}
      <div style={{ ...TUTORIAL_PANEL_STYLE, padding: "10px", minHeight: "560px", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div style={{ color: "#5a4630", fontWeight: 600 }}>{modeLabel(interactionMode)} - Build a move on the board, then Submit.</div>
        <div style={{ color: "#5a4630", fontWeight: 600 }}>Turn: <strong style={{ color: "#2c2318" }}>{state.turn === 0 ? "Black" : "White"}</strong> - Allowed moves: <strong style={{ color: "#2c2318" }}>{filteredActions.length}</strong></div>
        <div ref={boardViewportRef} style={{ flex: 1, minHeight: "420px", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", left: "50%", top: "50%", width: `${boardMetrics.width}px`, height: `${boardMetrics.height}px`, transform: `translate(-50%, -50%) scale(${Math.min(1, (boardViewportWidth || boardMetrics.width) / boardMetrics.width, (boardViewportHeight || boardMetrics.height) / boardMetrics.height)})`, transformOrigin: "center" }}>
            {tileFills}
            {tileRings}
            {tileUnits}
            {tileHits}
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button type="button" onClick={submitPendingAction} disabled={!canSubmit} style={{ padding: "10px 14px", borderRadius: "999px", border: "2px solid #183628", background: canSubmit ? "#2f6b3f" : "#8ea593", color: "#f7f3eb", fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", cursor: canSubmit ? "pointer" : "not-allowed" }}>Submit Move</button>
          <button type="button" onClick={resetPractice} style={{ padding: "10px 14px", borderRadius: "999px", border: "2px solid #6f5a38", background: "#f2d9b2", color: "#2a2218", fontWeight: 700, cursor: "pointer" }}>Reset practice</button>
        </div>
        {message ? <div style={{ color: "#6f2d22", fontWeight: 700 }}>{message}</div> : null}
      </div>
      {chapter.hasMovementSelector ? (
        <MovementPatternDiagram
          selector={movementSelector}
          subtext={movementDiagramSubtext}
          panelStyle={TUTORIAL_PANEL_STYLE}
        />
      ) : null}
    </section>
  );
}
