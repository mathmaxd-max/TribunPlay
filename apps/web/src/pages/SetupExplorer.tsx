import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as engine from "@tribunplay/engine";
import { getBaseColor, getHexagonColor, type HexagonState } from "../hexagonColors";
import { UnitGlyph as SharedUnitGlyph } from "../ui/UnitGlyph";
import {
  decodeCodeDetailed,
  encodePositionDetailed,
  getScenarioDefinition,
  type Position,
  type Scenario,
  SETUP_REGION_LIME,
  SETUP_REGION_ORANGE,
  SETUP_REGION_RED,
  SETUP_REGION_YELLOW,
} from "@tribunplay/engine";

type Brush = "1" | "2" | "3" | "eraser";
type TileCell = { height: 0 | 1 | 2 | 3; tribun: boolean };
type HashStatus = "idle" | "valid" | "invalid";
type PreviewMode = "empty" | "hash";
type PlayerCosmetic = "black" | "white";
type UnitViewMode = "icon" | "number";
type UnitSide = "own" | "enemy";
type ValidationProblem = {
  kind: string;
  message: string;
  details: Record<string, unknown>;
};

const EMPTY_CELL: TileCell = { height: 0, tribun: false };
const TRASH_ICON_URL = new URL("../assets/game/units/icons/Trash.webp", import.meta.url).href;
const TRASH_OUTLINE_URL = new URL("../assets/game/units/icons/_Trash.webp", import.meta.url).href;

function TrashGlyph(props: { sizePx: number; fillColor: string }) {
  const { sizePx, fillColor } = props;

  // Similar to `ui/UnitGlyph.tsx`: we tint by masking the filled glyph, while keeping a dedicated outline asset on top.
  return (
    <span
      aria-label="Eraser"
      style={{
        position: "relative",
        display: "inline-block",
        width: `${sizePx}px`,
        height: `${sizePx}px`,
        userSelect: "none",
        pointerEvents: "none",
      }}
    >
      <img
        src={TRASH_OUTLINE_URL}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: fillColor,
          WebkitMaskImage: `url(${TRASH_ICON_URL})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
          maskImage: `url(${TRASH_ICON_URL})`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
        }}
      />
    </span>
  );
}

// Canonical setup mapping for own side (red indices in the reference image).
// Index 0..36 order: bottom tip -> top rows.
const OWN_SETUP_CIDS = [
  120, 119, 109, 118, 108, 98, 117, 107, 97, 87, 116, 106, 96, 86, 76, 115, 105, 95, 85, 75, 65,
  104, 94, 84, 74, 64, 103, 93, 83, 73, 63, 53, 92, 82, 72, 62, 52,
] as const;

const ENEMY_SETUP_CIDS = OWN_SETUP_CIDS.map((ownCid) => {
  const { x, y } = engine.decodeCoord(ownCid);
  return engine.encodeCoord(-x, -y);
});

const OWN_CID_TO_INDEX = new Map<number, number>();
const ENEMY_CID_TO_INDEX = new Map<number, number>();
for (let i = 0; i < SETUP_REGION_LIME; i++) {
  OWN_CID_TO_INDEX.set(OWN_SETUP_CIDS[i], i);
  ENEMY_CID_TO_INDEX.set(ENEMY_SETUP_CIDS[i], i);
}

const TOTAL_BUDGET = 36;
const NEIGHBOR_VECTORS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, 0],
  [0, 1],
  [-1, -1],
  [-1, 0],
  [0, -1],
];
const TRIANGLES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 2, 4], // UP (alternating neighbors in cyclic order)
  [1, 3, 5], // DOWN
];
const TRIANGLE_LABELS: ReadonlyArray<"UP" | "DOWN"> = ["UP", "DOWN"];
const BRUSHABLE_CID_SET = new Set<number>(OWN_SETUP_CIDS);

type OwnTriangle = {
  centerCid: number;
  centerIdx: number;
  orientation: "UP" | "DOWN";
  vertexCids: [number, number, number];
  vertexIdxs: [number, number, number];
};

const validCids = (() => {
  const out: number[] = [];
  for (let cid = 0; cid <= 120; cid++) if (engine.isValidTile(cid)) out.push(cid);
  return out;
})();

function makeEmptyCells(): TileCell[] {
  return Array.from({ length: SETUP_REGION_LIME }, () => ({ ...EMPTY_CELL }));
}

function normalizeHashInput(input: string): string {
  return input.trim().toUpperCase();
}

function isBase36Code12(value: string): boolean {
  return /^[0-9A-Z]{12}$/.test(value);
}

function positionToCells(pos: Position): TileCell[] {
  const cells = makeEmptyCells();
  for (const idx of pos.ones) cells[idx] = { height: 1, tribun: false };
  for (const idx of pos.twos) cells[idx] = { height: 2, tribun: false };
  for (const idx of pos.threes) cells[idx] = { height: 3, tribun: false };
  const tribHeight = getScenarioDefinition(pos.scenario).tribHeight;
  cells[pos.tribTile] = { height: tribHeight, tribun: true };
  return cells;
}

function toPositionForScenario(cells: TileCell[], scenario: Scenario): Position | null {
  let tribTile = -1;
  const threes: number[] = [];
  const twos: number[] = [];
  const ones: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.height === 0) continue;
    if (cell.tribun) {
      if (tribTile !== -1) return null;
      tribTile = i;
      continue;
    }
    if (cell.height === 3) threes.push(i);
    else if (cell.height === 2) twos.push(i);
    else ones.push(i);
  }
  if (tribTile === -1) return null;
  return { scenario, tribTile, threes, twos, ones };
}

function unitKind(cell: TileCell): "1" | "2" | "3" | "1T" | "2T" | "3T" | "_" {
  if (cell.height === 0) return "_";
  if (!cell.tribun) return `${cell.height}` as "1" | "2" | "3";
  return `${cell.height}T` as "1T" | "2T" | "3T";
}

function projectAngle(dx: number, dy: number): number {
  const px = 1.5 * (dy - dx);
  const py = (dx + dy) * (Math.sqrt(3) / 2);
  return Math.atan2(py, px);
}

const DIRS_CYCLIC = NEIGHBOR_VECTORS
  .map((vec, idx) => ({ idx, angle: projectAngle(vec[0], vec[1]) }))
  .sort((a, b) => a.angle - b.angle)
  .map((v) => v.idx);

function getBrushableNeighbors6(centerCid: number, brushableCidSet: Set<number>): Array<number | null> {
  const center = engine.decodeCoord(centerCid);
  const neighbors: Array<number | null> = new Array(6).fill(null);
  for (let i = 0; i < 6; i++) {
    const dirIdx = DIRS_CYCLIC[i];
    const [dx, dy] = NEIGHBOR_VECTORS[dirIdx];
    try {
      const cid = engine.encodeCoord(center.x + dx, center.y + dy);
      neighbors[i] = brushableCidSet.has(cid) ? cid : null;
    } catch {
      neighbors[i] = null;
    }
  }
  return neighbors;
}

const OWN_TRIANGLES: OwnTriangle[] = (() => {
  const out: OwnTriangle[] = [];
  const seen = new Set<string>();
  for (const centerCid of OWN_SETUP_CIDS) {
    const centerIdx = OWN_CID_TO_INDEX.get(centerCid);
    if (centerIdx === undefined) continue;
    const n = getBrushableNeighbors6(centerCid, BRUSHABLE_CID_SET);
    for (let triIdx = 0; triIdx < TRIANGLES.length; triIdx++) {
      const tri = TRIANGLES[triIdx];
      const aCid = n[tri[0]];
      const bCid = n[tri[1]];
      const cCid = n[tri[2]];
      if (aCid === null || bCid === null || cCid === null) continue;
      const aIdx = OWN_CID_TO_INDEX.get(aCid);
      const bIdx = OWN_CID_TO_INDEX.get(bCid);
      const cIdx = OWN_CID_TO_INDEX.get(cCid);
      if (aIdx === undefined || bIdx === undefined || cIdx === undefined) continue;
      const sortedVerts = [aCid, bCid, cCid].slice().sort((x, y) => x - y);
      const key = `${sortedVerts[0]}|${sortedVerts[1]}|${sortedVerts[2]}|${TRIANGLE_LABELS[triIdx]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        centerCid,
        centerIdx,
        orientation: TRIANGLE_LABELS[triIdx],
        vertexCids: [aCid, bCid, cCid],
        vertexIdxs: [aIdx, bIdx, cIdx],
      });
    }
  }
  return out;
})();

function collectSymmetryViolations(cells: TileCell[]) {
  const out: Array<{
    centerCid: number;
    centerSetupIdx: number;
    orientation: "UP" | "DOWN";
    verticesCid: [number, number, number];
    verticesSetupIdx: [number, number, number];
    kind: string;
  }> = [];

  for (const tri of OWN_TRIANGLES) {
    const [aIdx, bIdx, cIdx] = tri.vertexIdxs;
    const ka = unitKind(cells[aIdx]);
    const kb = unitKind(cells[bIdx]);
    const kc = unitKind(cells[cIdx]);
    if (ka === "_" || ka !== kb || kb !== kc) continue;
    out.push({
      centerCid: tri.centerCid,
      centerSetupIdx: tri.centerIdx,
      orientation: tri.orientation,
      verticesCid: tri.vertexCids,
      verticesSetupIdx: tri.vertexIdxs,
      kind: ka,
    });
  }

  return out;
}

function cellOccupied(cell: TileCell): boolean {
  return cell.height > 0;
}

function isIndexWithinArea(index: number, height: 1 | 2 | 3, tribun: boolean): boolean {
  if (tribun) {
    if (height === 3) return index < SETUP_REGION_RED;
    if (height === 2) return index < SETUP_REGION_ORANGE;
    return index < SETUP_REGION_YELLOW;
  }
  if (height === 3) return index < SETUP_REGION_RED;
  if (height === 2) return index < SETUP_REGION_ORANGE;
  return index < SETUP_REGION_LIME;
}

function canPlaceOnIndex(index: number, height: 1 | 2 | 3, tribun: boolean, onlyEmpty: boolean, cells: TileCell[]): boolean {
  const target = cells[index];
  if (onlyEmpty && cellOccupied(target)) return false;
  return isIndexWithinArea(index, height, tribun);
}

function emptyCounts() {
  return { ones: 0, twos: 0, threes: 0, tribun: 0 };
}

function deriveHashStatus(value: string): HashStatus {
  if (!value) return "idle";
  if (!isBase36Code12(value)) return "invalid";
  const decoded = decodeCodeDetailed(value);
  return decoded.ok ? "valid" : "invalid";
}

function SetupUnitGlyph(props: { cell: TileCell; viewMode: UnitViewMode; side: UnitSide; playerColor: PlayerCosmetic; size?: "board" | "small" }) {
  const { cell, viewMode, side, playerColor, size = "board" } = props;
  if (cell.height === 0) return null;

  const ownIsBlack = playerColor === "black";
  const sideIsBlack = side === "own" ? ownIsBlack : !ownIsBlack;

  const mode = viewMode === "icon" ? "icon" : "number";
  const sizePx = size === "small" ? 22 : 36;
  const fill = cell.tribun ? (sideIsBlack ? "#AE0000" : "#00B4FF") : sideIsBlack ? "#000" : "#fff";
  const stroke = sideIsBlack ? "#fff" : "#000";

  return (
    <SharedUnitGlyph
      mode={mode}
      unit={{ height: cell.height, tribun: cell.tribun }}
      sizePx={sizePx}
      numberColor={{ fill, stroke }}
    />
  );
}

export default function SetupExplorer() {
  const [brush, setBrush] = useState<Brush>("1");
  const [tribunBrush, setTribunBrush] = useState(false);
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [rotate180, setRotate180] = useState(false);
  const [playerColor, setPlayerColor] = useState<PlayerCosmetic>("black");
  const [unitViewMode, setUnitViewMode] = useState<UnitViewMode>("icon");
  const paintRef = useRef<{ active: boolean; button: 0 | 2; lastCid: number | null }>({
    active: false,
    button: 0,
    lastCid: null,
  });

  const [ownCells, setOwnCells] = useState<TileCell[]>(makeEmptyCells);
  const [ownHashInput, setOwnHashInput] = useState("");
  const [ownHashStatus, setOwnHashStatus] = useState<HashStatus>("idle");

  const [previewMode, setPreviewMode] = useState<PreviewMode>("empty");
  const [enemyCells, setEnemyCells] = useState<TileCell[]>(makeEmptyCells);
  const [enemyHashInput, setEnemyHashInput] = useState("");
  const [enemyHashStatus, setEnemyHashStatus] = useState<HashStatus>("idle");

  const ownValidation = useMemo(() => {
    const counts = emptyCounts();
    const tribunIndices: number[] = [];
    const outOfArea = {
      "3": [] as number[],
      "2": [] as number[],
      "1": [] as number[],
      "3T": [] as number[],
      "2T": [] as number[],
      "1T": [] as number[],
    };

    for (let i = 0; i < ownCells.length; i++) {
      const cell = ownCells[i];
      if (cell.height === 0) continue;
      if (cell.tribun) {
        tribunIndices.push(i);
        const k = `${cell.height}T` as "1T" | "2T" | "3T";
        if (!isIndexWithinArea(i, cell.height, true)) outOfArea[k].push(i);
      } else {
        if (cell.height === 1) counts.ones++;
        if (cell.height === 2) counts.twos++;
        if (cell.height === 3) counts.threes++;
        const k = `${cell.height}` as "1" | "2" | "3";
        if (!isIndexWithinArea(i, cell.height, false)) outOfArea[k].push(i);
      }
    }
    counts.tribun = tribunIndices.length;

    const tribunHeight: 0 | 1 | 2 | 3 =
      tribunIndices.length > 0 ? ownCells[tribunIndices[0]].height : 0;
    const scenariosByTrib: Scenario[] =
      tribunIndices.length === 1 && tribunHeight === 3
        ? [0]
        : tribunIndices.length === 1 && tribunHeight === 2
        ? [1]
        : tribunIndices.length === 1 && tribunHeight === 1
        ? [2, 3]
        : [];

    const problems: ValidationProblem[] = [];

    if (counts.tribun !== 1) {
      problems.push({
        kind: "TRIBUN_COUNT",
        message: `Tribun count must be 1 (currently ${counts.tribun}).`,
        details: { tribunCount: counts.tribun, tribunIndices },
      });
    }

    const areaParts: string[] = [];
    const pushArea = (kind: keyof typeof outOfArea, limit: number) => {
      if (outOfArea[kind].length > 0) {
        areaParts.push(`${kind} at [${outOfArea[kind].join(",")}] (must be <${limit})`);
      }
    };
    pushArea("3", SETUP_REGION_RED);
    pushArea("2", SETUP_REGION_ORANGE);
    pushArea("1", SETUP_REGION_LIME);
    pushArea("3T", SETUP_REGION_RED);
    pushArea("2T", SETUP_REGION_ORANGE);
    pushArea("1T", SETUP_REGION_YELLOW);
    if (areaParts.length > 0) {
      problems.push({
        kind: "AREA",
        message: `Area violation: ${areaParts.join(", ")}.`,
        details: outOfArea,
      });
    }

    const tribHeightBudget =
      tribunIndices.length === 1
        ? ownCells[tribunIndices[0]].height
        : tribunIndices.reduce((acc, idx) => acc + ownCells[idx].height, 0);
    const used = counts.ones + 2 * counts.twos + 3 * counts.threes + tribHeightBudget;
    const expected = TOTAL_BUDGET;
    if (used !== expected) {
      problems.push({
        kind: "BUDGET",
        message: `Unit budget mismatch: used=${used} expected=${expected} (delta=${used - expected}).`,
        details: { used, expected, delta: used - expected },
      });
    }

    if (counts.twos < 2 * counts.threes) {
      problems.push({
        kind: "PAYMENT_3",
        message: `3-payments failed: need #2 >= 2*#3 (have #2=${counts.twos}, #3=${counts.threes}).`,
        details: { n2: counts.twos, n3: counts.threes },
      });
    }

    if (tribunIndices.length === 1) {
      if (tribunHeight === 1) {
        const variantAOk = counts.twos <= counts.ones + 1 && counts.twos >= 1 + 2 * counts.threes;
        const variantBOk = counts.twos <= counts.ones && counts.twos >= 2 * counts.threes;
        if (!variantAOk && !variantBOk) {
          problems.push({
            kind: "PAYMENT_2",
            message: `2-payments failed for both 1T variants: (variant A needs #2 <= #1+1 and #2 >= 1+2*#3, variant B needs #2 <= #1 and #2 >= 2*#3; have #1=${counts.ones}, #2=${counts.twos}).`,
            details: {
              variantA: { ok: variantAOk, needMax2: counts.ones + 1, needMin2: 1 + 2 * counts.threes },
              variantB: { ok: variantBOk, needMax2: counts.ones, needMin2: 2 * counts.threes },
              counts,
            },
          });
        }
      } else if (tribunHeight === 2 || tribunHeight === 3) {
        if (counts.ones < counts.twos) {
          problems.push({
            kind: "PAYMENT_2",
            message: `2-payments failed: need #1 >= #2 (have #1=${counts.ones}, #2=${counts.twos}).`,
            details: { n1: counts.ones, n2: counts.twos },
          });
        }
      }
    }

    const symViolations = collectSymmetryViolations(ownCells);
    for (const v of symViolations) {
      problems.push({
        kind: "SYMMETRY",
        message: `Symmetry: equal units in ${v.orientation} triangle around center ${v.centerSetupIdx} (cid=${v.centerCid}) at vertices [${v.verticesSetupIdx.join(",")}] (cids=[${v.verticesCid.join(",")}], unit=${v.kind}).`,
        details: v,
      });
    }

    let hash: string | null = null;
    if (problems.length === 0) {
      for (const scenario of scenariosByTrib) {
        const pos = toPositionForScenario(ownCells, scenario);
        if (!pos) continue;
        const encoded = encodePositionDetailed(pos);
        if (encoded.ok) {
          hash = encoded.code;
          break;
        }
      }
      if (!hash) {
        problems.push({
          kind: "ENCODE",
          message: "Encoding failed for all applicable scenarios.",
          details: { scenariosByTrib },
        });
      }
    }

    return {
      counts,
      tribunHeight,
      tribunIndices,
      used,
      expected,
      problems,
      hash,
    };
  }, [ownCells]);

  const boardMetrics = useMemo(() => {
    const innerHexSize = 26;
    const borderWidth = 2;
    const spacingMultiplier = 0.98;
    const outerHexSize = innerHexSize + borderWidth;
    const centerSize = outerHexSize * spacingMultiplier;
    const d = Math.sqrt(3) / 2 * centerSize;
    const outerHexWidth = 2 * outerHexSize;
    const outerHexHeight = Math.sqrt(3) * outerHexSize;

    const positioned = validCids.map((cid) => {
      const { x, y } = engine.decodeCoord(cid);
      const displayX = rotate180 ? -x : x;
      const displayY = rotate180 ? -y : y;
      const z = displayY - displayX;
      const centerX = (3 * z / 2) * centerSize;
      const centerY = (displayX + displayY) * d;
      return { cid, x, y, centerX, centerY };
    });

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const tile of positioned) {
      minX = Math.min(minX, tile.centerX - outerHexWidth / 2);
      maxX = Math.max(maxX, tile.centerX + outerHexWidth / 2);
      minY = Math.min(minY, tile.centerY - outerHexHeight / 2);
      maxY = Math.max(maxY, tile.centerY + outerHexHeight / 2);
    }

    return {
      tiles: positioned,
      minX,
      minY,
      width: maxX - minX + 2,
      height: maxY - minY + 2,
      outerHexWidth,
      outerHexHeight,
    };
  }, [rotate180]);

  const applyLeftClick = (cid: number) => {
    const setupIndex = OWN_CID_TO_INDEX.get(cid);
    if (setupIndex === undefined) return;
    setOwnCells((prev) => {
      const next = prev.map((cell) => ({ ...cell }));
      if (brush === "eraser") {
        next[setupIndex] = { ...EMPTY_CELL };
        return next;
      }
      const height = Number(brush) as 1 | 2 | 3;
      if (!canPlaceOnIndex(setupIndex, height, tribunBrush, onlyEmpty, prev)) return prev;
      if (tribunBrush) {
        for (let i = 0; i < next.length; i++) {
          if (next[i].tribun) next[i].tribun = false;
        }
      }
      next[setupIndex] = { height, tribun: tribunBrush };
      return next;
    });
  };

  const applyRightErase = (cid: number) => {
    const setupIndex = OWN_CID_TO_INDEX.get(cid);
    if (setupIndex === undefined) return;
    setOwnCells((prev) => {
      if (!cellOccupied(prev[setupIndex])) return prev;
      const next = prev.map((cell) => ({ ...cell }));
      next[setupIndex] = { ...EMPTY_CELL };
      return next;
    });
  };

  const brushableSet = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < SETUP_REGION_LIME; i++) {
      const cell = ownCells[i];
      if (brush === "eraser") {
        if (cellOccupied(cell)) set.add(i);
        continue;
      }
      const height = Number(brush) as 1 | 2 | 3;
      if (canPlaceOnIndex(i, height, tribunBrush, onlyEmpty, ownCells)) set.add(i);
    }
    return set;
  }, [brush, tribunBrush, onlyEmpty, ownCells]);

  useEffect(() => {
    const stop = () => {
      paintRef.current.active = false;
      paintRef.current.lastCid = null;
    };
    window.addEventListener("mouseup", stop);
    window.addEventListener("blur", stop);
    return () => {
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("blur", stop);
    };
  }, []);

  const onOwnHashChange = (raw: string) => {
    const value = normalizeHashInput(raw);
    setOwnHashInput(value);
    const status = deriveHashStatus(value);
    setOwnHashStatus(status);
    if (status === "valid") {
      const decoded = decodeCodeDetailed(value);
      if (decoded.ok && decoded.position) setOwnCells(positionToCells(decoded.position));
    }
  };

  const onEnemyHashChange = (raw: string) => {
    const value = normalizeHashInput(raw);
    setEnemyHashInput(value);
    const status = deriveHashStatus(value);
    setEnemyHashStatus(status);
    if (status === "valid") {
      const decoded = decodeCodeDetailed(value);
      if (decoded.ok && decoded.position) setEnemyCells(positionToCells(decoded.position));
    } else if (status === "invalid") {
      setEnemyCells(makeEmptyCells());
    }
  };

  const applyPaint = (cid: number, button: 0 | 2) => {
    if (button === 2) applyRightErase(cid);
    else applyLeftClick(cid);
  };

  const startPaint = (cid: number, button: 0 | 2) => {
    paintRef.current.active = true;
    paintRef.current.button = button;
    paintRef.current.lastCid = cid;
    applyPaint(cid, button);
  };

  const continuePaint = (cid: number) => {
    if (!paintRef.current.active) return;
    if (paintRef.current.lastCid === cid) return;
    paintRef.current.lastCid = cid;
    applyPaint(cid, paintRef.current.button);
  };

  const segmentedWrapStyle = {
    display: "inline-flex",
    borderRadius: "999px",
    border: "2px solid #6f5a38",
    overflow: "hidden",
    background: "#fff6e8",
  } as const;
  const segmentedBtnStyle = (active: boolean) =>
    ({
      padding: "6px 10px",
      border: "none",
      background: active ? "#f2d9b2" : "transparent",
      fontWeight: 700,
      cursor: "pointer",
      fontSize: "12px",
      letterSpacing: "0.5px",
    }) as const;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)",
        color: "#1d1a14",
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');`}</style>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          flexWrap: "wrap",
          padding: "12px 20px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
        }}
      >
        <div>
          <div style={{ fontSize: "10px", letterSpacing: "2px", textTransform: "uppercase", color: "#ccb896", fontWeight: 700 }}>
            Tribun Play
          </div>
          <div style={{ fontSize: "20px", fontWeight: 400 }}>Setup Explorer</div>
        </div>
        <Link
          to="/hub"
          style={{
            padding: "8px 14px",
            borderRadius: "999px",
            border: "2px solid #6f5a38",
            background: "#f2d9b2",
            color: "#2a2218",
            fontWeight: 700,
            textDecoration: "none",
            letterSpacing: "1px",
            textTransform: "uppercase",
            fontSize: "12px",
          }}
        >
          Back to Hub
        </Link>
      </header>

      <main style={{ width: "100%", maxWidth: "1180px", margin: "0 auto", padding: "16px 12px 20px", display: "grid", gap: "12px" }}>
        <section style={{ display: "grid", gap: "10px" }}>
          <div style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "12px", display: "grid", gap: "10px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#7a6543" }}>Setup</div>

            <div style={{ display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#5a4630" }}>Own hash</div>
              <input
                value={ownHashInput}
                onChange={(e) => onOwnHashChange(e.target.value)}
                placeholder="12-char base36 hash"
                maxLength={12}
                style={{
                  border: ownHashStatus === "invalid" ? "2px solid #9f3030" : "1px solid #bda98b",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  fontFamily: '"JetBrains Mono", monospace',
                  letterSpacing: "1px",
                  fontWeight: 700,
                  background: "#fff9ef",
                }}
              />
              <div style={{ fontSize: "12px", color: ownHashStatus === "invalid" ? "#7c1e1e" : "#5a4630" }}>
                {ownHashStatus === "invalid" ? "Invalid hash." : ownHashStatus === "valid" ? "Loaded." : "Paste a hash to load."}
              </div>
            </div>

            <div style={{ display: "grid", gap: "6px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: "#5a4630" }}>Enemy preview</div>
                <div style={segmentedWrapStyle}>
                  <button type="button" onClick={() => setPreviewMode("empty")} style={segmentedBtnStyle(previewMode === "empty")}>
                    Off
                  </button>
                  <button type="button" onClick={() => setPreviewMode("hash")} style={segmentedBtnStyle(previewMode === "hash")}>
                    Hash
                  </button>
                </div>
              </div>
              {previewMode === "hash" && (
                <>
                  <div style={{ fontSize: "12px", fontWeight: 700, color: "#5a4630" }}>Enemy hash</div>
                  <input
                    value={enemyHashInput}
                    onChange={(e) => onEnemyHashChange(e.target.value)}
                    placeholder="12-char base36 hash"
                    maxLength={12}
                    style={{
                      border: enemyHashStatus === "invalid" ? "2px solid #9f3030" : "1px solid #bda98b",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      fontFamily: '"JetBrains Mono", monospace',
                      letterSpacing: "1px",
                      fontWeight: 700,
                      background: "#fff9ef",
                    }}
                  />
                  <div style={{ fontSize: "12px", color: enemyHashStatus === "invalid" ? "#7c1e1e" : "#5a4630" }}>
                    {enemyHashStatus === "invalid" ? "Invalid hash." : enemyHashStatus === "valid" ? "Preview on." : "Paste a hash."}
                  </div>
                </>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#5a4630" }}>Player</div>
              <div style={segmentedWrapStyle}>
                <button type="button" onClick={() => setPlayerColor("black")} style={segmentedBtnStyle(playerColor === "black")}>
                  Black
                </button>
                <button type="button" onClick={() => setPlayerColor("white")} style={segmentedBtnStyle(playerColor === "white")}>
                  White
                </button>
              </div>

              <div style={{ fontSize: "12px", fontWeight: 700, color: "#5a4630" }}>Units</div>
              <div style={segmentedWrapStyle}>
                <button type="button" onClick={() => setUnitViewMode("icon")} style={segmentedBtnStyle(unitViewMode === "icon")}>
                  Icons
                </button>
                <button type="button" onClick={() => setUnitViewMode("number")} style={segmentedBtnStyle(unitViewMode === "number")}>
                  Numbers
                </button>
              </div>
            </div>
          </div>
        </section>

        <section style={{ display: "grid", gap: "10px" }}>
          <div style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "10px", display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "center" }}>
            {(["1", "2", "3", "eraser"] as Brush[]).map((b) => {
              const isSelected = brush === b;
              const brushCell: TileCell = b === "eraser" ? EMPTY_CELL : { height: Number(b) as 1 | 2 | 3, tribun: tribunBrush };
              const ownIsBlack = playerColor === "black";
              const fillColor = tribunBrush ? (ownIsBlack ? "#AE0000" : "#00B4FF") : ownIsBlack ? "#000" : "#fff";
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBrush(b)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "10px",
                    border: "2px solid #6f5a38",
                    // Neutral brush background so the unit/trash tint stays readable regardless of color.
                    background: isSelected ? "#4B4B4B" : "#636363",
                    fontWeight: 700,
                    cursor: "pointer",
                    minWidth: "56px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: "40px",
                    gap: "8px",
                  }}
                >
                  {b === "eraser" ? (
                    <TrashGlyph sizePx={18} fillColor={fillColor} />
                  ) : (
                    <SetupUnitGlyph cell={brushCell} viewMode={unitViewMode} side="own" playerColor={playerColor} size="small" />
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setTribunBrush((v) => !v)}
              disabled={brush === "eraser"}
              style={{
                padding: "6px 10px",
                borderRadius: "10px",
                border: "2px solid #6f5a38",
                background: tribunBrush ? "#f2d9b2" : "#fff6e8",
                fontWeight: 700,
                cursor: brush === "eraser" ? "not-allowed" : "pointer",
                height: "40px",
                opacity: brush === "eraser" ? 0.55 : 1,
              }}
              title={brush === "eraser" ? "Tribun brush disabled while erasing" : "Toggle Tribun brush"}
            >
              Tribun
            </button>
            <button
              type="button"
              onClick={() => setOnlyEmpty((v) => !v)}
              style={{
                padding: "6px 10px",
                borderRadius: "10px",
                border: "2px solid #6f5a38",
                background: onlyEmpty ? "#f2d9b2" : "#fff6e8",
                fontWeight: 700,
                cursor: "pointer",
                height: "40px",
              }}
              title="Toggle: only write on empty tiles"
            >
              Empty-only
            </button>
          </div>

          <div
            style={{
              flex: 1,
              minHeight: 0,
              borderRadius: "18px",
              border: "2px solid #3c3226",
              background: "rgba(255, 250, 242, 0.7)",
              boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
              padding: "10px",
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <button
              type="button"
              onClick={() => setRotate180((prev) => !prev)}
              title="Flip board"
              aria-label="Flip board"
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                width: "24px",
                height: "24px",
                borderRadius: "6px",
                border: `2px solid ${rotate180 ? "#111" : "#1c1a16"}`,
                background: rotate180 ? "#111" : "#f6f0e6",
                color: rotate180 ? "#f6f0e6" : "#1c1a16",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.5px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 6px 12px rgba(20, 15, 10, 0.18)",
                zIndex: 2,
              }}
            >
              180
            </button>

            <div style={{ width: "100%", display: "flex", justifyContent: "center", overflow: "auto" }}>
              <div style={{ position: "relative", minWidth: `${boardMetrics.width}px`, height: `${boardMetrics.height}px` }}>
                {boardMetrics.tiles.map((tile) => {
                  const ownIdx = OWN_CID_TO_INDEX.get(tile.cid);
                  const enemyIdx = ENEMY_CID_TO_INDEX.get(tile.cid);
                  const isOwnSetupTile = ownIdx !== undefined;
                  const isEnemySetupTile = enemyIdx !== undefined;
                  const own = isOwnSetupTile ? ownCells[ownIdx] : EMPTY_CELL;
                  const enemy = isEnemySetupTile && previewMode === "hash" ? enemyCells[enemyIdx] : EMPTY_CELL;
                  const isBrushable = isOwnSetupTile ? brushableSet.has(ownIdx) : false;
                  const hexX = tile.centerX - boardMetrics.outerHexWidth / 2 - boardMetrics.minX;
                  const hexY = tile.centerY - boardMetrics.outerHexHeight / 2 - boardMetrics.minY;
                  const baseColor = getBaseColor(tile.x, tile.y);
                  const hexState: HexagonState = isOwnSetupTile && isBrushable ? "selectable" : "default";
                  const bg = getHexagonColor(baseColor, hexState);
                  const clip = "polygon(100% 50%, 75% 0%, 25% 0%, 0% 50%, 25% 100%, 75% 100%)";

                  return (
                    <div
                      key={tile.cid}
                      style={{
                        position: "absolute",
                        left: `${hexX}px`,
                        top: `${hexY}px`,
                        width: `${boardMetrics.outerHexWidth}px`,
                        height: `${boardMetrics.outerHexHeight}px`,
                        clipPath: clip,
                        background: "#2d2922",
                        cursor: isOwnSetupTile ? "pointer" : "default",
                      }}
                      onMouseDown={(e) => {
                        if (!isOwnSetupTile) return;
                        if (e.button !== 0 && e.button !== 2) return;
                        if (e.button === 2) e.preventDefault();
                        startPaint(tile.cid, e.button as 0 | 2);
                      }}
                      onMouseEnter={() => {
                        if (!isOwnSetupTile) return;
                        continuePaint(tile.cid);
                      }}
                      onContextMenu={(e) => e.preventDefault()}
                    >
                      <div
                        style={{
                          position: "absolute",
                          inset: "2px",
                          clipPath: clip,
                          background: bg,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          userSelect: "none",
                        }}
                      >
                        {own.height > 0 && <SetupUnitGlyph cell={own} viewMode={unitViewMode} side="own" playerColor={playerColor} />}
                        {enemy.height > 0 && <SetupUnitGlyph cell={enemy} viewMode={unitViewMode} side="enemy" playerColor={playerColor} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {ownValidation.problems.length > 0 && (
          <section style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "12px", display: "grid", gap: "8px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#7a6543" }}>Problems</div>
            <ul style={{ margin: 0, paddingLeft: "18px", color: "#7a2020", display: "grid", gap: "6px" }}>
              {ownValidation.problems.map((p, idx) => (
                <li key={`${p.kind}-${idx}`}>{p.message}</li>
              ))}
            </ul>
          </section>
        )}

        <section style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "12px", display: "grid", gap: "8px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#7a6543" }}>Stats</div>
          <div style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#5a4630" }}>
            <div>
              Hash:{" "}
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                {ownValidation.problems.length === 0 && ownValidation.hash ? ownValidation.hash : "—"}
              </span>
            </div>
            <div>
              Used: #1={ownValidation.counts.ones} · #2={ownValidation.counts.twos} · #3={ownValidation.counts.threes}
            </div>
            <div>Tribun height: {ownValidation.tribunHeight > 0 ? ownValidation.tribunHeight : "—"}</div>
          </div>
        </section>
      </main>
    </div>
  );
}
