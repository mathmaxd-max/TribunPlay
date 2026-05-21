import { getBaseColor, getHexagonColor, type HexagonBaseColor } from "../../hexagonColors";

/** Hex board side length 4 → tiles with axial distance ≤ 3 from center (37 tiles). */
export const MINI_GRID_MAX_DISTANCE = 3;

export type MiniGridTile = {
  x: number;
  y: number;
  cx: number;
  cy: number;
  fill: string;
};

export type MiniGridBounds = {
  width: number;
  height: number;
  minX: number;
  minY: number;
};

/** Matches TutorialBoard buildBoardMetrics innerHexSize so diagram tiles match the practice board. */
const INNER_HEX_SIZE = 20;
const BORDER_WIDTH = 2;
const SPACING_MULTIPLIER = 0.98;
const OUTER_HEX_SIZE = INNER_HEX_SIZE + BORDER_WIDTH;
const CENTER_SIZE = OUTER_HEX_SIZE * SPACING_MULTIPLIER;
const D = (Math.sqrt(3) / 2) * CENTER_SIZE;
export const MINI_HEX_RADIUS = OUTER_HEX_SIZE;

export function hexDistance(ax: number, ay: number, bx = 0, by = 0): number {
  const az = ay - ax;
  const bz = by - bx;
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by), Math.abs(az - bz));
}

function coordToPixel(x: number, y: number): { cx: number; cy: number } {
  const z = y - x;
  return {
    cx: ((3 * z) / 2) * CENTER_SIZE,
    cy: (x + y) * D,
  };
}

function buildMiniGrid(): { tiles: MiniGridTile[]; bounds: MiniGridBounds } {
  const raw: Array<{ x: number; y: number; cx: number; cy: number }> = [];

  for (let x = -MINI_GRID_MAX_DISTANCE; x <= MINI_GRID_MAX_DISTANCE; x += 1) {
    for (let y = -MINI_GRID_MAX_DISTANCE; y <= MINI_GRID_MAX_DISTANCE; y += 1) {
      if (hexDistance(x, y) > MINI_GRID_MAX_DISTANCE) continue;
      const { cx, cy } = coordToPixel(x, y);
      raw.push({ x, y, cx, cy });
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const outerHexWidth = 2 * MINI_HEX_RADIUS;
  const outerHexHeight = Math.sqrt(3) * MINI_HEX_RADIUS;

  raw.forEach(({ cx, cy }) => {
    minX = Math.min(minX, cx - outerHexWidth / 2);
    maxX = Math.max(maxX, cx + outerHexWidth / 2);
    minY = Math.min(minY, cy - outerHexHeight / 2);
    maxY = Math.max(maxY, cy + outerHexHeight / 2);
  });

  const pad = 4;
  const bounds: MiniGridBounds = {
    minX: minX - pad,
    minY: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad * 2,
  };

  const tiles: MiniGridTile[] = raw.map(({ x, y, cx, cy }) => {
    const base: HexagonBaseColor = getBaseColor(x, y);
    return {
      x,
      y,
      cx: cx - bounds.minX,
      cy: cy - bounds.minY,
      fill: getHexagonColor(base, "default"),
    };
  });

  return { tiles, bounds };
}

const built = buildMiniGrid();

export const MINI_GRID_TILES = built.tiles;
export const MINI_GRID_BOUNDS = built.bounds;

const tileCenterByKey = new Map<string, { cx: number; cy: number }>(
  MINI_GRID_TILES.map((t) => [`${t.x},${t.y}`, { cx: t.cx, cy: t.cy }]),
);

/** Pixel center for a board offset from (0, 0), or null if off the mini grid. */
export function getMiniTileCenter(dx: number, dy: number): { cx: number; cy: number } | null {
  return tileCenterByKey.get(`${dx},${dy}`) ?? null;
}

/** Center of the origin tile in diagram coordinates. */
export function getMiniOriginCenter(): { cx: number; cy: number } {
  return getMiniTileCenter(0, 0) ?? { cx: MINI_GRID_BOUNDS.width / 2, cy: MINI_GRID_BOUNDS.height / 2 };
}

/** Flat-top hex (matches game clip-path: 100% 50%, 75% 0%, 25% 0%, …). */
export function hexagonPoints(cx: number, cy: number, radius: number): string {
  const halfW = radius;
  const halfH = (Math.sqrt(3) / 2) * radius;
  const pts: Array<[number, number]> = [
    [cx + halfW, cy],
    [cx + halfW / 2, cy - halfH],
    [cx - halfW / 2, cy - halfH],
    [cx - halfW, cy],
    [cx - halfW / 2, cy + halfH],
    [cx + halfW / 2, cy + halfH],
  ];
  return pts.map(([px, py]) => `${px},${py}`).join(" ");
}
