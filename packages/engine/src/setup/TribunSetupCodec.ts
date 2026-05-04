/* TribunSetupCodec.ts
 *
 * Base-37 setup codec for (tribTile + 3 fixed bitmaps), with triangle-rule validation
 * and mnemonic defaults via a tiny swap-permutation.
 *
 * Alphabet: 0-9 A-Z #
 * Code length: 16 digits (optionally grouped as 4×4 for display).
 *
 * This replaces the legacy rank/unrank-based base36(12) codec.
 */

export type UnitKind = "_" | "1" | "2" | "3" | "1T" | "2T" | "3T";
export type Orientation = "UP" | "DOWN";

export interface SetupMasks {
  tribTile: number; // 0..31
  mask3: bigint; // 15 bits (tiles 0..14)
  mask2: bigint; // 26 bits (tiles 0..25)
  mask1: bigint; // 37 bits (tiles 0..36)
}

export interface SetupDecoded extends SetupMasks {
  tribunHeight: 1 | 2 | 3;
  freeN: number;
  costArmy: number;
  armySize: number;
}

export type EncodeError =
  | { kind: "OUT_OF_RANGE_TRIB_TILE"; tribTile: number }
  | { kind: "MASK_OUT_OF_RANGE"; which: "mask1" | "mask2" | "mask3" }
  | { kind: "OVERLAP"; tile: number }
  | { kind: "TRIB_TILE_NOT_OCCUPIED"; tribTile: number }
  | { kind: "TRIB_TILE_MULTIPLE_HEIGHTS"; tribTile: number }
  | { kind: "PAYMENT_2_FOR_3_FAIL"; n2: number; n3: number }
  | { kind: "PAYMENT_1_FOR_2_FAIL"; n1: number; n2: number }
  | {
      kind: "TRIANGLE_EQUAL_UNITS";
      center: number;
      orientation: Orientation;
      vertices: [number, number, number];
      unit: UnitKind;
    };

export interface EncodeResult {
  code: string; // 16 chars, or "----------------"
  ok: boolean;
  error?: EncodeError;
  characteristics?: { tribunHeight: 1 | 2 | 3; armySize: number };
}

export interface DecodeResult {
  ok: boolean;
  setup?: SetupDecoded;
  error?: { kind: "INVALID_CODE" | "OUT_OF_RANGE_PAYLOAD" | "DECODED_SETUP_INVALID"; details?: EncodeError };
}

const CODE_LEN = 16;
export const INVALID_SETUP_CODE = "-".repeat(CODE_LEN);

export const SETUP_REGION_RED = 15;
export const SETUP_REGION_ORANGE = 26;
export const SETUP_REGION_YELLOW = 32;
export const SETUP_REGION_LIME = 37;
export const SETUP_TILE_COUNT = SETUP_REGION_LIME;
export const SETUP_ROW_LENGTHS = [1, 2, 3, 4, 5, 6, 5, 6, 5];

const N3 = SETUP_REGION_RED; // 15 tiles: 0..14
const N2 = SETUP_REGION_ORANGE; // 26 tiles: 0..25
const N1 = SETUP_REGION_LIME; // 37 tiles: 0..36
const TRIB_RANGE = SETUP_REGION_YELLOW; // tribTile is 0..31

export const ALPHABET37 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ#";
const DIGIT_MAP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ALPHABET37.length; i++) m[ALPHABET37[i]] = i;
  return m;
})();

const BASE = 37n;
const BASE_POW_16 = BASE ** 16n; // 37^16
const BASE_POW_8 = BASE ** 8n; // Feistel half modulus
const PAYLOAD_BITS = 83n;
const PAYLOAD_MAX = 1n << PAYLOAD_BITS; // 2^83

/* ---------------- Geometry for triangle rule ----------------
 *
 * We need: for each center tile, the two "symmetric triangles":
 *  UP triangle vertices = three alternating neighbors around center
 *  DOWN triangle vertices = the other alternating triple
 *
 * Tile indexing: bottom->top rows, left->right within row.
 * Row lengths sum to 37 and match the color bands:
 *  1+2+3+4+5 = 15 (red)
 *  +6+5 = 26 (orange)
 *  +6 = 32 (yellow)
 *  +5 = 37 (lime)
 */

type Ax = { q: number; r: number };
const { neighbors } = buildHexGeometry();

function buildHexGeometry() {
  const coords: Ax[] = [];
  const idxOf = new Map<string, number>();

  let idx = 0;
  for (let r = 0; r < SETUP_ROW_LENGTHS.length; r++) {
    const len = SETUP_ROW_LENGTHS[r];
    const qStart = -Math.floor(len / 2);
    for (let x = 0; x < len; x++) {
      const q = qStart + x;
      coords[idx] = { q, r };
      idxOf.set(`${q},${r}`, idx);
      idx++;
    }
  }
  if (idx !== N1) throw new Error(`SETUP_ROW_LENGTHS must sum to ${N1}, got ${idx}`);

  // axial neighbor dirs (pointy-top)
  const DIRS: Array<[number, number]> = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
  ];

  const neighbors: number[][] = Array.from({ length: N1 }, () => new Array(6).fill(-1));
  for (let i = 0; i < N1; i++) {
    const { q, r } = coords[i];
    for (let d = 0; d < 6; d++) {
      const [dq, dr] = DIRS[d];
      const j = idxOf.get(`${q + dq},${r + dr}`);
      neighbors[i][d] = j === undefined ? -1 : j;
    }
  }
  return { neighbors };
}

function bandOf(tile: number): 0 | 1 | 2 | 3 {
  if (tile < SETUP_REGION_RED) return 0;
  if (tile < SETUP_REGION_ORANGE) return 1;
  if (tile < SETUP_REGION_YELLOW) return 2;
  return 3;
}

function triangleVertices(center: number, orientation: Orientation): [number, number, number] | null {
  // alternating neighbor triples
  // UP  : dirs [5,1,3]
  // DOWN: dirs [2,0,4]
  const dirs = orientation === "UP" ? [5, 1, 3] : [2, 0, 4];
  const a = neighbors[center][dirs[0]];
  const b = neighbors[center][dirs[1]];
  const c = neighbors[center][dirs[2]];
  if (a < 0 || b < 0 || c < 0) return null;
  return [a, b, c];
}

/* ---------------- Bit utilities ---------------- */

function bitAt(mask: bigint, i: number): 0 | 1 {
  return ((mask >> BigInt(i)) & 1n) === 1n ? 1 : 0;
}

function setBit(mask: bigint, i: number): bigint {
  return mask | (1n << BigInt(i));
}

function popcount(x: bigint): number {
  let v = x;
  let c = 0;
  while (v !== 0n) {
    v &= v - 1n;
    c++;
  }
  return c;
}

function lsbIndex(x: bigint): number {
  // assumes x != 0
  let i = 0;
  let v = x;
  while ((v & 1n) === 0n) {
    v >>= 1n;
    i++;
  }
  return i;
}

/* ---------------- Packing / Unpacking ----------------
 *
 * payload layout (MSB -> LSB):
 *  [ tribTile:5 ][ mask3:15 ][ mask2:26 ][ mask1:37 ]
 */

function packPayload(s: SetupMasks): bigint {
  let v = BigInt(s.tribTile) & ((1n << 5n) - 1n);
  v = (v << 15n) | (s.mask3 & ((1n << 15n) - 1n));
  v = (v << 26n) | (s.mask2 & ((1n << 26n) - 1n));
  v = (v << 37n) | (s.mask1 & ((1n << 37n) - 1n));
  return v;
}

function unpackPayload(v: bigint): SetupMasks {
  let x = v;

  const mask1 = x & ((1n << 37n) - 1n);
  x >>= 37n;
  const mask2 = x & ((1n << 26n) - 1n);
  x >>= 26n;
  const mask3 = x & ((1n << 15n) - 1n);
  x >>= 15n;
  const tribTile = Number(x & ((1n << 5n) - 1n));

  return { tribTile, mask3, mask2, mask1 };
}

/* ---------------- Validation + characteristics ---------------- */

function unitAt(setup: SetupMasks, tile: number): UnitKind {
  if (tile < 0 || tile >= N1) return "_";
  const is3 = tile < N3 ? bitAt(setup.mask3, tile) : 0;
  const is2 = tile < N2 ? bitAt(setup.mask2, tile) : 0;
  const is1 = bitAt(setup.mask1, tile);
  const isTrib = tile === setup.tribTile;

  const sum = is1 + is2 + is3;
  if (sum === 0) return "_";
  if (sum > 1) return "_"; // overlap will be reported elsewhere

  const base: UnitKind = is3 ? "3" : is2 ? "2" : "1";
  if (!isTrib) return base;
  return base === "1" ? "1T" : base === "2" ? "2T" : "3T";
}

function validateSetup(setup: SetupMasks): { ok: true; decoded: SetupDecoded } | { ok: false; error: EncodeError } {
  // trib tile range (0..31)
  if (setup.tribTile < 0 || setup.tribTile >= TRIB_RANGE) {
    return { ok: false, error: { kind: "OUT_OF_RANGE_TRIB_TILE", tribTile: setup.tribTile } };
  }

  // mask range (defensive)
  if (setup.mask3 < 0n || setup.mask3 >= (1n << 15n)) return { ok: false, error: { kind: "MASK_OUT_OF_RANGE", which: "mask3" } };
  if (setup.mask2 < 0n || setup.mask2 >= (1n << 26n)) return { ok: false, error: { kind: "MASK_OUT_OF_RANGE", which: "mask2" } };
  if (setup.mask1 < 0n || setup.mask1 >= (1n << 37n)) return { ok: false, error: { kind: "MASK_OUT_OF_RANGE", which: "mask1" } };

  // overlaps between masks (aligned by tile index)
  const overlap12 = setup.mask1 & setup.mask2; // tiles 0..25
  const overlap13 = setup.mask1 & setup.mask3; // tiles 0..14
  const overlap23 = setup.mask2 & setup.mask3; // tiles 0..14
  const overlap = overlap12 | overlap13 | overlap23;
  if (overlap !== 0n) {
    return { ok: false, error: { kind: "OVERLAP", tile: lsbIndex(overlap) } };
  }

  // trib tile must be occupied by exactly one height
  const t = setup.tribTile;
  const t1 = bitAt(setup.mask1, t);
  const t2 = t < N2 ? bitAt(setup.mask2, t) : 0;
  const t3 = t < N3 ? bitAt(setup.mask3, t) : 0;
  const sum = t1 + t2 + t3;
  if (sum === 0) return { ok: false, error: { kind: "TRIB_TILE_NOT_OCCUPIED", tribTile: t } };
  if (sum > 1) return { ok: false, error: { kind: "TRIB_TILE_MULTIPLE_HEIGHTS", tribTile: t } };

  const tribunHeight: 1 | 2 | 3 = t3 ? 3 : t2 ? 2 : 1;

  // triangle rule: within same band, 3 equal non-empty units around a center
  for (let c = 0; c < N1; c++) {
    for (const orientation of ["UP", "DOWN"] as const) {
      const verts = triangleVertices(c, orientation);
      if (!verts) continue;

      const b0 = bandOf(verts[0]);
      if (bandOf(verts[1]) !== b0 || bandOf(verts[2]) !== b0) continue;

      const u0 = unitAt(setup, verts[0]);
      if (u0 === "_") continue;
      const u1 = unitAt(setup, verts[1]);
      const u2 = unitAt(setup, verts[2]);
      if (u0 === u1 && u1 === u2) {
        return { ok: false, error: { kind: "TRIANGLE_EQUAL_UNITS", center: c, orientation, vertices: verts, unit: u0 } };
      }
    }
  }

  // payment rules
  //
  // Counts used for payment MUST exclude the tribun tile itself. For tribunHeight===1,
  // the remaining “free budget” can be interpreted either as (a) one free 2-high or (b) two free 1-high.
  const total1 = popcount(setup.mask1);
  const total2 = popcount(setup.mask2);
  const total3 = popcount(setup.mask3);

  const n1 = total1 - (tribunHeight === 1 ? 1 : 0);
  const n2 = total2 - (tribunHeight === 2 ? 1 : 0);
  const n3 = total3 - (tribunHeight === 3 ? 1 : 0);

  // 3-payment: cover 3-high units with 2-high units.
  // For 1T there are two variants:
  // - Variant A: one free 2-high unit -> effectively (n2-1) >= 2*n3
  // - Variant B: two free 1-high units -> n2 >= 2*n3
  if (tribunHeight === 1) {
    const okVariantA = n2 - 1 >= 2 * n3;
    const okVariantB = n2 >= 2 * n3;
    if (!okVariantA && !okVariantB) return { ok: false, error: { kind: "PAYMENT_2_FOR_3_FAIL", n2, n3 } };
  } else {
    if (n2 < 2 * n3) return { ok: false, error: { kind: "PAYMENT_2_FOR_3_FAIL", n2, n3 } };
  }

  // 2-payment: cover 2-high units with 1-high units (accounting for the free allocation).
  if (tribunHeight === 1) {
    // Variant A: one free 2-high -> (#1-1) >= (#2-1) => #1 >= #2-1
    const okFree2 = n1 >= n2 - 1;
    // Variant B: two free 1-high -> (#1-3) >= #2 => #1 >= #2+2
    const okFree11 = n1 >= n2 + 2;
    if (!okFree2 && !okFree11) return { ok: false, error: { kind: "PAYMENT_1_FOR_2_FAIL", n1, n2 } };
  } else if (tribunHeight === 2) {
    // 2T: one free 1-high -> (#1-1) >= #2 => #1 >= #2+1
    if (n1 < n2 + 1) return { ok: false, error: { kind: "PAYMENT_1_FOR_2_FAIL", n1, n2 } };
  } else {
    if (n1 < n2) return { ok: false, error: { kind: "PAYMENT_1_FOR_2_FAIL", n1, n2 } };
  }

  const freeN = 3 - tribunHeight;
  const costArmy = 1 * n1 + 2 * n2 + 3 * n3;
  const armySize = Math.max(0, costArmy - freeN);

  return { ok: true, decoded: { ...setup, tribunHeight, freeN, costArmy, armySize } };
}

/* ---------------- Base-37 conversion helpers ---------------- */

function normalizeCodeInput(code: string): string | null {
  if (typeof code !== "string") return null;
  const cleaned = code.replace(/\s+/g, "").toUpperCase();
  if (cleaned.length !== CODE_LEN) return null;
  for (const ch of cleaned) if (DIGIT_MAP[ch] === undefined) return null;
  return cleaned;
}

function digitsToString(digs: number[]): string {
  return digs.map((d) => ALPHABET37[d]).join("");
}

function stringToDigits(code16: string): number[] {
  const digs: number[] = [];
  for (const ch of code16) digs.push(DIGIT_MAP[ch]);
  return digs;
}

function toBase37Fixed(v: bigint, len: number): number[] {
  let x = v;
  const out = new Array<number>(len).fill(0);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(x % BASE);
    x /= BASE;
  }
  return out;
}

function fromBase37Digits(digs: number[]): bigint {
  let v = 0n;
  for (const d of digs) v = v * BASE + BigInt(d);
  return v;
}

/* ---------------- Feistel scramble (permutation on 37^16) ---------------- */

const ROUNDS = 8;
const ROUND_KEYS = [
  0x9E3779B97F4A7C15n,
  0xBF58476D1CE4E5B9n,
  0x94D049BB133111EBn,
  0xD6E8FEB86659FD93n,
  0xA5A3562F9C5E5E87n,
  0xC2B2AE3D27D4EB4Fn,
  0x165667B19E3779F9n,
  0x85EBCA77C2B2AE63n,
];

const MASK64 = (1n << 64n) - 1n;

function feistelF(r: bigint, round: number): bigint {
  // Mix into 64-bit then mod BASE_POW_8.
  let x = (r ^ (r >> 17n) ^ (r << 31n)) & MASK64;
  x = (x * ROUND_KEYS[round]) & MASK64;
  x ^= x >> 29n;
  x = (x * 0xBF58476D1CE4E5B9n) & MASK64;
  x ^= x >> 32n;
  return x % BASE_POW_8;
}

function feistelEnc(v: bigint): bigint {
  let L = v / BASE_POW_8;
  let R = v % BASE_POW_8;
  for (let i = 0; i < ROUNDS; i++) {
    const newL = R;
    const newR = (L + feistelF(R, i)) % BASE_POW_8;
    L = newL;
    R = newR;
  }
  return L * BASE_POW_8 + R;
}

function feistelDec(v: bigint): bigint {
  let L = v / BASE_POW_8;
  let R = v % BASE_POW_8;
  for (let i = ROUNDS - 1; i >= 0; i--) {
    const oldR = L;
    let oldL = (R - feistelF(oldR, i)) % BASE_POW_8;
    if (oldL < 0n) oldL += BASE_POW_8;
    R = oldR;
    L = oldL;
  }
  return L * BASE_POW_8 + R;
}

/* ---------------- Defaults via swap-permutation ----------------
 *
 * To make a setup map to a memorable code, we perform swaps:
 *   swap(raw_value_for_setup, desired_code_value)
 *
 * This stays invertible and scales with the number of defaults (tiny).
 */

type DefaultEntry = { code: string; setup: SetupMasks };

const DEFAULT_SETUP: SetupMasks = (() => {
  // Equivalent to the previous DEFAULT_POSITION (legacy codec), but expressed as bitmaps.
  // Tribun is on tile 0 at height 1, encoded by setting tile 0 in mask1.
  const tribTile = 0;

  let mask3 = 0n;
  for (const t of [4, 7, 8]) mask3 = setBit(mask3, t);

  let mask2 = 0n;
  for (const t of [3, 5, 6, 9, 11, 12, 13, 22, 24]) mask2 = setBit(mask2, t);

  let mask1 = 0n;
  for (const t of [0, 21, 25, 27, 28, 29, 30, 33, 35]) mask1 = setBit(mask1, t);

  return { tribTile, mask3, mask2, mask1 };
})();

const DEFAULT_CODE = "TRADITIONALSETUP"; // 16 chars base37

const DEFAULTS: DefaultEntry[] = [{ code: DEFAULT_CODE, setup: DEFAULT_SETUP }];

type SwapPair = { a: bigint; b: bigint };
const SWAPS: SwapPair[] = buildSwaps(DEFAULTS);

function buildSwaps(defaults: DefaultEntry[]): SwapPair[] {
  const pairs: SwapPair[] = [];
  const used = new Set<string>();

  for (const d of defaults) {
    const norm = normalizeCodeInput(d.code);
    if (!norm) throw new Error(`Default code invalid: ${d.code}`);

    const desiredVal = fromBase37Digits(stringToDigits(norm));
    if (desiredVal < 0n || desiredVal >= BASE_POW_16) throw new Error(`Default code out of range: ${d.code}`);

    const payload = packPayload(d.setup);
    if (payload < 0n || payload >= BASE_POW_16) throw new Error("Default payload does not fit into 37^16.");
    const rawVal = feistelEnc(payload);

    if (rawVal === desiredVal) continue;

    const ka = rawVal.toString();
    const kb = desiredVal.toString();
    if (used.has(ka) || used.has(kb)) throw new Error("Swap collision between defaults; choose different mnemonic codes.");
    used.add(ka);
    used.add(kb);
    pairs.push({ a: rawVal, b: desiredVal });
  }

  return pairs;
}

function applySwaps(v: bigint): bigint {
  for (const { a, b } of SWAPS) {
    if (v === a) return b;
    if (v === b) return a;
  }
  return v;
}

/* ---------------- Public encode/decode ---------------- */

/**
 * Legacy name kept for UI compatibility: a "position" is now a bitmap setup.
 */
export type Position = SetupMasks;

export function encodePosition(setup: SetupMasks): string {
  return encodePositionDetailed(setup).code;
}

export function encodePositionDetailed(setup: SetupMasks): EncodeResult {
  const vr = validateSetup(setup);
  if (!vr.ok) return { ok: false, code: INVALID_SETUP_CODE, error: vr.error };

  const payload = packPayload(setup);
  if (payload < 0n || payload >= BASE_POW_16) return { ok: false, code: INVALID_SETUP_CODE, error: { kind: "MASK_OUT_OF_RANGE", which: "mask1" } };

  let codeVal = feistelEnc(payload);
  codeVal = applySwaps(codeVal);

  const code = digitsToString(toBase37Fixed(codeVal, CODE_LEN));
  return { ok: true, code, characteristics: { tribunHeight: vr.decoded.tribunHeight, armySize: vr.decoded.armySize } };
}

export function decodeCode(code: string): SetupDecoded | null {
  const dr = decodeCodeDetailed(code);
  return dr.ok ? dr.setup! : null;
}

export function decodeCodeDetailed(code: string): DecodeResult {
  const norm = normalizeCodeInput(code);
  if (!norm) return { ok: false, error: { kind: "INVALID_CODE" } };

  let codeVal = fromBase37Digits(stringToDigits(norm));
  if (codeVal < 0n || codeVal >= BASE_POW_16) return { ok: false, error: { kind: "INVALID_CODE" } };

  codeVal = applySwaps(codeVal);

  const payload = feistelDec(codeVal);
  if (payload < 0n || payload >= PAYLOAD_MAX) return { ok: false, error: { kind: "OUT_OF_RANGE_PAYLOAD" } };

  const setup = unpackPayload(payload);
  const vr = validateSetup(setup);
  if (!vr.ok) return { ok: false, error: { kind: "DECODED_SETUP_INVALID", details: vr.error } };

  return { ok: true, setup: vr.decoded };
}

export function validatePositionDetailed(setup: SetupMasks): { ok: true; position: SetupMasks } | { ok: false; error: EncodeError } {
  const vr = validateSetup(setup);
  return vr.ok ? { ok: true, position: setup } : { ok: false, error: vr.error };
}

/**
 * Parses a 37-tile semicolon string into masks.
 *
 * Accepted cell tokens:
 * - `_` or empty: empty tile
 * - `1`, `2`, `3`: non-trib units
 * - `1T`, `2T`, `3T`: tribun tile at given height (exactly one must exist)
 */
export function parseBoardString(board: string): SetupMasks | null {
  const parts = board.split(";").map((s) => s.trim());
  if (parts.length !== SETUP_REGION_LIME) return null;

  let tribTile = -1;
  let mask3 = 0n;
  let mask2 = 0n;
  let mask1 = 0n;

  for (let i = 0; i < parts.length; i++) {
    const v = parts[i];
    if (v === "_" || v === "") continue;

    const isTrib = v.endsWith("T");
    const base = isTrib ? v.slice(0, -1) : v;
    if (base !== "1" && base !== "2" && base !== "3") return null;

    if (isTrib) {
      if (tribTile !== -1) return null;
      tribTile = i;
    }

    if (base === "3") mask3 = setBit(mask3, i);
    else if (base === "2") mask2 = setBit(mask2, i);
    else mask1 = setBit(mask1, i);
  }

  if (tribTile === -1) return null;
  const out: SetupMasks = { tribTile, mask3, mask2, mask1 };
  const vr = validateSetup(out);
  return vr.ok ? out : null;
}

/* ---------------- Convenience for display ---------------- */

export function group4(code16: string): string {
  const norm = normalizeCodeInput(code16);
  if (!norm) return code16;
  return `${norm.slice(0, 4)} ${norm.slice(4, 8)} ${norm.slice(8, 12)} ${norm.slice(12, 16)}`;
}

/* ---------------- Example sanity check ---------------- */

export function selfTestDefault(): { ok: boolean; code: string; grouped: string } {
  const code = encodePosition(DEFAULT_SETUP);
  return { ok: code === DEFAULT_CODE, code, grouped: group4(code) };
}

// (legacy code removed)
