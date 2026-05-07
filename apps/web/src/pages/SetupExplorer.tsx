import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import * as engine from "@tribunplay/engine";
import { getBaseColor, getHexagonColor, type HexagonState } from "../hexagonColors";
import { UnitGlyph as SharedUnitGlyph } from "../ui/UnitGlyph";
import SetupHashInput from "../ui/SetupHashInput";
import { areAllUnitIconsReady, preloadAllUnitIcons } from "../ui/unitIcons";
import { useBoardSfx } from "../audio/boardSfx";
import {
  decodeCodeDetailed,
  encodePositionDetailed,
  type SetupMasks,
  SETUP_REGION_LIME,
  SETUP_REGION_ORANGE,
  SETUP_REGION_RED,
  SETUP_REGION_YELLOW,
} from "@tribunplay/engine";
import {
  addSetupToLibrary,
  deleteSetupLibraryItem,
  findSetupLibraryIdentityMatch,
  isSetupLibraryAvailable,
  loadSetupLibrary,
  renameSetupLibraryItem,
} from "../setupLibrary";
import { getFlippedSetupHash, normalizeSetupHashInput } from "../setupHashFlip";
import { filterSetupLibraryItems, type SetupLibrarySearchMode } from "../ui/setupLibraryFilters";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";

type Brush = "1" | "2" | "3" | "eraser";
type TileCell = { height: 0 | 1 | 2 | 3; tribun: boolean };
type HashStatus = "idle" | "valid" | "invalid";
type PreviewMode = "empty" | "hash";
type PlayerCosmetic = "black" | "white";
type UnitViewMode = "icon" | "number";
type UnitSide = "own" | "enemy";
type DefenseMode = "none" | "empty" | "occupied" | "all";
type ValidationProblem = {
  kind: string;
  message: string;
  details: Record<string, unknown>;
};

type ArmySizeStatus = { ok: true; armySize: number } | { ok: false };

const EMPTY_CELL: TileCell = { height: 0, tribun: false };
const TRASH_ICON_URL = new URL("../assets/game/setup/Trash.webp", import.meta.url).href;
const TRASH_OUTLINE_URL = new URL("../assets/game/setup/_Trash.webp", import.meta.url).href;
const OPCODE_MOVE = 0;
const OPCODE_COMBINE = 5;
const OPCODE_SPLIT = 7;
const OPCODE_DRAW = 10;
const OPCODE_END = 11;

function TrashGlyph(props: { sizePx: number; fillColor: string; outlineColor: string }) {
  const { sizePx, fillColor, outlineColor } = props;

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
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          backgroundColor: outlineColor,
          WebkitMaskImage: `url(${TRASH_OUTLINE_URL})`,
          WebkitMaskRepeat: "no-repeat",
          WebkitMaskPosition: "center",
          WebkitMaskSize: "contain",
          maskImage: `url(${TRASH_OUTLINE_URL})`,
          maskRepeat: "no-repeat",
          maskPosition: "center",
          maskSize: "contain",
        }}
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

function isBase37Code16(value: string): boolean {
  return /^[0-9A-Z#]{16}$/.test(value);
}

function setupToCells(setup: SetupMasks): TileCell[] {
  const cells = makeEmptyCells();

  for (let idx = 0; idx < SETUP_REGION_LIME; idx++) {
    const is1 = ((setup.mask1 >> BigInt(idx)) & 1n) === 1n;
    const is2 = idx < SETUP_REGION_ORANGE ? ((setup.mask2 >> BigInt(idx)) & 1n) === 1n : false;
    const is3 = idx < SETUP_REGION_RED ? ((setup.mask3 >> BigInt(idx)) & 1n) === 1n : false;

    if (is1) cells[idx] = { height: 1, tribun: false };
    else if (is2) cells[idx] = { height: 2, tribun: false };
    else if (is3) cells[idx] = { height: 3, tribun: false };
  }

  // Tribun height is encoded by which bitmap contains tribTile.
  const t = setup.tribTile;
  const t3 = t < SETUP_REGION_RED ? ((setup.mask3 >> BigInt(t)) & 1n) === 1n : false;
  const t2 = t < SETUP_REGION_ORANGE ? ((setup.mask2 >> BigInt(t)) & 1n) === 1n : false;
  const tribHeight: 1 | 2 | 3 = t3 ? 3 : t2 ? 2 : 1;
  cells[t] = { height: tribHeight, tribun: true };
  return cells;
}

function cellsToSetupMasks(cells: TileCell[]): SetupMasks | null {
  let tribTile = -1;
  let mask3 = 0n;
  let mask2 = 0n;
  let mask1 = 0n;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (cell.height === 0) continue;
    if (cell.tribun) {
      if (tribTile !== -1) return null;
      tribTile = i;
    }
    if (cell.height === 3) mask3 |= 1n << BigInt(i);
    else if (cell.height === 2) mask2 |= 1n << BigInt(i);
    else mask1 |= 1n << BigInt(i);
  }
  if (tribTile === -1) return null;
  return { tribTile, mask3, mask2, mask1 };
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
  if (!isBase37Code16(value)) return "invalid";
  const decoded = decodeCodeDetailed(value);
  return decoded.ok ? "valid" : "invalid";
}

function SetupUnitGlyph(props: {
  cell: TileCell;
  viewMode: UnitViewMode;
  side: UnitSide;
  playerColor: PlayerCosmetic;
  iconsReady: boolean;
  size?: "board" | "small";
}) {
  const { cell, viewMode, side, playerColor, size = "board" } = props;
  if (cell.height === 0) return null;

  const ownIsBlack = playerColor === "black";
  const sideIsBlack = side === "own" ? ownIsBlack : !ownIsBlack;

  const mode = viewMode === "icon" && props.iconsReady ? "icon" : "number";
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
  const { playSfx } = useBoardSfx();
  const [unitIconsReady, setUnitIconsReady] = useState(() => areAllUnitIconsReady());
  const [brush, setBrush] = useState<Brush>("1");
  const [tribunBrush, setTribunBrush] = useState(false);
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [userFlip180, setUserFlip180] = useState(false);
  const [playerColor, setPlayerColor] = useState<PlayerCosmetic>("black");
  const [unitViewMode, setUnitViewMode] = useState<UnitViewMode>("icon");
  const [hashCopyStatus, setHashCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [defenseMode, setDefenseMode] = useState<DefenseMode>("none");
  const paintRef = useRef<{ active: boolean; button: 0 | 2; lastCid: number | null }>({
    active: false,
    button: 0,
    lastCid: null,
  });
  const userFlippedRef = useRef(false);

  const [ownCells, setOwnCells] = useState<TileCell[]>(makeEmptyCells);
  const [ownHashInput, setOwnHashInput] = useState("");
  const [ownHashStatus, setOwnHashStatus] = useState<HashStatus>("idle");

  const [previewMode, setPreviewMode] = useState<PreviewMode>("empty");
  const [enemyCells, setEnemyCells] = useState<TileCell[]>(makeEmptyCells);
  const [enemyHashInput, setEnemyHashInput] = useState("");
  const [enemyHashStatus, setEnemyHashStatus] = useState<HashStatus>("idle");
  const [libraryItems, setLibraryItems] = useState<engine.SetupLibraryItem[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [librarySearchTarget, setLibrarySearchTarget] = useState<UnitSide | null>(null);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [librarySearchMode, setLibrarySearchMode] = useState<SetupLibrarySearchMode>("name");
  const [libraryArmyMin, setLibraryArmyMin] = useState<number | "">("");
  const [libraryArmyMax, setLibraryArmyMax] = useState<number | "">("");
  const [libraryTribunHeight, setLibraryTribunHeight] = useState<0 | 1 | 2 | 3>(0);
  const [editingLibraryItemId, setEditingLibraryItemId] = useState<string | null>(null);
  const [editingLibraryName, setEditingLibraryName] = useState("");
  const [libraryItemActionBusyId, setLibraryItemActionBusyId] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveModalName, setSaveModalName] = useState("");
  const [saveModalBusy, setSaveModalBusy] = useState(false);
  /** Shown inside the save overlay — `librarySaveMessage` sits beneath it and stays hidden while the modal is open. */
  const [saveModalError, setSaveModalError] = useState<string | null>(null);
  const [librarySaveMessage, setLibrarySaveMessage] = useState<string | null>(null);
  const libraryEnabled = isSetupLibraryAvailable();

  useEffect(() => {
    let active = true;
    if (areAllUnitIconsReady()) {
      setUnitIconsReady(true);
      return () => {
        active = false;
      };
    }
    void preloadAllUnitIcons().then(() => {
      if (active) {
        setUnitIconsReady(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const refreshLibrary = async () => {
    if (!libraryEnabled) {
      setLibraryItems([]);
      setLibraryLoaded(false);
      setLibraryError("Setup library is only available for signed-in accounts.");
      return;
    }
    setLibraryLoading(true);
    setLibraryError(null);
    try {
      const items = await loadSetupLibrary();
      setLibraryItems(items);
      setLibraryLoaded(true);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "Failed to load setup library.");
    } finally {
      setLibraryLoading(false);
    }
  };

  const openLibrarySearch = async (target: UnitSide) => {
    if (!libraryEnabled) return;
    setEditingLibraryItemId(null);
    setEditingLibraryName("");
    setLibrarySearchTarget(target);
    if (!libraryLoaded && !libraryLoading) {
      await refreshLibrary();
    }
  };

  useEffect(() => {
    if (!libraryEnabled) return;
    if (libraryLoaded || libraryLoading) return;
    void refreshLibrary();
  }, [libraryEnabled, libraryLoaded, libraryLoading]);

  // Mapping between setup-index space and board CIDs depends on which player perspective we are displaying.
  // Important: we keep the underlying `ownCells[]` indexing/hash encoding stable; only which CID each index
  // is rendered onto (and painted via) changes with `playerColor`.
  const ownCidToIndex = playerColor === "white" ? OWN_CID_TO_INDEX : ENEMY_CID_TO_INDEX;
  const enemyCidToIndex = playerColor === "white" ? ENEMY_CID_TO_INDEX : OWN_CID_TO_INDEX;
  const ownSetupCids = playerColor === "white" ? OWN_SETUP_CIDS : ENEMY_SETUP_CIDS;
  const ownEngineColor: engine.Color = playerColor === "black" ? 0 : 1;
  const rotate180 = (playerColor === "black") !== userFlip180;

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
    const setupIsStructurallyPossible =
      tribunIndices.length === 1 && (tribunHeight === 1 || tribunHeight === 2 || tribunHeight === 3);

    const problems: ValidationProblem[] = [];

    if (counts.tribun !== 1) {
      problems.push({
        kind: "TRIBUN_COUNT",
        message: counts.tribun === 0 ? "Place a Tribun unit." : `Tribun count must be 1 (currently ${counts.tribun}).`,
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
    if (used < 3) {
      const missingHeight = 3 - used;
      problems.push({
        kind: "MIN_TOTAL_HEIGHT",
        message: `Total height must be at least 3 (currently ${used}). Add at least +${missingHeight} height.`,
        details: { used, missingHeight },
      });
    }
    {
      // Payment rules (UI counts exclude the tribun tile itself).
      const hasOneTribun = tribunIndices.length === 1;
      const tH = hasOneTribun ? tribunHeight : 0;

      // 3-payment: cover 3-high units with 2-high units.
      // For 1T there are two variants:
      // - Variant A: one free 2-high unit -> effectively (n2-1) >= 2*n3
      // - Variant B: two free 1-high units -> n2 >= 2*n3
      const ok3PayVariantA = tH === 1 ? counts.twos - 1 >= 2 * counts.threes : counts.twos >= 2 * counts.threes;
      const ok3PayVariantB = tH === 1 ? counts.twos >= 2 * counts.threes : counts.twos >= 2 * counts.threes;
      const ok3Pay = tH === 1 ? ok3PayVariantA || ok3PayVariantB : ok3PayVariantA;
      if (!ok3Pay) {
        const requiredTwos = 2 * counts.threes;
        // 1T only: Variant A treats one 2-unit as "free" (effectively #2-1), Variant B does not.
        const needMore2VariantA = tH === 1 ? Math.max(0, (requiredTwos + 1) - counts.twos) : Math.max(0, requiredTwos - counts.twos);
        const needMore2VariantB = Math.max(0, requiredTwos - counts.twos);
        problems.push({
          kind: "PAYMENT_3",
          message:
            tH === 1
              ? `3-payments failed for both 1T variants, you need more 2 units: +${needMore2VariantA} or +${needMore2VariantB}.`
              : `3-payments failed, you need more 2 units: +${needMore2VariantB}.`,
          details: {
            n2: counts.twos,
            n3: counts.threes,
            tribunHeight: tH,
            okVariantA: ok3PayVariantA,
            okVariantB: ok3PayVariantB,
            needMore2VariantA,
            needMore2VariantB,
          },
        });
      }

      // 2-payment: cover 2-high units with 1-high units (accounting for the free allocation).
      if (tH === 1) {
        // Variant A: one free 2-high -> (#1-1) >= (#2-1) => #1 >= #2-1
        const okFree2 = counts.ones >= counts.twos - 1;
        // Variant B: two free 1-high -> (#1-3) >= #2, but #1 includes the tribun itself => counts.ones >= #2+2
        const okFree11 = counts.ones >= counts.twos + 2;
        if (!okFree2 && !okFree11) {
          const needMore1VariantA = Math.max(0, (counts.twos - 1) - counts.ones);
          const needMore1VariantB = Math.max(0, (counts.twos + 2) - counts.ones);
          problems.push({
            kind: "PAYMENT_2",
            message: `2-payments failed for both 1T variants, you need more 1 units: +${needMore1VariantA} or +${needMore1VariantB}.`,
            details: { n1: counts.ones, n2: counts.twos, okFree2, okFree11, needMore1VariantA, needMore1VariantB },
          });
        }
      } else if (tH === 2) {
        // 2T: one free 1-high => (#1-1) >= #2, but #1 includes the tribun itself => counts.ones >= #2
        const ok = counts.ones >= counts.twos;
        if (!ok) {
          const needMore1 = Math.max(0, counts.twos - counts.ones);
          problems.push({
            kind: "PAYMENT_2",
            message: `2-payments failed for 2T, you need more 1 units: +${needMore1}.`,
            details: { n1: counts.ones, n2: counts.twos, tribunHeight: tH, needMore1 },
          });
        }
      } else {
        // No Tribun (pre-encoding) or 3T: require #1 >= #2.
        const ok = counts.ones >= counts.twos;
        if (!ok) {
          const needMore1 = Math.max(0, counts.twos - counts.ones);
          problems.push({
            kind: "PAYMENT_2",
            message: `2-payments failed, you need more 1 units: +${needMore1}.`,
            details: { n1: counts.ones, n2: counts.twos, tribunHeight: tH, needMore1 },
          });
        }
      }
    }

    const symViolations = collectSymmetryViolations(ownCells);
    const symmetryByMessage = new Map<string, { messageBase: string; count: number }>();
    for (const v of symViolations) {
      // `v.kind` is like "1", "2", "3", "1T", ...; we only want the height.
      const height = Number(v.kind[0]);
      let effectiveOrientation = rotate180 ? (v.orientation === "UP" ? "DOWN" : "UP") : v.orientation;
      // Triangle labeling is defined in "own/canonical" space; when viewing as White, invert the displayed notion.
      if (playerColor === "white") effectiveOrientation = effectiveOrientation === "UP" ? "DOWN" : "UP";
      const glyph = effectiveOrientation === "UP" ? "△" : "▽";
      const messageBase = `Symmetry: ${height} ${glyph}`;
      const existing = symmetryByMessage.get(messageBase);
      if (existing) existing.count += 1;
      else symmetryByMessage.set(messageBase, { messageBase, count: 1 });
    }
    for (const entry of symmetryByMessage.values()) {
      const suffix = entry.count > 1 ? ` ×${entry.count}` : "";
      problems.push({
        kind: "SYMMETRY",
        message: `${entry.messageBase}${suffix}`,
        details: { count: entry.count },
      });
    }

    let hash: string | null = null;
    let armySize: ArmySizeStatus = { ok: false };
    if (problems.length === 0) {
      if (!setupIsStructurallyPossible) {
        problems.push({
          kind: "ENCODE",
          message: "Encoding failed: tribun tile/height is not set correctly.",
          details: { tribunIndices, tribunHeight },
        });
      } else {
        const setup = cellsToSetupMasks(ownCells);
        if (!setup) {
          problems.push({
            kind: "ENCODE",
            message: "Encoding failed: could not build setup masks.",
            details: { tribunIndices, tribunHeight },
          });
        } else {
          const encoded = encodePositionDetailed(setup);
          if (encoded.ok) {
            hash = encoded.code;
            if (encoded.characteristics) {
              armySize = { ok: true, armySize: encoded.characteristics.armySize };
            }
          }
          else {
            problems.push({
              kind: "ENCODE",
              message: `Encoding failed: ${encoded.error?.kind ?? "unknown error"}.`,
              details: { error: encoded.error },
            });
          }
        }
      }
    }

    return {
      counts,
      tribunHeight,
      tribunIndices,
      used,
      problems,
      hash,
      armySize,
    };
  }, [ownCells, rotate180, playerColor]);

  const saveCandidateHash = ownValidation.problems.length === 0 ? ownValidation.hash : null;
  const saveCandidateArmySize = ownValidation.armySize.ok ? ownValidation.armySize.armySize : null;
  const saveCandidateTribunHeight =
    ownValidation.tribunHeight === 1 || ownValidation.tribunHeight === 2 || ownValidation.tribunHeight === 3
      ? ownValidation.tribunHeight
      : null;
  const existingLibraryIdentityMatch = useMemo(
    () => (saveCandidateHash ? findSetupLibraryIdentityMatch(libraryItems, saveCandidateHash) : null),
    [libraryItems, saveCandidateHash],
  );
  const addOrRenameLabel = existingLibraryIdentityMatch ? "Rename" : "Add to library";

  const filteredLibraryItems = useMemo(() => {
    return filterSetupLibraryItems(libraryItems, {
      query: libraryQuery,
      searchMode: librarySearchMode,
      armyMin: libraryArmyMin,
      armyMax: libraryArmyMax,
      tribunHeight: libraryTribunHeight,
    });
  }, [libraryItems, libraryQuery, librarySearchMode, libraryArmyMin, libraryArmyMax, libraryTribunHeight]);

  const ownBoardContext = useMemo(() => {
    const board = new Uint8Array(121);
    const occupiedHeightByCid = new Uint8Array(121);

    for (let idx = 0; idx < ownCells.length; idx++) {
      const cell = ownCells[idx];
      if (cell.height === 0) continue;
      const cid = ownSetupCids[idx];
      occupiedHeightByCid[cid] = cell.height;
      board[cid] = engine.unitToUnitByte({
        color: ownEngineColor,
        tribun: cell.tribun,
        p: cell.height,
        s: 0,
      });
    }

    return { board, occupiedHeightByCid };
  }, [ownCells, ownSetupCids, ownEngineColor]);

  const defenseOverlay = useMemo(() => {
    const countByCid = new Uint8Array(121);
    const damageByCid = new Uint16Array(121);

    for (let idx = 0; idx < ownCells.length; idx++) {
      const cell = ownCells[idx];
      if (cell.height === 0) continue;

      const fromCid = ownSetupCids[idx];
      const reachable = engine.getAttackReachableTiles(
        fromCid,
        cell.height,
        ownEngineColor,
        cell.tribun,
        ownBoardContext.board
      );
      const uniqueReachable = new Set(reachable);
      for (const targetCid of uniqueReachable) {
        countByCid[targetCid] += 1;
        damageByCid[targetCid] += cell.height;
      }
    }

    return { countByCid, damageByCid };
  }, [ownCells, ownSetupCids, ownEngineColor, ownBoardContext.board]);

  const moveStats = useMemo(() => {
    if (ownValidation.problems.length > 0 || !ownValidation.hash) return null;

    const state: engine.State = {
      board: new Uint8Array(ownBoardContext.board),
      turn: ownEngineColor,
      ply: 0,
      drawOfferBy: null,
      drawOfferBlocked: null,
      status: "active",
    };

    const actions = engine.generateLegalActions(state);
    let move = 0;
    let split = 0;
    let combination = 0;
    let total = 0;

    for (const action of actions) {
      const decoded = engine.decodeAction(action);
      if (decoded.opcode === OPCODE_MOVE) move++;
      if (decoded.opcode === OPCODE_SPLIT) split++;
      if (decoded.opcode === OPCODE_COMBINE) combination++;

      // Keep total focused on gameplay actions and exclude meta draw/end options.
      if (decoded.opcode !== OPCODE_DRAW && decoded.opcode !== OPCODE_END) total++;
    }

    return { move, split, combination, total };
  }, [ownValidation.problems.length, ownValidation.hash, ownBoardContext.board, ownEngineColor]);

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
    const setupIndex = ownCidToIndex.get(cid);
    if (setupIndex === undefined) return;
    const currentCell = ownCells[setupIndex];
    const hasOccupiedCell = cellOccupied(currentCell);
    const nextHeight = brush === "eraser" ? null : (Number(brush) as 1 | 2 | 3);
    const canApplyBrush = brush === "eraser"
      ? hasOccupiedCell
      : nextHeight !== null && canPlaceOnIndex(setupIndex, nextHeight, tribunBrush, onlyEmpty, ownCells);
    const clearsOtherTribun =
      brush !== "eraser" && tribunBrush && ownCells.some((cell, index) => index !== setupIndex && cell.tribun);
    const sameResultAsCurrent =
      brush !== "eraser" &&
      nextHeight !== null &&
      currentCell.height === nextHeight &&
      currentCell.tribun === tribunBrush &&
      !clearsOtherTribun;

    if (!canApplyBrush || sameResultAsCurrent) return;
    playSfx("tileClick");

    setOwnCells((prev) => {
      const next = prev.map((cell) => ({ ...cell }));
      if (brush === "eraser") {
        next[setupIndex] = { ...EMPTY_CELL };
        return next;
      }
      const height = Number(brush) as 1 | 2 | 3;
      if (tribunBrush) {
        for (let i = 0; i < next.length; i++) {
          if (next[i].tribun) next[i] = { ...EMPTY_CELL };
        }
      }
      next[setupIndex] = { height, tribun: tribunBrush };
      return next;
    });
  };

  const applyRightErase = (cid: number) => {
    const setupIndex = ownCidToIndex.get(cid);
    if (setupIndex === undefined) return;
    if (!cellOccupied(ownCells[setupIndex])) return;
    playSfx("tileClick");
    setOwnCells((prev) => {
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

  // Render-only "selectable" tiles: keep empty-only write behavior, but avoid visually disabling occupied tiles.
  // This mirrors the non-empty-only styling while leaving placement rules unchanged.
  const brushableRenderSet = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < SETUP_REGION_LIME; i++) {
      const cell = ownCells[i];
      if (brush === "eraser") {
        if (cellOccupied(cell)) set.add(i);
        continue;
      }
      const height = Number(brush) as 1 | 2 | 3;
      if (canPlaceOnIndex(i, height, tribunBrush, false, ownCells)) set.add(i);
    }
    return set;
  }, [brush, tribunBrush, ownCells]);

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

  useEffect(() => {
    if (hashCopyStatus === "idle") return;
    const t = window.setTimeout(() => setHashCopyStatus("idle"), 1200);
    return () => window.clearTimeout(t);
  }, [hashCopyStatus]);

  useEffect(() => {
    if (!librarySaveMessage) return;
    const t = window.setTimeout(() => setLibrarySaveMessage(null), 2400);
    return () => window.clearTimeout(t);
  }, [librarySaveMessage]);

  useEffect(() => {
    const hash = ownValidation.hash;
    if (!hash) return;
    setOwnHashInput((prev) => (prev === hash ? prev : hash));
    setOwnHashStatus("valid");
  }, [ownValidation.hash]);

  const onOwnHashChange = (raw: string) => {
    const value = normalizeSetupHashInput(raw);
    setOwnHashInput(value);
    const status = deriveHashStatus(value);
    setOwnHashStatus(status);
    if (status === "valid") {
      const decoded = decodeCodeDetailed(value);
      if (decoded.ok && decoded.setup) {
        setOwnCells(setupToCells(decoded.setup));
      }
    }
  };

  const flipOwnHashInput = () => {
    const flipped = getFlippedSetupHash(ownHashInput);
    if (!flipped) return;
    onOwnHashChange(flipped);
  };

  const copyOwnHashToClipboard = async () => {
    const hash = ownValidation.problems.length === 0 ? ownValidation.hash : null;
    if (!hash) return;
    try {
      await navigator.clipboard.writeText(hash);
      setHashCopyStatus("copied");
    } catch {
      setHashCopyStatus("failed");
    }
  };

  const closeSaveModal = () => {
    setSaveModalOpen(false);
    setSaveModalError(null);
  };

  const addOwnSetupToLibrary = () => {
    if (!libraryEnabled) return;
    if (!saveCandidateHash || saveCandidateArmySize === null || saveCandidateTribunHeight === null) {
      setLibrarySaveMessage("Save failed: setup hash or metadata is not valid yet.");
      return;
    }
    const suggestedName = existingLibraryIdentityMatch?.name ?? `Setup ${saveCandidateHash.slice(0, 6)}`;
    setSaveModalName(suggestedName);
    setSaveModalError(null);
    setSaveModalOpen(true);
  };

  const commitOwnSetupToLibrary = async () => {
    if (!saveCandidateHash || saveCandidateArmySize === null || saveCandidateTribunHeight === null) {
      setLibrarySaveMessage("Save failed: setup hash or metadata is not valid yet.");
      closeSaveModal();
      return;
    }
    const name = saveModalName.trim();
    if (!name) {
      setSaveModalError("Name cannot be empty.");
      return;
    }
    setSaveModalError(null);
    setSaveModalBusy(true);
    try {
      await addSetupToLibrary({
        name,
        hash: saveCandidateHash,
        armySize: saveCandidateArmySize,
        tribunHeight: saveCandidateTribunHeight,
      });
      setLibrarySaveMessage(`${existingLibraryIdentityMatch ? "Renamed" : "Saved"} "${name}" in your setup library.`);
      closeSaveModal();
      await refreshLibrary();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save setup.";
      setSaveModalError(message);
    } finally {
      setSaveModalBusy(false);
    }
  };

  const startEditingLibraryItem = (item: engine.SetupLibraryItem) => {
    setEditingLibraryItemId(item.id);
    setEditingLibraryName(item.name);
  };

  const cancelEditingLibraryItem = () => {
    setEditingLibraryItemId(null);
    setEditingLibraryName("");
  };

  const commitEditingLibraryItem = async (itemId: string) => {
    const nextName = editingLibraryName.trim();
    if (!nextName) {
      setLibrarySaveMessage("Name cannot be empty.");
      return;
    }
    setLibraryItemActionBusyId(itemId);
    try {
      await renameSetupLibraryItem({ itemId, name: nextName });
      setLibrarySaveMessage(`Renamed to "${nextName}".`);
      cancelEditingLibraryItem();
      await refreshLibrary();
    } catch (error) {
      setLibrarySaveMessage(error instanceof Error ? error.message : "Failed to rename setup.");
    } finally {
      setLibraryItemActionBusyId(null);
    }
  };

  const removeLibraryItem = async (item: engine.SetupLibraryItem) => {
    if (!window.confirm(`Are you sure you want to delete "${item.name}"?`)) return;
    setLibraryItemActionBusyId(item.id);
    try {
      await deleteSetupLibraryItem(item.id);
      setLibrarySaveMessage(`Deleted "${item.name}".`);
      if (editingLibraryItemId === item.id) {
        cancelEditingLibraryItem();
      }
      await refreshLibrary();
    } catch (error) {
      setLibrarySaveMessage(error instanceof Error ? error.message : "Failed to delete setup.");
    } finally {
      setLibraryItemActionBusyId(null);
    }
  };

  const applyLibraryHash = (target: UnitSide, hash: string) => {
    const normalized = normalizeSetupHashInput(hash);
    if (target === "own") {
      onOwnHashChange(normalized);
    } else {
      setPreviewMode("hash");
      onEnemyHashChange(normalized);
    }
    setLibrarySearchTarget(null);
  };

  const onEnemyHashChange = (raw: string) => {
    const value = normalizeSetupHashInput(raw);
    setEnemyHashInput(value);
    const status = deriveHashStatus(value);
    setEnemyHashStatus(status);
    if (status === "valid") {
      const decoded = decodeCodeDetailed(value);
      if (decoded.ok && decoded.setup) setEnemyCells(setupToCells(decoded.setup));
    } else if (status === "invalid") {
      setEnemyCells(makeEmptyCells());
    }
  };

  const flipEnemyHashInput = () => {
    const flipped = getFlippedSetupHash(enemyHashInput);
    if (!flipped) return;
    onEnemyHashChange(flipped);
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

  const ownIsBlack = playerColor === "black";
  const overlayTextFill = ownIsBlack ? "#000" : "#fff";
  const overlayTextShadow = ownIsBlack ? "#fff" : "#000";
  const armySizeOverlayValue =
    ownValidation.problems.length === 0 && ownValidation.armySize.ok ? `${ownValidation.armySize.armySize}` : "-";

  const tribunSituationWellDefined =
    ownValidation.problems.length === 0 ||
    (ownValidation.problems.length > 0 && ownValidation.problems.every((p) => p.kind === "SYMMETRY"));
  const showTribunSituationOverlay = tribunSituationWellDefined && ownValidation.counts.tribun === 1 && ownValidation.tribunHeight > 0;

  const tribunSuffix = (() => {
    if (!showTribunSituationOverlay) return null;
    const h = ownValidation.tribunHeight as 1 | 2 | 3;
    if (h === 3) return "";
    if (h === 2) return "+1";
    // h === 1
    const { ones, twos } = ownValidation.counts;
    const okFree2 = ones >= twos - 1;
    const okFree11 = ones >= twos - 2;
    if (okFree2) return "+2";
    if (okFree11) return "+1+1";
    return "";
  })();
  const tribunOverlayColor = ownIsBlack ? "#AE0000" : "#00B4FF";

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
        <PageHeaderBrand title="Setup Explorer" />
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
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
        </div>
      </header>

      {librarySearchTarget && libraryEnabled && (
        <div
          onClick={() => setLibrarySearchTarget(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(14, 10, 6, 0.58)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 80,
            padding: "14px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(760px, 100%)",
              maxHeight: "85vh",
              overflow: "auto",
              borderRadius: "16px",
              border: "2px solid #3c3226",
              background: "#fffaf0",
              padding: "14px",
              display: "grid",
              gap: "10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
              <div style={{ fontSize: "18px", fontWeight: 700, color: "#2a2218" }}>
                Setup library search ({librarySearchTarget === "own" ? "Own" : "Enemy"} hash)
              </div>
              <button
                type="button"
                onClick={() => setLibrarySearchTarget(null)}
                style={{
                  border: "1px solid #6f5a38",
                  borderRadius: "8px",
                  background: "#f2d9b2",
                  padding: "4px 8px",
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                Close
              </button>
            </div>

            <div style={{ display: "grid", gap: "8px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "13px", color: "#5a4630", fontWeight: 700 }}>
                  Currently shown: {filteredLibraryItems.length}
                </div>
                <button
                  type="button"
                  onClick={() => void refreshLibrary()}
                  style={{
                    border: "2px solid #6f5a38",
                    borderRadius: "10px",
                    background: "#f2d9b2",
                    padding: "8px 10px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Refresh
                </button>
              </div>

              <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }}>
                <input
                  type="text"
                  value={libraryQuery}
                  onChange={(event) => setLibraryQuery(event.target.value)}
                  placeholder="Search..."
                  style={{
                    border: "1px solid #bda98b",
                    borderRadius: "10px",
                    padding: "8px 10px",
                    background: "#fff9ef",
                    minWidth: 0,
                  }}
                />
                <div role="radiogroup" aria-label="Search mode" style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", gap: "5px", alignItems: "center", fontSize: "13px", color: "#5a4630", fontWeight: 700 }}>
                    <input
                      type="radio"
                      name="setup-library-search-mode"
                      checked={librarySearchMode === "name"}
                      onChange={() => setLibrarySearchMode("name")}
                    />
                    Name
                  </label>
                  <label style={{ display: "flex", gap: "5px", alignItems: "center", fontSize: "13px", color: "#5a4630", fontWeight: 700 }}>
                    <input
                      type="radio"
                      name="setup-library-search-mode"
                      checked={librarySearchMode === "hash"}
                      onChange={() => setLibrarySearchMode("hash")}
                    />
                    Hash
                  </label>
                </div>
              </div>

              <div style={{ display: "grid", gap: "8px", gridTemplateColumns: "120px 120px minmax(0, 1fr)" }}>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={libraryArmyMin}
                  onChange={(event) => {
                    if (event.target.value === "") {
                      setLibraryArmyMin("");
                      return;
                    }
                    setLibraryArmyMin(Math.max(0, Number(event.target.value)));
                  }}
                  placeholder="Army min"
                  style={{ border: "1px solid #bda98b", borderRadius: "10px", padding: "8px 10px", background: "#fff9ef" }}
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={libraryArmyMax}
                  onChange={(event) => {
                    if (event.target.value === "") {
                      setLibraryArmyMax("");
                      return;
                    }
                    setLibraryArmyMax(Math.max(0, Number(event.target.value)));
                  }}
                  placeholder="Army max"
                  style={{ border: "1px solid #bda98b", borderRadius: "10px", padding: "8px 10px", background: "#fff9ef" }}
                />
                <div role="radiogroup" aria-label="Tribun height filter" style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  {([0, 1, 2, 3] as const).map((value) => (
                    <label key={`tribun-filter-${value}`} style={{ display: "flex", gap: "4px", alignItems: "center", fontSize: "13px", color: "#5a4630", fontWeight: 700 }}>
                      <input
                        type="radio"
                        name="setup-library-tribun-filter"
                        checked={libraryTribunHeight === value}
                        onChange={() => setLibraryTribunHeight(value)}
                      />
                      {value === 0 ? "All" : `${value}`}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {libraryLoading && <div style={{ fontSize: "13px", color: "#5a4630" }}>Loading setup library...</div>}
            {libraryError && <div style={{ fontSize: "13px", color: "#7a2020" }}>{libraryError}</div>}

            <div style={{ display: "grid", gap: "8px", maxHeight: "52vh", overflow: "auto", paddingRight: "4px" }}>
              {filteredLibraryItems.map((item) => {
                const isEditing = editingLibraryItemId === item.id;
                const actionBusy = libraryItemActionBusyId === item.id;
                return (
                  <div
                    key={item.id}
                    style={{
                      border: "1px solid #ccb89b",
                      borderRadius: "10px",
                      background: "#fff9ef",
                      padding: "10px",
                      display: "grid",
                      gap: "8px",
                    }}
                  >
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "10px", alignItems: "start" }}>
                      <button
                        type="button"
                        onClick={() => applyLibraryHash(librarySearchTarget, item.hash)}
                        style={{
                          border: "none",
                          padding: 0,
                          margin: 0,
                          background: "transparent",
                          textAlign: "left",
                          cursor: "pointer",
                          minWidth: 0,
                        }}
                      >
                        <div style={{ fontSize: "14px", fontWeight: 700, color: "#2a2218" }}>{item.name}</div>
                        <div style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", color: "#5a4630", wordBreak: "break-all" }}>{item.hash}</div>
                        <div style={{ fontSize: "12px", color: "#5a4630" }}>
                          Army {item.armySize} | Tribun {item.tribunHeight}
                        </div>
                      </button>
                      <div style={{ display: "grid", gap: "6px", justifyItems: "end" }}>
                        <button
                          type="button"
                          onClick={() => startEditingLibraryItem(item)}
                          disabled={actionBusy}
                          style={{
                            border: "1px solid #6f5a38",
                            borderRadius: "8px",
                            background: "#f2d9b2",
                            padding: "4px 8px",
                            fontWeight: 700,
                            cursor: actionBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeLibraryItem(item)}
                          disabled={actionBusy}
                          style={{
                            border: "1px solid #8b3b3b",
                            borderRadius: "8px",
                            background: "#f7d7d5",
                            color: "#5c1c16",
                            padding: "4px 8px",
                            fontWeight: 700,
                            cursor: actionBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {isEditing && (
                      <div style={{ display: "grid", gap: "6px", gridTemplateColumns: "minmax(0, 1fr) auto auto", alignItems: "center" }}>
                        <input
                          type="text"
                          value={editingLibraryName}
                          onChange={(event) => setEditingLibraryName(event.target.value)}
                          placeholder="Setup name"
                          style={{
                            border: "1px solid #bda98b",
                            borderRadius: "8px",
                            padding: "6px 8px",
                            background: "#fff",
                            minWidth: 0,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void commitEditingLibraryItem(item.id)}
                          disabled={actionBusy}
                          style={{
                            border: "1px solid #6f5a38",
                            borderRadius: "8px",
                            background: "#f2d9b2",
                            padding: "6px 8px",
                            fontWeight: 700,
                            cursor: actionBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEditingLibraryItem}
                          disabled={actionBusy}
                          style={{
                            border: "1px solid #6f5a38",
                            borderRadius: "8px",
                            background: "#fff6e8",
                            padding: "6px 8px",
                            fontWeight: 700,
                            cursor: actionBusy ? "not-allowed" : "pointer",
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              {!libraryLoading && filteredLibraryItems.length === 0 && (
                <div style={{ fontSize: "13px", color: "#5a4630" }}>No matching setups found.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {saveModalOpen && (
        <div
          onClick={() => {
            if (!saveModalBusy) closeSaveModal();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(14, 10, 6, 0.58)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 82,
            padding: "14px",
          }}
        >
          <div
            onClick={(event) => event.stopPropagation()}
            style={{
              width: "min(420px, 100%)",
              borderRadius: "16px",
              border: "2px solid #3c3226",
              background: "#fffaf0",
              padding: "14px",
              display: "grid",
              gap: "10px",
            }}
          >
            <div style={{ fontSize: "18px", fontWeight: 700, color: "#2a2218" }}>
              {addOrRenameLabel}
            </div>
            <input
              type="text"
              value={saveModalName}
              onChange={(event) => setSaveModalName(event.target.value)}
              placeholder="Setup name"
              maxLength={80}
              autoFocus
              style={{
                border: "1px solid #bda98b",
                borderRadius: "10px",
                padding: "8px 10px",
                background: "#fff9ef",
              }}
            />
            {saveModalError && (
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#7c1e1e", lineHeight: 1.35 }}>{saveModalError}</div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => closeSaveModal()}
                disabled={saveModalBusy}
                style={{
                  border: "1px solid #6f5a38",
                  borderRadius: "8px",
                  background: "#fff6e8",
                  padding: "6px 10px",
                  fontWeight: 700,
                  cursor: saveModalBusy ? "not-allowed" : "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void commitOwnSetupToLibrary()}
                disabled={saveModalBusy}
                style={{
                  border: "2px solid #6f5a38",
                  borderRadius: "8px",
                  background: "#f2d9b2",
                  padding: "6px 10px",
                  fontWeight: 700,
                  cursor: saveModalBusy ? "not-allowed" : "pointer",
                }}
              >
                {saveModalBusy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      <main style={{ width: "100%", maxWidth: "1180px", margin: "0 auto", padding: "16px 12px 20px", display: "grid", gap: "12px" }}>
        <section style={{ display: "grid", gap: "10px" }}>
          <div style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "12px", display: "grid", gap: "10px" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#7a6543" }}>Setup</div>

            <div style={{ display: "grid", gap: "6px" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#5a4630" }}>Own hash</div>
              <SetupHashInput
                value={ownHashInput}
                onChange={onOwnHashChange}
                onOpenLibrary={() => void openLibrarySearch("own")}
                onFlipHash={flipOwnHashInput}
                placeholder="16-char base37 code"
                invalid={ownHashStatus === "invalid"}
                showLibraryButton={libraryEnabled}
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
                  <SetupHashInput
                    value={enemyHashInput}
                    onChange={onEnemyHashChange}
                    onOpenLibrary={() => void openLibrarySearch("enemy")}
                    onFlipHash={flipEnemyHashInput}
                    placeholder="16-char base37 code"
                    invalid={enemyHashStatus === "invalid"}
                    showLibraryButton={libraryEnabled}
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
                <button
                  type="button"
                  onClick={() => {
                    const next = "black";
                    if (next === playerColor) return;
                    userFlippedRef.current = true;
                    setPlayerColor(next);
                  }}
                  style={segmentedBtnStyle(playerColor === "black")}
                >
                  Black
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = "white";
                    if (next === playerColor) return;
                    userFlippedRef.current = true;
                    setPlayerColor(next);
                  }}
                  style={segmentedBtnStyle(playerColor === "white")}
                >
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

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#5a4630" }}>Defense</div>
              <div style={segmentedWrapStyle}>
                <button type="button" onClick={() => setDefenseMode("none")} style={segmentedBtnStyle(defenseMode === "none")}>
                  None
                </button>
                <button type="button" onClick={() => setDefenseMode("empty")} style={segmentedBtnStyle(defenseMode === "empty")}>
                  Empty
                </button>
                <button type="button" onClick={() => setDefenseMode("occupied")} style={segmentedBtnStyle(defenseMode === "occupied")}>
                  Occupied
                </button>
                <button type="button" onClick={() => setDefenseMode("all")} style={segmentedBtnStyle(defenseMode === "all")}>
                  All
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
              const outlineColor = ownIsBlack ? "#fff" : "#000";
              return (
                <button
                  key={b}
                  type="button"
                  onClick={() => setBrush(b)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "10px",
                    border: "2px solid #6f5a38",
                    // Match the UI's cream + gold highlight palette.
                    background: isSelected ? "#f2d9b2" : "#f6f0e6",
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
                    <TrashGlyph sizePx={18} fillColor={fillColor} outlineColor={outlineColor} />
                  ) : (
                    <SetupUnitGlyph
                      cell={brushCell}
                      viewMode={unitViewMode}
                      side="own"
                      playerColor={playerColor}
                      iconsReady={unitIconsReady}
                      size="small"
                    />
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
              onClick={() => {
                userFlippedRef.current = true;
                setUserFlip180((prev) => !prev);
              }}
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
            />

            {showTribunSituationOverlay && (
              <div
                aria-label="Tribun remainder"
                style={{
                  position: "absolute",
                  left: "10px",
                  bottom: "10px",
                  zIndex: 3,
                  padding: "6px 10px",
                  borderRadius: "12px",
                  border: "2px solid #6f5a38",
                  background: "rgba(255, 246, 232, 0.95)",
                  boxShadow: "0 8px 16px rgba(20, 15, 10, 0.16)",
                  fontFamily: '"JetBrains Mono", monospace',
                  fontWeight: 900,
                  fontSize: "22px",
                  letterSpacing: "0.5px",
                  color: "#5a4630",
                  userSelect: "none",
                  pointerEvents: "none",
                }}
                title="Tribun remainder (simplified)"
              >
                <span style={{ color: tribunOverlayColor }}>{ownValidation.tribunHeight}</span>
                <span
                  style={{
                    color: overlayTextFill,
                    textShadow: `-1px 0 ${overlayTextShadow}, 0 1px ${overlayTextShadow}, 1px 0 ${overlayTextShadow}, 0 -1px ${overlayTextShadow}`,
                  }}
                >
                  {tribunSuffix}
                </span>
              </div>
            )}

            <div
              aria-label="Army size"
              style={{
                position: "absolute",
                right: "10px",
                bottom: "10px",
                zIndex: 3,
                padding: "6px 10px",
                borderRadius: "12px",
                border: "2px solid #6f5a38",
                background: "rgba(255, 246, 232, 0.95)",
                boxShadow: "0 8px 16px rgba(20, 15, 10, 0.16)",
                fontFamily: '"JetBrains Mono", monospace',
                fontWeight: 900,
                fontSize: "22px",
                letterSpacing: "0.5px",
                color: overlayTextFill,
                textShadow: `-1px 0 ${overlayTextShadow}, 0 1px ${overlayTextShadow}, 1px 0 ${overlayTextShadow}, 0 -1px ${overlayTextShadow}`,
                userSelect: "none",
                pointerEvents: "none",
              }}
              title="Army size"
            >
              {armySizeOverlayValue}
            </div>

            <div style={{ width: "100%", display: "flex", justifyContent: "center", overflow: "auto" }}>
              <div style={{ position: "relative", minWidth: `${boardMetrics.width}px`, height: `${boardMetrics.height}px` }}>
                {boardMetrics.tiles.map((tile) => {
                  const ownIdx = ownCidToIndex.get(tile.cid);
                  const enemyIdx = enemyCidToIndex.get(tile.cid);
                  const isOwnSetupTile = ownIdx !== undefined;
                  const isEnemySetupTile = enemyIdx !== undefined;
                  const own = isOwnSetupTile ? ownCells[ownIdx] : EMPTY_CELL;
                  const enemy = isEnemySetupTile && previewMode === "hash" ? enemyCells[enemyIdx] : EMPTY_CELL;
                  const isBrushable = isOwnSetupTile ? brushableSet.has(ownIdx) : false;
                  const isBrushableRender = isOwnSetupTile ? brushableRenderSet.has(ownIdx) : false;
                  const hexX = tile.centerX - boardMetrics.outerHexWidth / 2 - boardMetrics.minX;
                  const hexY = tile.centerY - boardMetrics.outerHexHeight / 2 - boardMetrics.minY;
                  const baseColor = getBaseColor(tile.x, tile.y);
                  const hexState: HexagonState = isOwnSetupTile && isBrushableRender ? "selectable" : "default";
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
                        opacity: isOwnSetupTile && !isBrushable ? 0.9 : 1,
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
                        {own.height > 0 && (
                          <SetupUnitGlyph
                            cell={own}
                            viewMode={unitViewMode}
                            side="own"
                            playerColor={playerColor}
                            iconsReady={unitIconsReady}
                          />
                        )}
                        {enemy.height > 0 && (
                          <SetupUnitGlyph
                            cell={enemy}
                            viewMode={unitViewMode}
                            side="enemy"
                            playerColor={playerColor}
                            iconsReady={unitIconsReady}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
                {defenseMode !== "none" && (
                  <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 1000 }}>
                    {boardMetrics.tiles.map((tile) => {
                      const defenseCount = defenseOverlay.countByCid[tile.cid];
                      const defenseDamage = defenseOverlay.damageByCid[tile.cid];
                      const ownOccupiedHeight = ownBoardContext.occupiedHeightByCid[tile.cid];
                      const defenseModeAllowsTile =
                        defenseMode === "all" ||
                        (defenseMode === "empty" && ownOccupiedHeight === 0) ||
                        (defenseMode === "occupied" && ownOccupiedHeight > 0);
                      const showDefenseOverlay = defenseModeAllowsTile && defenseCount > 0 && defenseDamage > 0;
                      if (!showDefenseOverlay) return null;

                      const defenseCountWarn = defenseCount < 2;
                      const defenseDamageWarn = ownOccupiedHeight > 0 && defenseDamage < ownOccupiedHeight;
                      const centerX = tile.centerX - boardMetrics.minX;
                      const centerY = tile.centerY - boardMetrics.minY;

                      return (
                        <div
                          key={`defense-overlay-${tile.cid}`}
                          style={{
                            position: "absolute",
                            left: `${centerX}px`,
                            top: `${centerY}px`,
                            transform: "translate(-50%, -50%)",
                            display: "flex",
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "60%",
                            width: "44px",
                          }}
                        >
                          <div
                            style={{
                              textAlign: "center",
                              fontSize: "16px",
                              fontWeight: 800,
                              lineHeight: 1,
                              color: defenseCountWarn ? "#7a1a1a" : "#1f5b2a",
                              WebkitTextStroke: defenseCountWarn ? "0.3px #f3caca" : "0.3px #d9f1dc",
                              textShadow: defenseCountWarn
                                ? "-0.35px 0 #f3caca, 0 0.35px #f3caca, 0.35px 0 #f3caca, 0 -0.35px #f3caca"
                                : "-0.35px 0 #d9f1dc, 0 0.35px #d9f1dc, 0.35px 0 #d9f1dc, 0 -0.35px #d9f1dc",
                            }}
                          >
                            {defenseCount}
                          </div>
                          <div
                            style={{
                              textAlign: "center",
                              fontSize: "16px",
                              fontWeight: 800,
                              lineHeight: 1,
                              color: defenseDamageWarn ? "#7a1a1a" : "#1f5b2a",
                              WebkitTextStroke: defenseDamageWarn ? "0.3px #f3caca" : "0.3px #d9f1dc",
                              textShadow: defenseDamageWarn
                                ? "-0.35px 0 #f3caca, 0 0.35px #f3caca, 0.35px 0 #f3caca, 0 -0.35px #f3caca"
                                : "-0.35px 0 #d9f1dc, 0 0.35px #d9f1dc, 0.35px 0 #d9f1dc, 0 -0.35px #d9f1dc",
                            }}
                          >
                            {defenseDamage}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
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

        <section style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "12px", display: "grid", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#7a6543" }}>Hash</div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {libraryEnabled && (
                <button
                  type="button"
                  onClick={addOwnSetupToLibrary}
                  disabled={!saveCandidateHash || saveCandidateArmySize === null || saveCandidateTribunHeight === null}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "10px",
                    border: "2px solid #6f5a38",
                    background: "#fff6e8",
                    fontWeight: 700,
                    cursor: !saveCandidateHash || saveCandidateArmySize === null || saveCandidateTribunHeight === null ? "not-allowed" : "pointer",
                    opacity: !saveCandidateHash || saveCandidateArmySize === null || saveCandidateTribunHeight === null ? 0.55 : 1,
                    height: "34px",
                  }}
                  title={`${addOrRenameLabel} this setup in your library`}
                >
                  {addOrRenameLabel}
                </button>
              )}
              <button
                type="button"
                onClick={copyOwnHashToClipboard}
                disabled={ownValidation.problems.length !== 0 || !ownValidation.hash}
                style={{
                  padding: "6px 10px",
                  borderRadius: "10px",
                  border: "2px solid #6f5a38",
                  background: "#fff6e8",
                  fontWeight: 700,
                  cursor: ownValidation.problems.length !== 0 || !ownValidation.hash ? "not-allowed" : "pointer",
                  opacity: ownValidation.problems.length !== 0 || !ownValidation.hash ? 0.55 : 1,
                  height: "34px",
                }}
                title="Copy hash to clipboard"
              >
                {hashCopyStatus === "copied" ? "Copied" : hashCopyStatus === "failed" ? "Copy failed" : "Copy"}
              </button>
            </div>
          </div>
          <div
            style={{
              fontFamily: '"JetBrains Mono", monospace',
              fontWeight: 800,
              fontSize: "26px",
              letterSpacing: "2px",
              background: "#fff9ef",
              border: "1px solid #bda98b",
              borderRadius: "12px",
              padding: "12px 14px",
              color: "#2a2218",
              userSelect: "text",
              WebkitUserSelect: "text",
              wordBreak: "break-all",
            }}
          >
            {ownValidation.problems.length === 0 && ownValidation.hash ? ownValidation.hash : "-"}
          </div>
          <div style={{ fontSize: "12px", color: "#5a4630" }}>
            You can click and drag to select the hash, or use the Copy button.
          </div>
          {librarySaveMessage && <div style={{ fontSize: "12px", color: "#2f6b3f", fontWeight: 700 }}>{librarySaveMessage}</div>}
        </section>

        <section style={{ borderRadius: "14px", border: "2px solid #3c3226", background: "rgba(255, 250, 242, 0.84)", padding: "12px", display: "grid", gap: "8px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "#7a6543" }}>Stats</div>
          <div style={{ display: "grid", gap: "6px", fontSize: "13px", color: "#5a4630" }}>
            <div style={{ display: "grid", gap: "2px" }}>
              <div style={{ fontWeight: 700 }}>Used heights</div>
              <div>#1: {ownValidation.counts.ones}</div>
              <div>#2: {ownValidation.counts.twos}</div>
              <div>#3: {ownValidation.counts.threes}</div>
            </div>
            <div>
              Army size:{" "}
              <span style={{ fontFamily: '"JetBrains Mono", monospace', fontWeight: 700 }}>
                {ownValidation.problems.length === 0 && ownValidation.armySize.ok ? ownValidation.armySize.armySize : "-"}
              </span>
            </div>
            <div>Tribun height: {ownValidation.tribunHeight > 0 ? ownValidation.tribunHeight : "-"}</div>
            <div style={{ display: "grid", gap: "2px" }}>
              <div style={{ fontWeight: 700 }}>Move generation</div>
              <div>Move: {moveStats ? moveStats.move : "-"}</div>
              <div>Split: {moveStats ? moveStats.split : "-"}</div>
              <div>Combination: {moveStats ? moveStats.combination : "-"}</div>
              <div>Total: {moveStats ? moveStats.total : "-"}</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}


