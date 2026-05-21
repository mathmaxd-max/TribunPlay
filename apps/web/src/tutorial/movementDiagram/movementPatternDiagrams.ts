import type { MovementSelector } from "../policy";

export type DiagramColor = "purple" | "red" | "blue" | "black";

export type DiagramOverlay =
  | { kind: "dot"; x: number; y: number; color: DiagramColor }
  | { kind: "line"; from: [number, number]; to: [number, number]; color: DiagramColor }
  | { kind: "arrow"; from: [number, number]; to: [number, number]; color: DiagramColor };

const RING1: Array<[number, number]> = [
  [1, 1],
  [1, 0],
  [0, 1],
  [-1, -1],
  [-1, 0],
  [0, -1],
];

/** Height-2 move tiles (2/2T purple dots, 4/4T arrows, 8/8T red dots). */
const HEIGHT2_MOVE_TILES: Array<[number, number]> = [
  [1, -1],
  [-1, 1],
  [2, 1],
  [1, 2],
  [-2, -1],
  [-1, -2],
];

/** Outer hex corners at distance 3 (3/3T ring only). */
const RING3_CORNERS: Array<[number, number]> = [
  [3, 0],
  [0, 3],
  [3, 3],
  [-3, 0],
  [0, -3],
  [-3, -3],
];

const EIGHT_PURPLE_RING1: Array<[number, number]> = [
  [1, 1],
  [-1, -1],
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

const EIGHT_PURPLE_DIST2: Array<[number, number]> = [
  [2, 2],
  [-2, -2],
  [0, 2],
  [2, 0],
  [0, -2],
  [-2, 0],
];

function dots(coords: Array<[number, number]>, color: DiagramColor): DiagramOverlay[] {
  return coords.map(([x, y]) => ({ kind: "dot", x, y, color }));
}

function arrows(from: [number, number], targets: Array<[number, number]>, color: DiagramColor): DiagramOverlay[] {
  return targets.map((to) => ({ kind: "arrow", from, to, color }));
}

function arrow(
  from: [number, number],
  to: [number, number],
  color: DiagramColor,
): DiagramOverlay {
  return { kind: "arrow", from, to, color };
}

function linesFromOrigin(targets: Array<[number, number]>, color: DiagramColor): DiagramOverlay[] {
  return targets.map((to) => ({ kind: "line", from: ORIGIN, to, color }));
}

/** Ring-3 edge tiles (distance 3, excluding the six corners). */
function ring3EdgeTiles(): Array<[number, number]> {
  const corners = new Set(RING3_CORNERS.map(([x, y]) => `${x},${y}`));
  const out: Array<[number, number]> = [];
  for (let x = -3; x <= 3; x += 1) {
    for (let y = -3; y <= 3; y += 1) {
      const z = y - x;
      const dist = Math.max(Math.abs(x), Math.abs(y), Math.abs(z));
      if (dist !== 3) continue;
      const key = `${x},${y}`;
      if (corners.has(key)) continue;
      out.push([x, y]);
    }
  }
  return out;
}

const ORIGIN: [number, number] = [0, 0];

/** Black dot on the origin tile — appended to every pattern diagram. */
export const CENTER_UNIT_DOT: DiagramOverlay = { kind: "dot", x: 0, y: 0, color: "black" };

const PATTERN_OVERLAYS: Record<MovementSelector, DiagramOverlay[]> = {
  "1": [
    { kind: "dot", x: -1, y: -1, color: "blue" },
    { kind: "dot", x: -1, y: 0, color: "red" },
    { kind: "dot", x: 0, y: -1, color: "red" },
    arrow([3, 0], [0, -3], "black"),
    arrow([0, 3], [-3, 0], "black"),
  ],
  "1T": dots(RING1, "purple"),
  "2/2T": dots(HEIGHT2_MOVE_TILES, "purple"),
  "3/3T": dots(ring3EdgeTiles(), "purple"),
  "4/4T": arrows(ORIGIN, HEIGHT2_MOVE_TILES, "purple"),
  "6/6T": [
    ...arrows(ORIGIN, RING1, "red"),
    ...arrows(ORIGIN, HEIGHT2_MOVE_TILES, "blue"),
  ],
  "8/8T": [
    ...dots(HEIGHT2_MOVE_TILES, "red"),
    ...dots(EIGHT_PURPLE_RING1, "purple"),
    ...dots(EIGHT_PURPLE_DIST2, "purple"),
    ...linesFromOrigin(EIGHT_PURPLE_DIST2, "purple"),
  ],
};

/** Hand-tuned teaching diagrams (black unit perspective for height 1). */
export const MOVEMENT_PATTERN_DIAGRAMS: Record<MovementSelector, DiagramOverlay[]> = Object.fromEntries(
  (Object.entries(PATTERN_OVERLAYS) as Array<[MovementSelector, DiagramOverlay[]]>).map(([key, overlays]) => [
    key,
    [...overlays, CENTER_UNIT_DOT],
  ]),
) as Record<MovementSelector, DiagramOverlay[]>;
