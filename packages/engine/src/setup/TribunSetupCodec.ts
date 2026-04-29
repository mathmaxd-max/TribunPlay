export type Scenario = 0 | 1 | 2 | 3;

export type UnitKind = "_" | "1" | "1T" | "2" | "2T" | "3" | "3T";

export interface Position {
  scenario: Scenario;
  tribTile: number;
  threes: number[];
  twos: number[];
  ones: number[];
}

export type EncodeError =
  | { kind: "NO_TRIBUN" }
  | { kind: "MULTIPLE_TRIBUNS" }
  | { kind: "OUT_OF_RANGE_TILE"; tile: number }
  | { kind: "OVERLAP"; tile: number }
  | { kind: "AREA_VIOLATION"; unit: UnitKind; tile: number }
  | { kind: "PAYMENT_2_FOR_3_FAIL"; n2: number; n3: number }
  | { kind: "PAYMENT_1_FOR_2_FAIL"; n1: number; n2: number; scenario: Scenario }
  | { kind: "N_BUDGET_FAIL"; usedN: number; expectedN: number }
  | {
      kind: "TRIANGLE_EQUAL_UNITS";
      center: number;
      orientation: "UP" | "DOWN";
      vertices: [number, number, number];
      unit: UnitKind;
    }
  | { kind: "UNKNOWN_CASE_COUNTS"; n1: number; n2: number; n3: number; scenario: Scenario };

export interface EncodeResult {
  code: string;
  ok: boolean;
  error?: EncodeError;
}

export interface DecodeResult {
  ok: boolean;
  position?: Position;
  error?: {
    kind: "INVALID_CODE" | "OUT_OF_RANGE_RANK" | "DECODED_POSITION_INVALID";
    details?: EncodeError;
  };
}

const CODE_LEN = 12;
export const INVALID_SETUP_CODE = "------------";
const TOTAL_N = 33;

export const SETUP_REGION_RED = 15;
export const SETUP_REGION_ORANGE = 26;
export const SETUP_REGION_YELLOW = 32;
export const SETUP_REGION_LIME = 37;
export const SETUP_TILE_COUNT = SETUP_REGION_LIME;
export const SETUP_ROW_LENGTHS = [1, 2, 3, 4, 5, 6, 5, 6, 5];

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGIT_MAP: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < 36; i++) m[DIGITS[i]] = i;
  return m;
})();

const MOD_M: bigint = 36n ** BigInt(CODE_LEN);

type ScenarioDef = {
  scenario: Scenario;
  tribKind: UnitKind;
  tribHeight: 1 | 2 | 3;
  free1: number;
  free2: number;
  relaxOneVsTwoBy: number;
  tribAreaMaxExclusive: number;
};

const SCENARIOS: Record<Scenario, ScenarioDef> = {
  0: { scenario: 0, tribKind: "3T", tribHeight: 3, free1: 0, free2: 0, relaxOneVsTwoBy: 0, tribAreaMaxExclusive: SETUP_REGION_RED },
  1: { scenario: 1, tribKind: "2T", tribHeight: 2, free1: 1, free2: 0, relaxOneVsTwoBy: 0, tribAreaMaxExclusive: SETUP_REGION_ORANGE },
  2: { scenario: 2, tribKind: "1T", tribHeight: 1, free1: 0, free2: 1, relaxOneVsTwoBy: 1, tribAreaMaxExclusive: SETUP_REGION_YELLOW },
  3: { scenario: 3, tribKind: "1T", tribHeight: 1, free1: 2, free2: 0, relaxOneVsTwoBy: 0, tribAreaMaxExclusive: SETUP_REGION_YELLOW },
};

export function getScenarioDefinition(scenario: Scenario) {
  return SCENARIOS[scenario];
}

export function encodePosition(pos: Position): string {
  return encodePositionDetailed(pos).code;
}

export function encodePositionDetailed(pos: Position): EncodeResult {
  const vr = validatePosition(pos);
  if (!vr.ok) return { code: INVALID_SETUP_CODE, ok: false, error: vr.error };

  const rank = rankPosition(vr.position);
  if (rank === null) {
    return {
      code: INVALID_SETUP_CODE,
      ok: false,
      error: { kind: "UNKNOWN_CASE_COUNTS", ...countsOf(vr.position) },
    };
  }

  const rankDigits = bigIntToBase36Digits(rank, CODE_LEN);
  const scrDigits = feistelScramble(rankDigits);
  const scrVal = base36DigitsToBigInt(scrDigits);
  const outVal = modBig(scrVal + DEFAULT_OFFSET, MOD_M);
  const outDigits = bigIntToBase36Digits(outVal, CODE_LEN);
  return { code: digitsToBase36String(outDigits), ok: true };
}

export function decodeCode(code: string): Position | null {
  const dr = decodeCodeDetailed(code);
  return dr.ok ? dr.position! : null;
}

export function decodeCodeDetailed(code: string): DecodeResult {
  const digs = base36StringToDigits(code);
  if (!digs) return { ok: false, error: { kind: "INVALID_CODE" } };

  const inVal = base36DigitsToBigInt(digs);
  const unOffsetVal = modBig(inVal - DEFAULT_OFFSET, MOD_M);
  const unOffsetDigits = bigIntToBase36Digits(unOffsetVal, CODE_LEN);
  const rankDigits = feistelUnscramble(unOffsetDigits);
  const rank = base36DigitsToBigInt(rankDigits);

  if (rank < 0n || rank >= TOTAL_RANK_SPACE) return { ok: false, error: { kind: "OUT_OF_RANGE_RANK" } };

  const pos = unrankPosition(rank);
  if (!pos) return { ok: false, error: { kind: "DECODED_POSITION_INVALID" } };

  const vr = validatePosition(pos);
  if (!vr.ok) return { ok: false, error: { kind: "DECODED_POSITION_INVALID", details: vr.error } };

  return { ok: true, position: vr.position };
}

export function validatePositionDetailed(pos: Position): { ok: true; position: Position } | { ok: false; error: EncodeError } {
  return validatePosition(pos);
}

export function parseBoardString(board: string, scenario: Scenario): Position | null {
  const parts = board.split(";").map((s) => s.trim());
  if (parts.length !== SETUP_REGION_LIME) return null;

  let tribTile = -1;
  const threes: number[] = [];
  const twos: number[] = [];
  const ones: number[] = [];

  for (let i = 0; i < parts.length; i++) {
    const v = parts[i];
    if (v === "_" || v === "") continue;
    if (v.endsWith("T")) {
      if (tribTile !== -1) return null;
      tribTile = i;
      continue;
    }
    if (v === "3") threes.push(i);
    else if (v === "2") twos.push(i);
    else if (v === "1") ones.push(i);
    else return null;
  }

  if (tribTile === -1) return null;
  return normalize({ scenario, tribTile, threes, twos, ones });
}

function bandOf(tile: number): 0 | 1 | 2 | 3 {
  if (tile < SETUP_REGION_RED) return 0;
  if (tile < SETUP_REGION_ORANGE) return 1;
  if (tile < SETUP_REGION_YELLOW) return 2;
  return 3;
}

function validatePosition(pos: Position): { ok: true; position: Position } | { ok: false; error: EncodeError } {
  const p = normalize(pos);
  if (!p) return { ok: false, error: { kind: "OUT_OF_RANGE_TILE", tile: -1 } };
  const def = SCENARIOS[p.scenario];

  if (p.tribTile < 0 || p.tribTile >= SETUP_REGION_LIME) return { ok: false, error: { kind: "OUT_OF_RANGE_TILE", tile: p.tribTile } };
  if (p.tribTile >= def.tribAreaMaxExclusive) return { ok: false, error: { kind: "AREA_VIOLATION", unit: def.tribKind, tile: p.tribTile } };
  for (const t of p.threes) if (t >= SETUP_REGION_RED) return { ok: false, error: { kind: "AREA_VIOLATION", unit: "3", tile: t } };
  for (const t of p.twos) if (t >= SETUP_REGION_ORANGE) return { ok: false, error: { kind: "AREA_VIOLATION", unit: "2", tile: t } };
  for (const t of p.ones) if (t >= SETUP_REGION_LIME) return { ok: false, error: { kind: "AREA_VIOLATION", unit: "1", tile: t } };

  const used = new Set<number>();
  for (const t of [p.tribTile, ...p.threes, ...p.twos, ...p.ones]) {
    if (t < 0 || t >= SETUP_REGION_LIME) return { ok: false, error: { kind: "OUT_OF_RANGE_TILE", tile: t } };
    if (used.has(t)) return { ok: false, error: { kind: "OVERLAP", tile: t } };
    used.add(t);
  }

  const n3 = p.threes.length;
  const n2 = p.twos.length;
  const n1 = p.ones.length;
  if (n2 < 2 * n3) return { ok: false, error: { kind: "PAYMENT_2_FOR_3_FAIL", n2, n3 } };
  if (n1 < n2 - def.relaxOneVsTwoBy) return { ok: false, error: { kind: "PAYMENT_1_FOR_2_FAIL", n1, n2, scenario: p.scenario } };

  const usedN = computeUsedN(p);
  if (usedN !== TOTAL_N) return { ok: false, error: { kind: "N_BUDGET_FAIL", usedN, expectedN: TOTAL_N } };

  const tri = findTriangleViolation(p);
  if (tri) return { ok: false, error: tri };

  return { ok: true, position: p };
}

function computeUsedN(p: Position): number {
  const def = SCENARIOS[p.scenario];
  const n3 = p.threes.length;
  const n2 = p.twos.length;
  const n1 = p.ones.length;
  const tribN = def.tribHeight - 1;
  const paid1 = n1 - def.free1;
  const paid2 = n2 - def.free2;
  if (paid1 < 0 || paid2 < 0) return Number.NaN;
  return 3 * n3 + 2 * paid2 + paid1 + tribN;
}

type BoardArr = UnitKind[];
const { neighbors } = buildGeometry();

function buildGeometry() {
  const coords: Array<[number, number]> = [];
  const coordToIndex = new Map<string, number>();
  let idx = 0;
  for (let r = 0; r < SETUP_ROW_LENGTHS.length; r++) {
    const len = SETUP_ROW_LENGTHS[r];
    const qStart = -Math.floor(len / 2);
    for (let x = 0; x < len; x++) {
      const q = qStart + x;
      coords[idx] = [q, r];
      coordToIndex.set(`${q},${r}`, idx);
      idx++;
    }
  }
  const dirs: Array<[number, number]> = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  const neighbors: number[][] = Array.from({ length: SETUP_REGION_LIME }, () => new Array(6).fill(-1));
  for (let i = 0; i < SETUP_REGION_LIME; i++) {
    const [q, r0] = coords[i];
    for (let d = 0; d < 6; d++) {
      const [dq, dr] = dirs[d];
      const j = coordToIndex.get(`${q + dq},${r0 + dr}`);
      neighbors[i][d] = j === undefined ? -1 : j;
    }
  }
  return { neighbors };
}

function findTriangleViolation(p: Position): EncodeError | null {
  const board = buildBoardArray(p);
  const upDirs = [5, 1, 3] as const;
  const downDirs = [2, 0, 4] as const;
  for (let c = 0; c < SETUP_REGION_LIME; c++) {
    const up = triVertices(c, upDirs);
    if (up && sameBand(up) && sameNonEmptyUnit(board, up)) {
      return { kind: "TRIANGLE_EQUAL_UNITS", center: c, orientation: "UP", vertices: up, unit: board[up[0]] };
    }
    const down = triVertices(c, downDirs);
    if (down && sameBand(down) && sameNonEmptyUnit(board, down)) {
      return { kind: "TRIANGLE_EQUAL_UNITS", center: c, orientation: "DOWN", vertices: down, unit: board[down[0]] };
    }
  }
  return null;
}

function triVertices(center: number, dirs: readonly number[]): [number, number, number] | null {
  const a = neighbors[center][dirs[0]];
  const b = neighbors[center][dirs[1]];
  const c = neighbors[center][dirs[2]];
  if (a < 0 || b < 0 || c < 0) return null;
  return [a, b, c];
}

function sameBand([a, b, c]: [number, number, number]): boolean {
  const ba = bandOf(a), bb = bandOf(b), bc = bandOf(c);
  return ba === bb && bb === bc;
}

function sameNonEmptyUnit(board: BoardArr, [a, b, c]: [number, number, number]): boolean {
  const ua = board[a], ub = board[b], uc = board[c];
  return ua !== "_" && ua === ub && ub === uc;
}

function buildBoardArray(p: Position): BoardArr {
  const board: BoardArr = new Array(SETUP_REGION_LIME).fill("_");
  for (const t of p.ones) board[t] = "1";
  for (const t of p.twos) board[t] = "2";
  for (const t of p.threes) board[t] = "3";
  board[p.tribTile] = SCENARIOS[p.scenario].tribKind;
  return board;
}

type Case = { scenario: Scenario; n3: number; n2: number; n1: number; offset: bigint; size: bigint };
let CASES: Case[] = [];
let CASES_BY_SCENARIO: Record<Scenario, Case[]> = { 0: [], 1: [], 2: [], 3: [] };
let TOTAL_RANK_SPACE: bigint = 0n;

function initCases() {
  const all: Case[] = [];
  for (const s of [0, 1, 2, 3] as Scenario[]) {
    const list: Omit<Case, "offset">[] = enumerateCasesForScenario(s);
    list.sort((a, b) => (a.n3 - b.n3) || (a.n2 - b.n2) || (a.n1 - b.n1));
    CASES_BY_SCENARIO[s] = [];
    for (const c of list) CASES_BY_SCENARIO[s].push({ ...c, offset: 0n });
  }
  let off = 0n;
  for (const s of [0, 1, 2, 3] as Scenario[]) {
    for (const c of CASES_BY_SCENARIO[s]) {
      (c as Case).offset = off;
      off += c.size;
      all.push(c);
    }
  }
  CASES = all;
  TOTAL_RANK_SPACE = off;
}

function enumerateCasesForScenario(s: Scenario): Omit<Case, "offset">[] {
  const def = SCENARIOS[s];
  const cBudget = TOTAL_N - (def.tribHeight - 1) + def.free1 + 2 * def.free2;
  const out: Omit<Case, "offset">[] = [];
  for (let n3 = 0; n3 <= SETUP_REGION_RED; n3++) {
    for (let n2 = 0; n2 <= SETUP_REGION_ORANGE; n2++) {
      const n1 = cBudget - 3 * n3 - 2 * n2;
      if (n1 < 0 || n1 > SETUP_REGION_LIME) continue;
      if (n2 < 2 * n3) continue;
      if (n1 < n2 - def.relaxOneVsTwoBy) continue;
      if (n1 < def.free1 || n2 < def.free2) continue;
      const size = caseSize(s, n3, n2, n1);
      if (size > 0n) out.push({ scenario: s, n3, n2, n1, size });
    }
  }
  return out;
}

function caseSize(s: Scenario, n3: number, n2: number, n1: number): bigint {
  const def = SCENARIOS[s];
  let occ = 0;
  let size3: bigint;
  if (def.tribKind === "3T") {
    if (n3 > SETUP_REGION_RED - 1) return 0n;
    size3 = BigInt(SETUP_REGION_RED) * nCk(SETUP_REGION_RED - 1, n3);
    occ = 1 + n3;
  } else {
    if (n3 > SETUP_REGION_RED) return 0n;
    size3 = nCk(SETUP_REGION_RED, n3);
    occ = n3;
  }

  const availOrange = SETUP_REGION_ORANGE - occ;
  if (availOrange < 0) return 0n;
  let size2: bigint;
  if (def.tribKind === "2T") {
    if (n2 > availOrange - 1) return 0n;
    size2 = BigInt(availOrange) * nCk(availOrange - 1, n2);
    occ += 1 + n2;
  } else {
    if (n2 > availOrange) return 0n;
    size2 = nCk(availOrange, n2);
    occ += n2;
  }

  let sizeT: bigint = 1n;
  if (def.tribKind === "1T") {
    const availYellow = SETUP_REGION_YELLOW - occ;
    if (availYellow <= 0) return 0n;
    sizeT = BigInt(availYellow);
    occ += 1;
  }
  const availLime = SETUP_REGION_LIME - occ;
  if (availLime < 0 || n1 > availLime) return 0n;
  const size1 = nCk(availLime, n1);
  return size3 * size2 * sizeT * size1;
}

function countsOf(p: Position) {
  return { n1: p.ones.length, n2: p.twos.length, n3: p.threes.length, scenario: p.scenario as Scenario };
}

function rankPosition(p: Position): bigint | null {
  const n3 = p.threes.length;
  const n2 = p.twos.length;
  const n1 = p.ones.length;
  const c = findCase(p.scenario, n3, n2, n1);
  if (!c) return null;
  const within = rankWithinCase(p, c);
  if (within === null) return null;
  return c.offset + within;
}

function unrankPosition(rank: bigint): Position | null {
  let lo = 0;
  let hi = CASES.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const c = CASES[mid];
    if (rank < c.offset) hi = mid;
    else if (rank >= c.offset + c.size) lo = mid + 1;
    else return unrankWithinCase(c, rank - c.offset);
  }
  return null;
}

function findCase(s: Scenario, n3: number, n2: number, n1: number): Case | null {
  const list = CASES_BY_SCENARIO[s];
  for (const c of list) if (c.n3 === n3 && c.n2 === n2 && c.n1 === n1) return c;
  return null;
}

function rankWithinCase(p: Position, c: Case): bigint | null {
  const def = SCENARIOS[c.scenario];
  const n3 = c.n3, n2 = c.n2, n1 = c.n1;
  const used = new Set<number>();
  let r3: bigint;

  if (def.tribKind === "3T") {
    if (p.tribTile < 0 || p.tribTile >= SETUP_REGION_RED) return null;
    used.add(p.tribTile);
    const avail = tiles(0, SETUP_REGION_RED).filter((t) => t !== p.tribTile);
    if (!isSubset(p.threes, avail)) return null;
    const combRank = rankComb(avail, p.threes);
    const radix = nCk(SETUP_REGION_RED - 1, n3);
    r3 = BigInt(p.tribTile) * radix + combRank;
    for (const t of p.threes) used.add(t);
  } else {
    if (!isSubset(p.threes, tiles(0, SETUP_REGION_RED))) return null;
    r3 = rankComb(tiles(0, SETUP_REGION_RED), p.threes);
    for (const t of p.threes) used.add(t);
  }

  const availOrange = tiles(0, SETUP_REGION_ORANGE).filter((t) => !used.has(t));
  let r2: bigint;
  if (def.tribKind === "2T") {
    if (!availOrange.includes(p.tribTile)) return null;
    const tribIdx = availOrange.indexOf(p.tribTile);
    used.add(p.tribTile);
    const avail2 = availOrange.filter((t) => t !== p.tribTile);
    if (!isSubset(p.twos, avail2)) return null;
    const combRank = rankComb(avail2, p.twos);
    const radix = nCk(avail2.length, n2);
    r2 = BigInt(tribIdx) * radix + combRank;
    for (const t of p.twos) used.add(t);
  } else {
    if (!isSubset(p.twos, availOrange)) return null;
    r2 = rankComb(availOrange, p.twos);
    for (const t of p.twos) used.add(t);
  }

  let rT: bigint = 0n;
  if (def.tribKind === "1T") {
    const availYellow = tiles(0, SETUP_REGION_YELLOW).filter((t) => !used.has(t));
    if (!availYellow.includes(p.tribTile)) return null;
    rT = BigInt(availYellow.indexOf(p.tribTile));
    used.add(p.tribTile);
  } else {
    if ((def.tribKind === "3T" && p.tribTile >= SETUP_REGION_RED) || (def.tribKind === "2T" && p.tribTile >= SETUP_REGION_ORANGE)) return null;
  }

  const availLime = tiles(0, SETUP_REGION_LIME).filter((t) => !used.has(t));
  if (!isSubset(p.ones, availLime)) return null;
  const r1 = rankComb(availLime, p.ones);

  const sz3 = def.tribKind === "3T" ? BigInt(SETUP_REGION_RED) * nCk(SETUP_REGION_RED - 1, n3) : nCk(SETUP_REGION_RED, n3);
  const occ3 = n3 + (def.tribKind === "3T" ? 1 : 0);
  const aOrange = SETUP_REGION_ORANGE - occ3;
  const sz2 = def.tribKind === "2T" ? BigInt(aOrange) * nCk(aOrange - 1, n2) : nCk(aOrange, n2);
  const occ2 = occ3 + n2 + (def.tribKind === "2T" ? 1 : 0);
  const szT = def.tribKind === "1T" ? BigInt(SETUP_REGION_YELLOW - occ2) : 1n;
  const occT = occ2 + (def.tribKind === "1T" ? 1 : 0);
  const sz1 = nCk(SETUP_REGION_LIME - occT, n1);

  let rank = r3;
  rank = rank * sz2 + r2;
  rank = rank * szT + rT;
  rank = rank * sz1 + r1;
  if (rank < 0n || rank >= c.size) return null;
  return rank;
}

function unrankWithinCase(c: Case, within: bigint): Position | null {
  const def = SCENARIOS[c.scenario];
  const n3 = c.n3, n2 = c.n2, n1 = c.n1;
  const sz3 = def.tribKind === "3T" ? BigInt(SETUP_REGION_RED) * nCk(SETUP_REGION_RED - 1, n3) : nCk(SETUP_REGION_RED, n3);
  const occ3 = n3 + (def.tribKind === "3T" ? 1 : 0);
  const aOrange = SETUP_REGION_ORANGE - occ3;
  const sz2 = def.tribKind === "2T" ? BigInt(aOrange) * nCk(aOrange - 1, n2) : nCk(aOrange, n2);
  const occ2 = occ3 + n2 + (def.tribKind === "2T" ? 1 : 0);
  const szT = def.tribKind === "1T" ? BigInt(SETUP_REGION_YELLOW - occ2) : 1n;
  const occT = occ2 + (def.tribKind === "1T" ? 1 : 0);
  const sz1 = nCk(SETUP_REGION_LIME - occT, n1);

  let r = within;
  const r1 = r % sz1; r /= sz1;
  const rT = r % szT; r /= szT;
  const r2 = r % sz2; r /= sz2;
  const r3 = r;

  const used = new Set<number>();
  let tribTile = -1;
  let threes: number[] = [];
  let twos: number[] = [];
  let ones: number[] = [];

  if (def.tribKind === "3T") {
    const radix = nCk(SETUP_REGION_RED - 1, n3);
    const tribIdx = Number(r3 / radix);
    const combRank = r3 % radix;
    tribTile = tribIdx;
    used.add(tribTile);
    const avail = tiles(0, SETUP_REGION_RED).filter((t) => t !== tribTile);
    threes = unrankComb(avail, n3, combRank);
    for (const t of threes) used.add(t);
  } else {
    threes = unrankComb(tiles(0, SETUP_REGION_RED), n3, r3);
    for (const t of threes) used.add(t);
  }

  const availOrange = tiles(0, SETUP_REGION_ORANGE).filter((t) => !used.has(t));
  if (def.tribKind === "2T") {
    const radix = nCk(availOrange.length - 1, n2);
    const tribIdx = Number(r2 / radix);
    const combRank = r2 % radix;
    if (tribIdx < 0 || tribIdx >= availOrange.length) return null;
    tribTile = availOrange[tribIdx];
    used.add(tribTile);
    const avail2 = availOrange.filter((t) => t !== tribTile);
    twos = unrankComb(avail2, n2, combRank);
    for (const t of twos) used.add(t);
  } else {
    twos = unrankComb(availOrange, n2, r2);
    for (const t of twos) used.add(t);
  }

  if (def.tribKind === "1T") {
    const availYellow = tiles(0, SETUP_REGION_YELLOW).filter((t) => !used.has(t));
    const idx = Number(rT);
    if (idx < 0 || idx >= availYellow.length) return null;
    tribTile = availYellow[idx];
    used.add(tribTile);
  }

  const availLime = tiles(0, SETUP_REGION_LIME).filter((t) => !used.has(t));
  ones = unrankComb(availLime, n1, r1);
  return normalize({ scenario: c.scenario, tribTile, threes, twos, ones });
}

const CHOOSE: bigint[][] = precomputeChoose(SETUP_REGION_LIME);
initCases();

function precomputeChoose(nMax: number): bigint[][] {
  const c: bigint[][] = [];
  for (let n = 0; n <= nMax; n++) {
    c[n] = new Array<bigint>(n + 1).fill(0n);
    c[n][0] = 1n;
    c[n][n] = 1n;
    for (let k = 1; k < n; k++) c[n][k] = c[n - 1][k - 1] + c[n - 1][k];
  }
  return c;
}

function nCk(n: number, k: number): bigint {
  if (k < 0 || k > n) return 0n;
  return CHOOSE[n][k];
}

function rankComb(available: number[], chosen: number[]): bigint {
  const avail = available.slice().sort((a, b) => a - b);
  const sel = chosen.slice().sort((a, b) => a - b);
  const n = avail.length;
  const k = sel.length;
  if (k === 0) return 0n;
  const pos: number[] = [];
  let j = 0;
  for (const t of sel) {
    while (j < n && avail[j] !== t) j++;
    if (j >= n) throw new Error("chosen tile not in available set");
    pos.push(j);
  }
  let rank = 0n;
  let prev = -1;
  for (let i = 0; i < k; i++) {
    const ci = pos[i];
    for (let x = prev + 1; x < ci; x++) rank += nCk(n - 1 - x, k - 1 - i);
    prev = ci;
  }
  return rank;
}

function unrankComb(available: number[], k: number, rank: bigint): number[] {
  const avail = available.slice().sort((a, b) => a - b);
  const n = avail.length;
  if (k === 0) return [];
  if (rank < 0n || rank >= nCk(n, k)) throw new Error("rank out of range");
  const positions: number[] = [];
  let r = rank;
  let start = 0;
  for (let i = 0; i < k; i++) {
    for (let x = start; x < n; x++) {
      const c = nCk(n - 1 - x, k - 1 - i);
      if (r >= c) r -= c;
      else {
        positions.push(x);
        start = x + 1;
        break;
      }
    }
  }
  return positions.map((p) => avail[p]);
}

function digitsToBase36String(digs: number[]): string {
  return digs.map((d) => DIGITS[d]).join("");
}

function base36StringToDigits(s: string): number[] | null {
  if (typeof s !== "string" || s.length !== CODE_LEN) return null;
  const up = s.toUpperCase();
  const out: number[] = [];
  for (const ch of up) {
    const v = DIGIT_MAP[ch];
    if (v === undefined) return null;
    out.push(v);
  }
  return out;
}

function bigIntToBase36Digits(x: bigint, len: number): number[] {
  let v = x;
  const out = new Array<number>(len).fill(0);
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(v % 36n);
    v /= 36n;
  }
  return out;
}

function base36DigitsToBigInt(digs: number[]): bigint {
  let v = 0n;
  for (const d of digs) v = v * 36n + BigInt(d);
  return v;
}

function modBig(x: bigint, m: bigint): bigint {
  let r = x % m;
  if (r < 0n) r += m;
  return r;
}

const HALF_LEN = 6;
const MOD_HALF = 36 ** HALF_LEN;
const ROUNDS = 6;
const ROUND_KEYS = [0xA341316C, 0xC8013EA4, 0xAD90777D, 0x7E95761E, 0xD3E00B9D, 0xA9B42C37] as const;

function digitsToHalf(digs: number[], offset: number): number {
  let v = 0;
  for (let i = 0; i < HALF_LEN; i++) v = v * 36 + digs[offset + i];
  return v >>> 0;
}

function halfToDigits(v0: number): number[] {
  let v = v0 >>> 0;
  const out = new Array<number>(HALF_LEN).fill(0);
  for (let i = HALF_LEN - 1; i >= 0; i--) {
    out[i] = v % 36;
    v = Math.floor(v / 36);
  }
  return out;
}

function feistelFn(x0: number, round: number): number {
  let x = x0 >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7FEB352D) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846CA68B) >>> 0;
  x ^= x >>> 16;
  x = (x + ROUND_KEYS[round]) >>> 0;
  return (x % MOD_HALF) >>> 0;
}

function feistelScramble(digs: number[]): number[] {
  let l = digitsToHalf(digs, 0);
  let r = digitsToHalf(digs, HALF_LEN);
  for (let round = 0; round < ROUNDS; round++) {
    const f = feistelFn(r, round);
    const newL = r;
    const newR = (l + f) % MOD_HALF;
    l = newL >>> 0;
    r = newR >>> 0;
  }
  return [...halfToDigits(l), ...halfToDigits(r)];
}

function feistelUnscramble(digs: number[]): number[] {
  let l = digitsToHalf(digs, 0);
  let r = digitsToHalf(digs, HALF_LEN);
  for (let round = ROUNDS - 1; round >= 0; round--) {
    const oldR = l;
    const f = feistelFn(oldR, round);
    let oldL = (r - f) % MOD_HALF;
    if (oldL < 0) oldL += MOD_HALF;
    r = oldR >>> 0;
    l = oldL >>> 0;
  }
  return [...halfToDigits(l), ...halfToDigits(r)];
}

function normalize(p: Position): Position | null {
  if (!p) return null;
  const scenario = p.scenario;
  if (scenario !== 0 && scenario !== 1 && scenario !== 2 && scenario !== 3) return null;
  const tribTile = p.tribTile | 0;
  const threes = dedupSorted(p.threes);
  const twos = dedupSorted(p.twos);
  const ones = dedupSorted(p.ones);
  return { scenario, tribTile, threes, twos, ones };
}

function dedupSorted(xs: number[]): number[] {
  const arr = (xs ?? []).map((v) => v | 0).sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of arr) if (out.length === 0 || out[out.length - 1] !== x) out.push(x);
  return out;
}

function tiles(lo: number, hiExclusive: number): number[] {
  const out: number[] = [];
  for (let i = lo; i < hiExclusive; i++) out.push(i);
  return out;
}

function isSubset(xs: number[], allowed: number[]): boolean {
  const set = new Set(allowed);
  for (const x of xs) if (!set.has(x)) return false;
  return true;
}

const DEFAULT_POSITION: Position = normalize({
  scenario: 2,
  tribTile: 0,
  threes: [4, 7, 8],
  twos: [3, 5, 6, 9, 11, 12, 13, 22, 24],
  ones: [21, 25, 27, 28, 29, 30, 33, 35],
})!;

const DEFAULT_TARGET_CODE = "DEFAULTSETUP";
const DEFAULT_OFFSET: bigint = (() => {
  const vr = validatePosition(DEFAULT_POSITION);
  if (!vr.ok) throw new Error("DEFAULT_POSITION is invalid.");
  const rank = rankPosition(vr.position);
  if (rank === null) throw new Error("DEFAULT_POSITION is not rankable.");
  const scr = base36DigitsToBigInt(feistelScramble(bigIntToBase36Digits(rank, CODE_LEN)));
  const desired = base36DigitsToBigInt(base36StringToDigits(DEFAULT_TARGET_CODE)!);
  return modBig(desired - scr, MOD_M);
})();
