// Core types
import defaultPosition from './default-position.json';

export type Color = 0 | 1;
export type Height = 0 | 1 | 2 | 3 | 4 | 6 | 8;

export interface Unit {
  color: Color;
  tribun: boolean;
  p: Height;
  s: Height;
}

export interface State {
  board: Uint8Array; // 121 bytes (cid 0..120)
  turn: Color;
  ply: number;
  drawOfferBy: Color | null;
  drawOfferBlocked: Color | null;
  status?: 'active' | 'ended';
  winner?: Color | null; // null for tie
}

// Coordinate encoding/decoding
const R = 5;

export function onBoard(x: number, y: number): boolean {
  const z = y - x;
  return Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= R;
}

export function encodeCoord(x: number, y: number): number {
  const cid = (x + 5) * 11 + (y + 5);
  if (cid < 0 || cid > 120) {
    throw new Error(`cid out of range: ${cid} for (${x}, ${y})`);
  }
  if (!onBoard(x, y)) {
    throw new Error(`off board: (${x}, ${y})`);
  }
  return cid;
}

export function decodeCoord(cid: number): { x: number; y: number } {
  if (cid < 0 || cid > 120) {
    throw new Error(`cid out of range: ${cid}`);
  }
  const x = Math.floor(cid / 11) - 5;
  const y = (cid % 11) - 5;
  if (!onBoard(x, y)) {
    throw new Error(`off board: cid ${cid} decodes to (${x}, ${y})`);
  }
  return { x, y };
}

export function isValidTile(cid: number): boolean {
  if (cid < 0 || cid > 120) return false;
  try {
    decodeCoord(cid);
    return true;
  } catch {
    return false;
  }
}

// Unit byte encoding/decoding
const HEIGHT_TO_INDEX: Record<number, number> = {
  0: 0, 1: 1, 2: 2, 3: 3, 4: 4, 6: 5, 8: 6,
};
const INDEX_TO_HEIGHT: Height[] = [0, 1, 2, 3, 4, 6, 8, 0]; // 7 is reserved

export function unitByteToUnit(b: number): Unit | null {
  if (b === 0) return null;
  
  const pIndex = b & 0x7;
  const sIndex = (b >>> 3) & 0x7;
  const color = ((b >>> 6) & 0x1) as Color;
  const tribun = ((b >>> 7) & 0x1) === 1;
  
  const p = INDEX_TO_HEIGHT[pIndex] as Height;
  const s = INDEX_TO_HEIGHT[sIndex] as Height;
  
  if (p === 0 && s === 0) return null;
  
  return { color, tribun, p, s };
}

export function unitToUnitByte(u: Unit | null): number {
  if (u === null) return 0;
  
  const pIndex = HEIGHT_TO_INDEX[u.p] ?? 0;
  const sIndex = HEIGHT_TO_INDEX[u.s] ?? 0;
  const color = u.color & 0x1;
  const tribun = u.tribun ? 1 : 0;
  
  return (tribun << 7) | (color << 6) | (sIndex << 3) | pIndex;
}

// Action word encoding/decoding
export function opcode(word: number): number {
  return (word >>> 28) & 0xf;
}

export function payload(word: number): number {
  return word & 0x0ffffff;
}

// MOVE: opcode 0
export function encodeMove(fromCid: number, toCid: number, part: 0 | 1): number {
  return (0 << 28) | (part << 14) | (toCid << 7) | fromCid;
}

// KILL: opcode 1
export function encodeKill(attackerCid: number, targetCid: number, part: 0 | 1): number {
  return (1 << 28) | (part << 14) | (targetCid << 7) | attackerCid;
}

// LIBERATE: opcode 2
export function encodeLiberate(targetCid: number): number {
  return (2 << 28) | targetCid;
}

// DAMAGE: opcode 3
export function encodeDamage(targetCid: number, effectiveDamage: number): number {
  const effDmgMinus1 = effectiveDamage - 1;
  if (effDmgMinus1 < 0 || effDmgMinus1 > 7) {
    throw new Error(`effectiveDamage must be 1..8, got ${effectiveDamage}`);
  }
  return (3 << 28) | (effDmgMinus1 << 7) | targetCid;
}

// ENSLAVE: opcode 4
export function encodeEnslave(attackerCid: number, targetCid: number): number {
  return (4 << 28) | (targetCid << 7) | attackerCid;
}

// COMBINE: opcode 5
export function encodeCombine(
  centerCid: number,
  dirA: number,
  dirB: number,
  donateA: number,
  donateB: number
): number {
  const donAminus1 = donateA - 1;
  const donBminus1 = donateB - 1;
  return (
    (5 << 28) |
    (donBminus1 << 16) |
    (donAminus1 << 13) |
    (dirB << 10) |
    (dirA << 7) |
    centerCid
  );
}

// SYM_COMBINE: opcode 6
export function encodeSymCombine(
  centerCid: number,
  config: 0 | 1 | 2,
  donate: number
): number {
  const donMinus1 = donate - 1;
  return (6 << 28) | (donMinus1 << 9) | (config << 7) | centerCid;
}

// SPLIT: opcode 7
export function encodeSplit(actorCid: number, heights: [number, number, number, number, number, number]): number {
  let word = 7 << 28;
  for (let i = 0; i < 6; i++) {
    word |= (heights[i] & 0x7) << (7 + i * 3);
  }
  word |= actorCid;
  return word;
}

// BACKSTABB: opcode 8
export function encodeBackstabb(actorCid: number, dir: number): number {
  return (8 << 28) | (dir << 7) | actorCid;
}

// ATTACK_TRIBUN: opcode 9
export function encodeAttackTribun(attackerCid: number, tribunCid: number, winnerColor: Color): number {
  return (9 << 28) | (winnerColor << 14) | (tribunCid << 7) | attackerCid;
}

// DRAW: opcode 10
export function encodeDraw(drawAction: 0 | 1 | 2 | 3, actorColor: Color): number {
  // drawAction: 0=offer, 1=retract, 2=accept, 3=decline
  return (10 << 28) | (actorColor << 1) | drawAction;
}

// END: opcode 11
export function encodeEnd(endReason: number, loserColor?: Color): number {
  // endReason: 0=resign, 1=no-legal-moves, 2=timeout-player, 3=timeout-game-tie
  let payload = endReason;
  if (loserColor !== undefined) {
    payload |= (loserColor << 2);
  }
  return (11 << 28) | payload;
}

export function decodeAction(action: number): { opcode: number; fields: Record<string, number> } {
  const op = opcode(action);
  const pay = payload(action);
  const fields: Record<string, number> = {};
  
  switch (op) {
    case 0: // MOVE
      fields.fromCid = pay & 0x7f;
      fields.toCid = (pay >>> 7) & 0x7f;
      fields.part = (pay >>> 14) & 0x1;
      break;
    case 1: // KILL
      fields.attackerCid = pay & 0x7f;
      fields.targetCid = (pay >>> 7) & 0x7f;
      fields.part = (pay >>> 14) & 0x1;
      break;
    case 2: // LIBERATE
      fields.targetCid = pay & 0x7f;
      break;
    case 3: // DAMAGE
      fields.targetCid = pay & 0x7f;
      fields.effectiveDamage = ((pay >>> 7) & 0x7) + 1;
      break;
    case 4: // ENSLAVE
      fields.attackerCid = pay & 0x7f;
      fields.targetCid = (pay >>> 7) & 0x7f;
      break;
    case 5: // COMBINE
      fields.centerCid = pay & 0x7f;
      fields.dirA = (pay >>> 7) & 0x7;
      fields.dirB = (pay >>> 10) & 0x7;
      fields.donateA = ((pay >>> 13) & 0x7) + 1;
      fields.donateB = ((pay >>> 16) & 0x7) + 1;
      break;
    case 6: // SYM_COMBINE
      fields.centerCid = pay & 0x7f;
      fields.config = (pay >>> 7) & 0x3;
      fields.donate = ((pay >>> 9) & 0x3) + 1;
      break;
    case 7: // SPLIT
      fields.actorCid = pay & 0x7f;
      fields.h0 = (pay >>> 7) & 0x7;
      fields.h1 = (pay >>> 10) & 0x7;
      fields.h2 = (pay >>> 13) & 0x7;
      fields.h3 = (pay >>> 16) & 0x7;
      fields.h4 = (pay >>> 19) & 0x7;
      fields.h5 = (pay >>> 22) & 0x7;
      break;
    case 8: // BACKSTABB
      fields.actorCid = pay & 0x7f;
      fields.dir = (pay >>> 7) & 0x7;
      break;
    case 9: // ATTACK_TRIBUN
      fields.attackerCid = pay & 0x7f;
      fields.tribunCid = (pay >>> 7) & 0x7f;
      fields.winnerColor = (pay >>> 14) & 0x1;
      break;
    case 10: // DRAW
      fields.drawAction = pay & 0x3;
      fields.actorColor = (pay >>> 1) & 0x1;
      break;
    case 11: // END
      fields.endReason = pay & 0x3;
      fields.loserColor = (pay >>> 2) & 0x1;
      break;
  }
  
  return { opcode: op, fields };
}

// Board packing/unpacking
export function packBoard(board: Uint8Array): string {
  // Convert Uint8Array to base64
  const binary = String.fromCharCode(...board);
  return btoa(binary);
}

export function unpackBoard(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Neighbor vectors
const NEIGHBOR_VECTORS = [
  [1, 1],   // 0: up
  [1, 0],   // 1: left-up
  [0, 1],   // 2: right-up
  [-1, -1], // 3: down
  [-1, 0],  // 4: right-down
  [0, -1],  // 5: left-down
];

function getNeighborCid(cid: number, dir: number): number | null {
  try {
    const { x, y } = decodeCoord(cid);
    const [dx, dy] = NEIGHBOR_VECTORS[dir];
    const nx = x + dx;
    const ny = y + dy;
    if (onBoard(nx, ny)) {
      return encodeCoord(nx, ny);
    }
  } catch {
    return null;
  }
  return null;
}

// Normalization functions
function roundDownInvalidHeight(h: number): Height {
  if (h <= 0) return 0;
  if (h === 5) return 4;
  if (h === 7) return 6;
  if (h >= 9) return 8; // Cap at 8
  if (h === 1 || h === 2 || h === 3 || h === 4 || h === 6 || h === 8) {
    return h as Height;
  }
  // For other invalid values, round down to nearest valid
  if (h < 4) return h as Height;
  if (h < 6) return 4;
  if (h < 8) return 6;
  return 8;
}

function enforceSP(unit: Unit): Unit {
  if (unit.s > 0) {
    if (unit.p > 4 || 2 * unit.p < unit.s) {
      // SP violated, set primary to 0
      return { ...unit, p: 0 };
    }
  }
  return unit;
}

function normalizeUnit(unit: Unit): Unit | null {
  // Step 1: Round down invalid heights
  let p = roundDownInvalidHeight(unit.p);
  let s = roundDownInvalidHeight(unit.s);
  
  // Step 2: Enforce SP
  let normalized: Unit = { ...unit, p, s };
  normalized = enforceSP(normalized);
  
  // Step 3: Liberation
  if (normalized.p === 0 && normalized.s > 0) {
    p = roundDownInvalidHeight(normalized.s);
    normalized = {
      color: normalized.color === 0 ? 1 : 0,
      tribun: false, // Liberation cannot create tribun
      p,
      s: 0,
    };
  }
  
  // Final check: empty unit
  if (normalized.p === 0 && normalized.s === 0) {
    return null;
  }
  
  return normalized;
}

// Movement pattern generators
function getHeight1MoveOffsets(color: Color): number[][] {
  if (color === 0) { // black
    return [[1, 1]];
  } else { // white
    return [[-1, -1]];
  }
}

function getHeight1AttackOffsets(color: Color): number[][] {
  if (color === 0) { // black
    return [[1, 0], [0, 1]];
  } else { // white
    return [[-1, 0], [0, -1]];
  }
}

function getSecondaryPatternColor(color: Color, height: Height): Color {
  if (height === 1) {
    return color === 0 ? 1 : 0;
  }
  return color;
}

function getHeight2Offsets(): number[][] {
  const base = [[1, 2], [-1, 1], [2, 1]];
  const result: number[][] = [];
  for (const [x, y] of base) {
    result.push([x, y]);
    result.push([-x, -y]);
  }
  return result;
}

function getHeight3Offsets(): number[][] {
  const base = [[3, 2], [2, 3], [1, 3], [3, 1], [-1, 2], [2, -1]];
  const result: number[][] = [];
  for (const [x, y] of base) {
    result.push([x, y]);
    result.push([-x, -y]);
  }
  return result;
}

function getHeight4DirectionVectors(): number[][] {
  return getHeight2Offsets();
}

function getHeight6T1ExpansionOffsets(): number[][] {
  // t1 adjacency expansion - all tiles reachable by repeated t1 moves
  // This is a breadth-first expansion of the 6 neighbors
  const visited = new Set<string>();
  const result: number[][] = [];
  const queue: number[][] = [];
  
  // Start with all 6 neighbors
  for (const vec of NEIGHBOR_VECTORS) {
    queue.push([...vec]);
  }
  
  // Expand outward (limit to reasonable distance)
  for (let depth = 0; depth < 10 && queue.length > 0; depth++) {
    const current = queue.shift()!;
    const key = `${current[0]},${current[1]}`;
    if (visited.has(key)) continue;
    visited.add(key);
    result.push([...current]);
    
    // Add neighbors
    for (const vec of NEIGHBOR_VECTORS) {
      const next = [current[0] + vec[0], current[1] + vec[1]];
      const nextKey = `${next[0]},${next[1]}`;
      if (!visited.has(nextKey)) {
        queue.push(next);
      }
    }
  }
  
  return result;
}

function getHeight8Offsets(): number[][] {
  // Height 8: t1 adjacency (all 6 neighbors)
  return NEIGHBOR_VECTORS.map(v => [...v]);
}

function getHeight8JumpOffsets(): number[][] {
  // Height 8: jump moves (+2*v where v is adjacency vector)
  return NEIGHBOR_VECTORS.map(v => [v[0] * 2, v[1] * 2]);
}

// Get all reachable tiles for a movement pattern
function getReachableTiles(
  fromCid: number,
  height: Height,
  color: Color,
  isTribun: boolean,
  board: Uint8Array,
  forAttack: boolean = false
): number[] {
  const { x, y } = decodeCoord(fromCid);
  const reachable: number[] = [];
  
  if (height === 1) {
    if (isTribun) {
      // t1: all 6 neighbors
      for (let dir = 0; dir < 6; dir++) {
        const cid = getNeighborCid(fromCid, dir);
        if (cid !== null) {
          reachable.push(cid);
        }
      }
    } else {
      // Height 1: color-dependent move
      const offsets = forAttack ? getHeight1AttackOffsets(color) : getHeight1MoveOffsets(color);
      for (const [dx, dy] of offsets) {
        try {
          const cid = encodeCoord(x + dx, y + dy);
          reachable.push(cid);
        } catch {}
      }
    }
  } else if (height === 2) {
    const offsets = getHeight2Offsets();
    for (const [dx, dy] of offsets) {
      try {
        const cid = encodeCoord(x + dx, y + dy);
        reachable.push(cid);
      } catch {}
    }
  } else if (height === 3) {
    const offsets = getHeight3Offsets();
    for (const [dx, dy] of offsets) {
      try {
        const cid = encodeCoord(x + dx, y + dy);
        reachable.push(cid);
      } catch {}
    }
  } else if (height === 4) {
    // Sliding: choose direction vector, slide until hit unit or border
    const dirVectors = getHeight4DirectionVectors();
    for (const [vx, vy] of dirVectors) {
      let step = 1;
      while (true) {
        try {
          const nx = x + vx * step;
          const ny = y + vy * step;
          const cid = encodeCoord(nx, ny);
          const unit = unitByteToUnit(board[cid]);
          
          if (forAttack) {
            // Attack: can only attack first occupied tile, and only if it contains an enemy unit
            if (unit !== null) {
              // Only add if enemy (color check happens at caller level, but we can optimize here)
              // Note: color is not available in this function, so we add it and filter later
              reachable.push(cid);
              break;
            }
          } else {
            // Move: can move to any empty tile before first occupied
            if (unit !== null) {
              break;
            }
            reachable.push(cid);
          }
          step++;
        } catch {
          break;
        }
      }
    }
  } else if (height === 6) {
    if (forAttack) {
      // Height 6 attack: ray along adjacency directions, first unit blocks.
      for (const [vx, vy] of NEIGHBOR_VECTORS) {
        let step = 1;
        while (true) {
          try {
            const nx = x + vx * step;
            const ny = y + vy * step;
            const cid = encodeCoord(nx, ny);
            const unit = unitByteToUnit(board[cid]);
            if (unit !== null) {
              reachable.push(cid);
              break;
            }
            step++;
          } catch {
            break;
          }
        }
      }
    } else {
      // Height 6 move: same as height 4
      const dirVectors = getHeight4DirectionVectors();
      for (const [vx, vy] of dirVectors) {
        let step = 1;
        while (true) {
          try {
            const nx = x + vx * step;
            const ny = y + vy * step;
            const cid = encodeCoord(nx, ny);
            const unit = unitByteToUnit(board[cid]);
            if (unit !== null) {
              break;
            }
            reachable.push(cid);
            step++;
          } catch {
            break;
          }
        }
      }
    }
  } else if (height === 8) {
    // Height 8: t1 adjacency + jump moves
    const adjOffsets = getHeight8Offsets();
    for (const [dx, dy] of adjOffsets) {
      try {
        const cid = encodeCoord(x + dx, y + dy);
        reachable.push(cid);
      } catch {}
    }
    
    // Jump moves: +2*v if intermediate is empty or friendly
    const jumpOffsets = getHeight8JumpOffsets();
    for (let i = 0; i < jumpOffsets.length; i++) {
      const [jdx, jdy] = jumpOffsets[i];
      const [midDx, midDy] = NEIGHBOR_VECTORS[i];
      try {
        const midCid = encodeCoord(x + midDx, y + midDy);
        const midUnit = unitByteToUnit(board[midCid]);
        if (midUnit === null || midUnit.color === color) {
          // Can jump: intermediate is empty or friendly
          const cid = encodeCoord(x + jdx, y + jdy);
          reachable.push(cid);
        }
      } catch {}
    }
  }
  
  return reachable;
}

// Attack pattern: height 8 attacks as height 2 plus t1 adjacency and jumps
function getAttackReachableTiles(
  fromCid: number,
  height: Height,
  color: Color,
  isTribun: boolean,
  board: Uint8Array
): number[] {
  if (height === 8) {
    // Height 8 always attacks as height 2
    const { x, y } = decodeCoord(fromCid);
    const offsets = getHeight2Offsets();
    const reachable = new Set<number>();
    for (const [dx, dy] of offsets) {
      try {
        const cid = encodeCoord(x + dx, y + dy);
        reachable.add(cid);
      } catch {}
    }
    
    // Also allow adjacency and jump attacks
    const moveLike = getReachableTiles(fromCid, height, color, isTribun, board, false);
    for (const cid of moveLike) {
      reachable.add(cid);
    }
    
    return Array.from(reachable);
  }
  return getReachableTiles(fromCid, height, color, isTribun, board, true);
}

type AttackOption = {
  cid: number;
  part: 0 | 1;
  height: Height;
};

type AttackGroup = {
  cid: number;
  options: AttackOption[];
};

type AttackContext = {
  targetUnit: Unit;
  groups: AttackGroup[];
  prefix: boolean[][];
  suffix: boolean[][];
  possibleSums: boolean[];
  maxSum: number;
  canReachKill: boolean;
  damageSet: Set<number>;
  canLiberate: boolean;
};

function advanceSumDp(dp: boolean[], options: AttackOption[], maxSum: number): boolean[] {
  const next = new Array(maxSum + 1).fill(false);
  for (let sum = 0; sum <= maxSum; sum++) {
    if (!dp[sum]) continue;
    next[sum] = true;
    for (const opt of options) {
      const newSum = Math.min(maxSum, sum + opt.height);
      next[newSum] = true;
    }
  }
  return next;
}

function combineSumDp(left: boolean[], right: boolean[], maxSum: number): boolean[] {
  const combined = new Array(maxSum + 1).fill(false);
  for (let i = 0; i <= maxSum; i++) {
    if (!left[i]) continue;
    for (let j = 0; j <= maxSum; j++) {
      if (!right[j]) continue;
      const newSum = Math.min(maxSum, i + j);
      combined[newSum] = true;
    }
  }
  return combined;
}

function canReachAtLeast(maxSum: number, optionHeight: number, dpWithout: boolean[]): boolean {
  const needed = Math.max(0, maxSum - optionHeight);
  for (let sum = needed; sum <= maxSum; sum++) {
    if (dpWithout[sum]) return true;
  }
  return false;
}

function isSlavePropertySatisfied(primary: number, secondary: number): boolean {
  if (secondary <= 0) return true;
  if (primary <= 0) return false;
  return primary <= 4 && 2 * primary >= secondary;
}

function isValidHeightValue(value: number): value is Height {
  return value === 0 || value === 1 || value === 2 || value === 3 ||
    value === 4 || value === 6 || value === 8;
}

function isDonationRemainderValid(remaining: number, secondary: number): boolean {
  if (!isValidHeightValue(remaining)) return false;
  if (remaining === 0) return true;
  if (secondary <= 0) return true;
  return remaining <= 4 && 2 * remaining >= secondary;
}

function buildAttackContext(state: State, targetCid: number): AttackContext | null {
  const targetUnit = unitByteToUnit(state.board[targetCid]);
  if (!targetUnit || targetUnit.color === state.turn) return null;

  const groups: AttackGroup[] = [];
  for (let cid = 0; cid < 121; cid++) {
    const unit = unitByteToUnit(state.board[cid]);
    if (!unit || unit.color !== state.turn || unit.p === 0) continue;

    const options: AttackOption[] = [];

    const primaryAttackReachable = getAttackReachableTiles(cid, unit.p, unit.color, unit.tribun, state.board);
    if (primaryAttackReachable.includes(targetCid)) {
      options.push({
        cid,
        part: 0,
        height: unit.p,
      });
    }

    if (unit.s > 0) {
      const secondaryColor = getSecondaryPatternColor(unit.color, unit.s);
      const secondaryAttackReachable = getAttackReachableTiles(cid, unit.s, secondaryColor, false, state.board);
      if (secondaryAttackReachable.includes(targetCid)) {
        options.push({
          cid,
          part: 1,
          height: unit.s,
        });
      }
    }

    if (options.length > 0) {
      groups.push({ cid, options });
    }
  }

  if (groups.length === 0) return null;

  const maxSum = targetUnit.p;
  const prefix: boolean[][] = new Array(groups.length + 1);
  prefix[0] = new Array(maxSum + 1).fill(false);
  prefix[0][0] = true;
  for (let i = 0; i < groups.length; i++) {
    prefix[i + 1] = advanceSumDp(prefix[i], groups[i].options, maxSum);
  }

  const suffix: boolean[][] = new Array(groups.length + 1);
  suffix[groups.length] = new Array(maxSum + 1).fill(false);
  suffix[groups.length][0] = true;
  for (let i = groups.length - 1; i >= 0; i--) {
    suffix[i] = advanceSumDp(suffix[i + 1], groups[i].options, maxSum);
  }

  const possibleSums = prefix[groups.length];
  const canReachKill = possibleSums[maxSum];

  const damageSet = new Set<number>();
  let canLiberate = false;

  if (!targetUnit.tribun) {
    for (let sum = 1; sum < maxSum; sum++) {
      if (!possibleSums[sum]) continue;
      const outcome = resolveDamageOutcome(targetUnit, sum);
      if (outcome.type === 'liberate') {
        canLiberate = true;
      } else if (outcome.type === 'damage') {
        if (outcome.effectiveDamage > 0 && outcome.effectiveDamage < maxSum) {
          damageSet.add(outcome.effectiveDamage);
        }
      }
    }
  }

  return {
    targetUnit,
    groups,
    prefix,
    suffix,
    possibleSums,
    maxSum,
    canReachKill,
    damageSet,
    canLiberate,
  };
}

function canKillWithOption(
  context: AttackContext,
  attackerCid: number,
  part: 0 | 1
): { canKill: boolean; option?: AttackOption; groupIndex?: number } {
  for (let i = 0; i < context.groups.length; i++) {
    const group = context.groups[i];
    if (group.cid !== attackerCid) continue;
    const option = group.options.find((opt) => opt.part === part);
    if (!option) {
      return { canKill: false };
    }
    const without = combineSumDp(context.prefix[i], context.suffix[i + 1], context.maxSum);
    if (!canReachAtLeast(context.maxSum, option.height, without)) {
      return { canKill: false };
    }
    return { canKill: true, option, groupIndex: i };
  }
  return { canKill: false };
}

function resolveDamageOutcome(
  targetUnit: Unit,
  damage: number
): { type: 'damage'; effectiveDamage: number } | { type: 'liberate' } | { type: 'empty' } {
  const damagedUnit: Unit = {
    ...targetUnit,
    p: (targetUnit.p - damage) as Height,
  };
  const normalized = normalizeUnit(damagedUnit);
  if (!normalized) {
    return { type: 'empty' };
  }
  if (normalized.color !== targetUnit.color) {
    return { type: 'liberate' };
  }
  const effectiveDamage = targetUnit.p - normalized.p;
  return { type: 'damage', effectiveDamage };
}

// Generate all legal actions
export function generateLegalActions(state: State): Uint32Array {
  const actions: number[] = [];
  
  if (state.status === 'ended') {
    return new Uint32Array(0);
  }
  
  // Generate move actions
  for (let cid = 0; cid < 121; cid++) {
    const unitByte = state.board[cid];
    const unit = unitByteToUnit(unitByte);
    
    if (unit && unit.color === state.turn && unit.p > 0) {
      // Try primary pattern
      const primaryReachable = getReachableTiles(cid, unit.p, unit.color, unit.tribun, state.board, false);
      for (const toCid of primaryReachable) {
        const targetUnit = unitByteToUnit(state.board[toCid]);
        if (targetUnit === null) {
          actions.push(encodeMove(cid, toCid, 0));
        }
      }
      
      // Try secondary pattern if available
      if (unit.s > 0) {
        const secondaryColor = getSecondaryPatternColor(unit.color, unit.s);
        const secondaryReachable = getReachableTiles(cid, unit.s, secondaryColor, false, state.board, false);
        for (const toCid of secondaryReachable) {
          const targetUnit = unitByteToUnit(state.board[toCid]);
          if (targetUnit === null) {
            actions.push(encodeMove(cid, toCid, 1));
          }
        }
      }
    }
  }
  
  // Generate attack actions
  for (let targetCid = 0; targetCid < 121; targetCid++) {
    const context = buildAttackContext(state, targetCid);
    if (!context) continue;

    const targetUnit = context.targetUnit;
    const targetPrimary = targetUnit.p;

    // Check for tribun attack (instant win)
    if (targetUnit.tribun) {
      for (const group of context.groups) {
        actions.push(encodeAttackTribun(group.cid, targetCid, state.turn));
      }
      continue;
    }

    let canLiberate = context.canLiberate;

    if (context.canReachKill) {
      if (targetUnit.s > 0) {
        canLiberate = true;
      } else {
        for (const group of context.groups) {
          for (const option of group.options) {
            const killCheck = canKillWithOption(context, option.cid, option.part);
            if (!killCheck.canKill) continue;
            actions.push(encodeKill(option.cid, targetCid, option.part));

            if (option.part === 0) {
              const attackerUnit = unitByteToUnit(state.board[option.cid])!;
              if (!attackerUnit.tribun && isSlavePropertySatisfied(option.height, targetPrimary)) {
                actions.push(encodeEnslave(option.cid, targetCid));
              }
            }
          }
        }
      }
    }

    if (canLiberate) {
      actions.push(encodeLiberate(targetCid));
    }
    for (const damage of context.damageSet) {
      actions.push(encodeDamage(targetCid, damage));
    }
  }
  
  // Generate combine actions
  for (let centerCid = 0; centerCid < 121; centerCid++) {
    const centerUnit = unitByteToUnit(state.board[centerCid]);
    if (centerUnit !== null) continue; // Center must be empty
    
    // Find adjacent owned units by direction
    const adjacentOwned: Array<{ cid: number; unit: Unit; dir: number }> = [];
    for (let dir = 0; dir < 6; dir++) {
      const neighborCid = getNeighborCid(centerCid, dir);
      if (neighborCid !== null) {
        const unit = unitByteToUnit(state.board[neighborCid]);
        if (unit && unit.color === state.turn && unit.p > 0) {
          adjacentOwned.push({ cid: neighborCid, unit, dir });
        }
      }
    }
    
    // 2-donor combine
    for (let i = 0; i < adjacentOwned.length; i++) {
      for (let j = i + 1; j < adjacentOwned.length; j++) {
        const donorA = adjacentOwned[i];
        const donorB = adjacentOwned[j];
        
        // Try different donation amounts
        for (let donA = 1; donA <= Math.min(donorA.unit.p, 8); donA++) {
          if (donorA.unit.tribun && donA !== donorA.unit.p) continue;
          for (let donB = 1; donB <= Math.min(donorB.unit.p, 8); donB++) {
            if (donorB.unit.tribun && donB !== donorB.unit.p) continue;
            
            const newPrimary = donA + donB;
            if (!isValidHeightValue(newPrimary)) continue;
            const remainingA = donorA.unit.p - donA;
            const remainingB = donorB.unit.p - donB;
            if (!isDonationRemainderValid(remainingA, donorA.unit.s)) continue;
            if (!isDonationRemainderValid(remainingB, donorB.unit.s)) continue;
            actions.push(encodeCombine(centerCid, donorA.dir, donorB.dir, donA, donB));
          }
        }
      }
    }
    
    // Symmetrical combine (3 or 6 donors)
    const donorsByDir: Array<Unit | null> = new Array(6).fill(null);
    for (const donor of adjacentOwned) {
      donorsByDir[donor.dir] = donor.unit;
    }
    
    // Check for 6 donors (all neighbors)
    if (donorsByDir.every(d => d !== null)) {
      const donors = donorsByDir as Unit[];
      const firstDonor = donors[0];
      if (!firstDonor.tribun && donors.every(d => !d.tribun && d.p === firstDonor.p && d.s === firstDonor.s && d.color === firstDonor.color)) {
        const donate = 1;
        if (firstDonor.p >= donate) {
          const newPrimary = donate * donors.length;
          const remaining = firstDonor.p - donate;
          if (!isValidHeightValue(newPrimary)) continue;
          if (!isDonationRemainderValid(remaining, firstDonor.s)) continue;
          actions.push(encodeSymCombine(centerCid, 0, donate));
        }
      }
    }
    
    // Check for 3-donor configurations
    const configs: Array<{ dirs: number[]; config: 0 | 1 | 2 }> = [
      { dirs: [0, 4, 5], config: 1 },
      { dirs: [3, 1, 2], config: 2 },
    ];
    
    for (const { dirs, config } of configs) {
      const donors = dirs.map(dir => donorsByDir[dir]).filter(u => u !== null) as Unit[];
      if (donors.length !== 3) continue;
      
      const firstDonor = donors[0];
      if (firstDonor.tribun || !donors.every(d => !d.tribun && d.p === firstDonor.p && d.s === firstDonor.s && d.color === firstDonor.color)) {
        continue;
      }
      
      for (let donate = 1; donate <= 2; donate++) {
        if (firstDonor.p < donate) continue;
        
        const newPrimary = donate * donors.length;
        const remaining = firstDonor.p - donate;
        if (!isValidHeightValue(newPrimary)) continue;
        if (!isDonationRemainderValid(remaining, firstDonor.s)) continue;
        actions.push(encodeSymCombine(centerCid, config, donate));
      }
    }
  }
  
  // Generate split actions
  for (let actorCid = 0; actorCid < 121; actorCid++) {
    const unit = unitByteToUnit(state.board[actorCid]);
    if (!unit || unit.color !== state.turn || unit.p === 0 || unit.tribun) continue;
    
    const emptyDirs: boolean[] = new Array(6).fill(false);
    let hasEmpty = false;
    for (let dir = 0; dir < 6; dir++) {
      const neighborCid = getNeighborCid(actorCid, dir);
      if (neighborCid !== null) {
        const neighborUnit = unitByteToUnit(state.board[neighborCid]);
        if (neighborUnit === null) {
          emptyDirs[dir] = true;
          hasEmpty = true;
        }
      }
    }
    if (!hasEmpty) continue;
    
    const splitHeights = [1, 2, 3, 4, 6];
    const validHeights = [1, 2, 3, 4, 6, 8];
    const heights: number[] = new Array(6).fill(0);
    
    const trySplit = (dirIndex: number, remaining: number, placedCount: number) => {
      if (dirIndex === 6) {
        if (remaining < 0) return;
        const remainder = remaining;
        const totalCount = placedCount + (remainder > 0 ? 1 : 0);
        if (totalCount < 2) return;
        
        if (remainder > 0) {
          if (!validHeights.includes(remainder)) return;
          if (unit.s > 0 && (remainder > 4 || 2 * remainder < unit.s)) return;
        }
        
        actions.push(encodeSplit(actorCid, heights as [number, number, number, number, number, number]));
        return;
      }
      
      if (!emptyDirs[dirIndex]) {
        heights[dirIndex] = 0;
        trySplit(dirIndex + 1, remaining, placedCount);
        return;
      }
      
      heights[dirIndex] = 0;
      trySplit(dirIndex + 1, remaining, placedCount);
      
      for (const h of splitHeights) {
        if (h > remaining) continue;
        heights[dirIndex] = h;
        trySplit(dirIndex + 1, remaining - h, placedCount + 1);
      }
    };
    
    trySplit(0, unit.p, 0);
  }
  
  // Generate backstabb actions
  for (let actorCid = 0; actorCid < 121; actorCid++) {
    const unit = unitByteToUnit(state.board[actorCid]);
    if (!unit || unit.color !== state.turn || unit.s === 0) continue;
    
    // Find adjacent empty tiles
    for (let dir = 0; dir < 6; dir++) {
      const neighborCid = getNeighborCid(actorCid, dir);
      if (neighborCid !== null) {
        const neighborUnit = unitByteToUnit(state.board[neighborCid]);
        if (neighborUnit === null) {
          actions.push(encodeBackstabb(actorCid, dir));
        }
      }
    }
  }
  
  // Always allow resign for both colors
  actions.push(encodeEnd(0, 0));
  actions.push(encodeEnd(0, 1));

  const blocked = state.drawOfferBlocked ?? null;
  const offerBy = state.drawOfferBy ?? null;

  // Allow draw offer/retract/accept/decline based on state (not turn-bound)
  if (offerBy === null) {
    if (blocked !== 0) {
      actions.push(encodeDraw(0, 0));
    }
    if (blocked !== 1) {
      actions.push(encodeDraw(0, 1));
    }
  } else {
    actions.push(encodeDraw(1, offerBy));
    const opponent = offerBy === 0 ? 1 : 0;
    actions.push(encodeDraw(2, opponent));
    actions.push(encodeDraw(3, opponent));
  }
  
  // Sort for stability
  actions.sort((a, b) => a - b);
  
  return new Uint32Array(actions);
}

// Apply action to state
export function applyAction(state: State, action: number): State {
  if (state.status === 'ended') {
    throw new Error('Cannot apply action to ended game');
  }
  
  const { opcode: op, fields } = decodeAction(action);
  const newBoard = new Uint8Array(state.board);
  let newTurn: Color = state.turn === 0 ? 1 : 0;
  let newPly = state.ply + 1;
  let newDrawOfferBy: Color | null = state.drawOfferBy;
  let newDrawOfferBlocked: Color | null = state.drawOfferBlocked ?? null;
  let newStatus: 'active' | 'ended' = state.status || 'active';
  let newWinner: Color | null | undefined = state.winner;
  
  switch (op) {
    case 0: { // MOVE
      const fromCid = fields.fromCid;
      const toCid = fields.toCid;
      const part = fields.part;
      
      const fromUnit = unitByteToUnit(newBoard[fromCid]);
      if (!fromUnit || fromUnit.color !== state.turn) {
        throw new Error(`Illegal MOVE: no unit or wrong color at fromCid ${fromCid}`);
      }
      
      const toUnit = unitByteToUnit(newBoard[toCid]);
      if (toUnit !== null) {
        throw new Error(`Illegal MOVE: target tile not empty at toCid ${toCid}`);
      }
      
      // Validate move is legal
      const moveHeight = part === 0 ? fromUnit.p : fromUnit.s;
      const moveColor = part === 0 ? fromUnit.color : getSecondaryPatternColor(fromUnit.color, fromUnit.s);
      const reachable = getReachableTiles(
        fromCid,
        moveHeight,
        moveColor,
        part === 0 ? fromUnit.tribun : false,
        newBoard,
        false
      );
      if (!reachable.includes(toCid)) {
        throw new Error(`Illegal MOVE: destination not reachable`);
      }
      
      if (part === 0) {
        // Primary pattern: move only primary
        const movedUnit: Unit = {
          color: fromUnit.color,
          tribun: fromUnit.tribun,
          p: fromUnit.p,
          s: 0,
        };
        newBoard[toCid] = unitToUnitByte(movedUnit);
        
        // Update from tile: if had secondary, keep it; otherwise empty
        if (fromUnit.s > 0) {
          const remainingUnit: Unit = {
            color: fromUnit.color,
            tribun: false,
            p: 0,
            s: fromUnit.s,
          };
          const normalized = normalizeUnit(remainingUnit);
          newBoard[fromCid] = normalized ? unitToUnitByte(normalized) : 0;
        } else {
          newBoard[fromCid] = 0;
        }
      } else {
        // Secondary pattern: move entire stack
        newBoard[toCid] = newBoard[fromCid];
        newBoard[fromCid] = 0;
      }
      break;
    }
    
    case 1: { // KILL
      const attackerCid = fields.attackerCid;
      const targetCid = fields.targetCid;
      const part = fields.part as 0 | 1;
      
      const attackerUnit = unitByteToUnit(newBoard[attackerCid]);
      const targetUnit = unitByteToUnit(newBoard[targetCid]);
      
      if (!attackerUnit || attackerUnit.color !== state.turn) {
        throw new Error(`Illegal KILL: invalid attacker`);
      }
      if (!targetUnit || targetUnit.color === state.turn || targetUnit.tribun) {
        throw new Error(`Illegal KILL: invalid target`);
      }

      const killContext = buildAttackContext({ ...state, board: newBoard }, targetCid);
      if (!killContext || !killContext.canReachKill) {
        throw new Error(`Illegal KILL: insufficient attack strength`);
      }
      const killCheck = canKillWithOption(killContext, attackerCid, part);
      if (!killCheck.canKill) {
        throw new Error(`Illegal KILL: attacker cannot complete kill`);
      }
      
      const attackHeight = part === 0 ? attackerUnit.p : attackerUnit.s;
      const attackColor = part === 0 ? attackerUnit.color : getSecondaryPatternColor(attackerUnit.color, attackerUnit.s);
      const attackReachable = getAttackReachableTiles(
        attackerCid,
        attackHeight,
        attackColor,
        part === 0 ? attackerUnit.tribun : false,
        newBoard
      );
      if (!attackReachable.includes(targetCid)) {
        throw new Error(`Illegal KILL: attacker cannot attack target`);
      }
      
      // Remove target
      newBoard[targetCid] = 0;
      
      // Move attacker
      const moveHeight = part === 0 ? attackerUnit.p : attackerUnit.s;
      void moveHeight;
      
      if (part === 0) {
        // Move primary only
        const movedUnit: Unit = {
          color: attackerUnit.color,
          tribun: attackerUnit.tribun,
          p: attackerUnit.p,
          s: 0,
        };
        newBoard[targetCid] = unitToUnitByte(movedUnit);
        
        if (attackerUnit.s > 0) {
          const remainingUnit: Unit = {
            color: attackerUnit.color,
            tribun: false,
            p: 0,
            s: attackerUnit.s,
          };
          const normalized = normalizeUnit(remainingUnit);
          newBoard[attackerCid] = normalized ? unitToUnitByte(normalized) : 0;
        } else {
          newBoard[attackerCid] = 0;
        }
      } else {
        // Move entire stack
        newBoard[targetCid] = newBoard[attackerCid];
        newBoard[attackerCid] = 0;
      }
      break;
    }
    
    case 2: { // LIBERATE
      const targetCid = fields.targetCid;
      const targetUnit = unitByteToUnit(newBoard[targetCid]);
      
      if (!targetUnit || targetUnit.color === state.turn || targetUnit.s === 0) {
        throw new Error(`Illegal LIBERATE: invalid target`);
      }

      const liberateContext = buildAttackContext({ ...state, board: newBoard }, targetCid);
      if (!liberateContext) {
        throw new Error(`Illegal LIBERATE: no attackers`);
      }
      const canLiberate =
        liberateContext.canLiberate || (liberateContext.canReachKill && targetUnit.s > 0);
      if (!canLiberate) {
        throw new Error(`Illegal LIBERATE: insufficient attack strength`);
      }
      
      // Liberation: flip color, p := s, s := 0, tribun := false
      const liberatedUnit: Unit = {
        color: targetUnit.color === 0 ? 1 : 0,
        tribun: false,
        p: targetUnit.s,
        s: 0,
      };
      const normalized = normalizeUnit(liberatedUnit);
      newBoard[targetCid] = normalized ? unitToUnitByte(normalized) : 0;
      break;
    }
    
    case 3: { // DAMAGE
      const targetCid = fields.targetCid;
      const effectiveDamage = fields.effectiveDamage;
      const targetUnit = unitByteToUnit(newBoard[targetCid]);
      
      if (!targetUnit || targetUnit.color === state.turn || targetUnit.tribun) {
        throw new Error(`Illegal DAMAGE: invalid target`);
      }
      if (effectiveDamage <= 0 || effectiveDamage >= targetUnit.p) {
        throw new Error(`Illegal DAMAGE: invalid effective damage`);
      }

      const damageContext = buildAttackContext({ ...state, board: newBoard }, targetCid);
      if (!damageContext || !damageContext.damageSet.has(effectiveDamage)) {
        throw new Error(`Illegal DAMAGE: insufficient attack strength`);
      }
      
      // Apply effective damage (already normalized - MUST NOT re-run normalization)
      const newP = Math.max(0, targetUnit.p - effectiveDamage) as Height;
      const damagedUnit: Unit = {
        ...targetUnit,
        p: newP,
      };
      // Do NOT normalize - effective damage already encodes the final normalized outcome
      newBoard[targetCid] = unitToUnitByte(damagedUnit);
      break;
    }
    
    case 4: { // ENSLAVE
      const attackerCid = fields.attackerCid;
      const targetCid = fields.targetCid;
      
      const attackerUnit = unitByteToUnit(newBoard[attackerCid]);
      const targetUnit = unitByteToUnit(newBoard[targetCid]);
      
      if (!attackerUnit || attackerUnit.color !== state.turn) {
        throw new Error(`Illegal ENSLAVE: invalid attacker`);
      }
      if (!targetUnit || targetUnit.color === state.turn || targetUnit.tribun || targetUnit.s > 0) {
        throw new Error(`Illegal ENSLAVE: invalid target`);
      }

      const enslaveContext = buildAttackContext({ ...state, board: newBoard }, targetCid);
      if (!enslaveContext || !enslaveContext.canReachKill) {
        throw new Error(`Illegal ENSLAVE: insufficient attack strength`);
      }
      const enslaveCheck = canKillWithOption(enslaveContext, attackerCid, 0);
      if (!enslaveCheck.canKill) {
        throw new Error(`Illegal ENSLAVE: attacker cannot complete enslave`);
      }
      if (attackerUnit.tribun) {
        throw new Error(`Illegal ENSLAVE: tribun cannot enslave`);
      }
      if (!isSlavePropertySatisfied(attackerUnit.p, targetUnit.p)) {
        throw new Error(`Illegal ENSLAVE: would violate SP`);
      }
      
      const attackReachable = getAttackReachableTiles(
        attackerCid,
        attackerUnit.p,
        attackerUnit.color,
        attackerUnit.tribun,
        newBoard
      );
      if (!attackReachable.includes(targetCid)) {
        throw new Error(`Illegal ENSLAVE: attacker cannot attack target`);
      }
      
      // Temporarily clear target to place the enslaved unit
      newBoard[targetCid] = 0;
      
      // Enslave: target becomes enslaved, attacker's primary moves to target
      const enslavedUnit: Unit = {
        color: state.turn,
        tribun: attackerUnit.tribun,
        p: attackerUnit.p,
        s: targetUnit.p,
      };
      newBoard[targetCid] = unitToUnitByte(enslavedUnit);
      
      // Attacker loses primary, any slave is liberated
      if (attackerUnit.s > 0) {
        const remainingUnit: Unit = {
          color: attackerUnit.color,
          tribun: false,
          p: 0,
          s: attackerUnit.s,
        };
        const libUnit = normalizeUnit(remainingUnit);
        newBoard[attackerCid] = libUnit ? unitToUnitByte(libUnit) : 0;
      } else {
        newBoard[attackerCid] = 0;
      }
      break;
    }
    
    case 5: { // COMBINE
      const centerCid = fields.centerCid;
      const dirA = fields.dirA;
      const dirB = fields.dirB;
      const donateA = fields.donateA;
      const donateB = fields.donateB;
      
      const centerUnit = unitByteToUnit(newBoard[centerCid]);
      if (centerUnit !== null) {
        throw new Error(`Illegal COMBINE: center not empty`);
      }
      
      const donorACid = getNeighborCid(centerCid, dirA);
      const donorBCid = getNeighborCid(centerCid, dirB);
      if (donorACid === null || donorBCid === null) {
        throw new Error(`Illegal COMBINE: invalid donor positions`);
      }
      
      const donorA = unitByteToUnit(newBoard[donorACid]);
      const donorB = unitByteToUnit(newBoard[donorBCid]);
      if (!donorA || !donorB || donorA.color !== state.turn || donorB.color !== state.turn) {
        throw new Error(`Illegal COMBINE: invalid donors`);
      }
      if (donateA > donorA.p || donateB > donorB.p) {
        throw new Error(`Illegal COMBINE: donation exceeds primary`);
      }
      
      // Create new unit
      const newPrimary = donateA + donateB;
      if (!isValidHeightValue(newPrimary)) {
        throw new Error(`Illegal COMBINE: invalid resulting height`);
      }
      const remainingA = donorA.p - donateA;
      const remainingB = donorB.p - donateB;
      if (!isDonationRemainderValid(remainingA, donorA.s) ||
          !isDonationRemainderValid(remainingB, donorB.s)) {
        throw new Error(`Illegal COMBINE: donor remainder invalid`);
      }
      const hasTribun = donorA.tribun || donorB.tribun;
      if (hasTribun && (donateA !== donorA.p || donateB !== donorB.p)) {
        throw new Error(`Illegal COMBINE: tribun must donate entire primary`);
      }
      
      const combinedUnit: Unit = {
        color: state.turn,
        tribun: hasTribun,
        p: newPrimary as Height,
        s: 0,
      };
      newBoard[centerCid] = unitToUnitByte(combinedUnit);
      
      // Update donors
      const newDonorA: Unit = {
        ...donorA,
        p: (donorA.p - donateA) as Height,
        tribun: donorA.tribun && donateA === donorA.p ? false : donorA.tribun,
      };
      const normA = normalizeUnit(newDonorA);
      newBoard[donorACid] = normA ? unitToUnitByte(normA) : 0;
      
      const newDonorB: Unit = {
        ...donorB,
        p: (donorB.p - donateB) as Height,
        tribun: donorB.tribun && donateB === donorB.p ? false : donorB.tribun,
      };
      const normB = normalizeUnit(newDonorB);
      newBoard[donorBCid] = normB ? unitToUnitByte(normB) : 0;
      break;
    }
    
    case 6: { // SYM_COMBINE
      const centerCid = fields.centerCid;
      const config = fields.config;
      const donate = fields.donate;
      
      const centerUnit = unitByteToUnit(newBoard[centerCid]);
      if (centerUnit !== null) {
        throw new Error(`Illegal SYM_COMBINE: center not empty`);
      }
      
      let donorCids: number[] = [];
      if (config === 0) {
        // 6 donors
        if (donate !== 1) {
          throw new Error(`Illegal SYM_COMBINE: 6-donor must donate 1`);
        }
        for (let dir = 0; dir < 6; dir++) {
          const cid = getNeighborCid(centerCid, dir);
          if (cid !== null) donorCids.push(cid);
        }
      } else if (config === 1) {
        // 3 donors: dirs 0, 4, 5
        donorCids = [0, 4, 5].map(dir => getNeighborCid(centerCid, dir)).filter(cid => cid !== null) as number[];
      } else if (config === 2) {
        // 3 donors: dirs 3, 1, 2
        donorCids = [3, 1, 2].map(dir => getNeighborCid(centerCid, dir)).filter(cid => cid !== null) as number[];
      }
      
      if (donorCids.length !== (config === 0 ? 6 : 3)) {
        throw new Error(`Illegal SYM_COMBINE: wrong number of donors`);
      }
      
      const donors = donorCids.map(cid => unitByteToUnit(newBoard[cid])).filter(u => u !== null) as Unit[];
      if (donors.length !== donorCids.length) {
        throw new Error(`Illegal SYM_COMBINE: missing donors`);
      }
      
      // Check all donors are equal and not tribun
      const firstDonor = donors[0];
      if (firstDonor.tribun || !donors.every(d => d.p === firstDonor.p && d.s === firstDonor.s && d.color === firstDonor.color)) {
        throw new Error(`Illegal SYM_COMBINE: donors must be equal and not tribun`);
      }
      if (donate > firstDonor.p) {
        throw new Error(`Illegal SYM_COMBINE: donation exceeds primary`);
      }
      
      // Create combined unit
      const newPrimary = donate * donorCids.length;
      const remaining = firstDonor.p - donate;
      if (!isValidHeightValue(newPrimary)) {
        throw new Error(`Illegal SYM_COMBINE: invalid resulting height`);
      }
      if (!isDonationRemainderValid(remaining, firstDonor.s)) {
        throw new Error(`Illegal SYM_COMBINE: donor remainder invalid`);
      }
      const combinedUnit: Unit = {
        color: state.turn,
        tribun: false,
        p: newPrimary as Height,
        s: 0,
      };
      newBoard[centerCid] = unitToUnitByte(combinedUnit);
      
      // Update donors
      for (const cid of donorCids) {
        const donor = unitByteToUnit(newBoard[cid])!;
        const newDonor: Unit = {
          ...donor,
          p: (donor.p - donate) as Height,
        };
        const normDonor = normalizeUnit(newDonor);
        newBoard[cid] = normDonor ? unitToUnitByte(normDonor) : 0;
      }
      break;
    }
    
    case 7: { // SPLIT
      const actorCid = fields.actorCid;
      const heights = [fields.h0, fields.h1, fields.h2, fields.h3, fields.h4, fields.h5];
      
      const actorUnit = unitByteToUnit(newBoard[actorCid]);
      if (!actorUnit || actorUnit.color !== state.turn || actorUnit.p === 0 || actorUnit.tribun) {
        throw new Error(`Illegal SPLIT: invalid actor`);
      }
      for (const h of heights) {
        if (h > 0 && ![1, 2, 3, 4, 6].includes(h)) {
          throw new Error(`Illegal SPLIT: invalid split height`);
        }
      }
      
      const totalSplit = heights.reduce((a, b) => a + b, 0);
      const remainder = actorUnit.p - totalSplit;
      if (remainder < 0) {
        throw new Error(`Illegal SPLIT: split exceeds primary`);
      }
      if (remainder > 0 && ![1, 2, 3, 4, 6, 8].includes(remainder)) {
        throw new Error(`Illegal SPLIT: invalid remainder height`);
      }
      if (remainder > 0 && actorUnit.s > 0 && (remainder > 4 || 2 * remainder < actorUnit.s)) {
        throw new Error(`Illegal SPLIT: remainder violates SP`);
      }
      
      // Get adjacent tiles
      const adjacentCids: (number | null)[] = [];
      for (let dir = 0; dir < 6; dir++) {
        adjacentCids.push(getNeighborCid(actorCid, dir));
      }
      
      // Place heights on adjacent tiles
      let placedCount = remainder > 0 ? 1 : 0; // Count origin if remainder > 0
      for (let i = 0; i < 6; i++) {
        if (heights[i] > 0) {
          const targetCid = adjacentCids[i];
          if (targetCid === null) {
            throw new Error(`Illegal SPLIT: invalid target position`);
          }
          const targetUnit = unitByteToUnit(newBoard[targetCid]);
          if (targetUnit !== null) {
            throw new Error(`Illegal SPLIT: target not empty`);
          }
          
          const splitUnit: Unit = {
            color: state.turn,
            tribun: false,
            p: heights[i] as Height,
            s: 0,
          };
          const normalized = normalizeUnit(splitUnit);
          if (!normalized || normalized.p === 0) {
            throw new Error(`Illegal SPLIT: invalid split height`);
          }
          newBoard[targetCid] = unitToUnitByte(normalized);
          placedCount++;
        }
      }
      
      if (placedCount < 2) {
        throw new Error(`Illegal SPLIT: must create at least 2 units`);
      }
      
      // Update origin
      if (remainder > 0) {
        const remainingUnit: Unit = {
          ...actorUnit,
          p: remainder as Height,
        };
        const normalized = normalizeUnit(remainingUnit);
        newBoard[actorCid] = normalized ? unitToUnitByte(normalized) : 0;
      } else {
        // Origin becomes empty or has secondary
        if (actorUnit.s > 0) {
          const remainingUnit: Unit = {
            color: actorUnit.color,
            tribun: false,
            p: 0,
            s: actorUnit.s,
          };
          const normalized = normalizeUnit(remainingUnit);
          newBoard[actorCid] = normalized ? unitToUnitByte(normalized) : 0;
        } else {
          newBoard[actorCid] = 0;
        }
      }
      break;
    }
    
    case 8: { // BACKSTABB
      const actorCid = fields.actorCid;
      const dir = fields.dir;
      
      const actorUnit = unitByteToUnit(newBoard[actorCid]);
      if (!actorUnit || actorUnit.color !== state.turn || actorUnit.s === 0) {
        throw new Error(`Illegal BACKSTABB: invalid actor`);
      }
      
      const targetCid = getNeighborCid(actorCid, dir);
      if (targetCid === null) {
        throw new Error(`Illegal BACKSTABB: invalid target position`);
      }
      const targetUnit = unitByteToUnit(newBoard[targetCid]);
      if (targetUnit !== null) {
        throw new Error(`Illegal BACKSTABB: target not empty`);
      }
      
      // Place primary on target, destroy secondary
      const newUnit: Unit = {
        color: actorUnit.color,
        tribun: actorUnit.tribun,
        p: actorUnit.p,
        s: 0,
      };
      newBoard[targetCid] = unitToUnitByte(newUnit);
      newBoard[actorCid] = 0;
      break;
    }
    
    case 9: { // ATTACK_TRIBUN
      const attackerCid = fields.attackerCid;
      const tribunCid = fields.tribunCid;
      const winnerColor = fields.winnerColor as Color;
      
      if (winnerColor !== state.turn) {
        throw new Error(`Illegal ATTACK_TRIBUN: winner must be current player`);
      }
      
      const attackerUnit = unitByteToUnit(newBoard[attackerCid]);
      const tribunUnit = unitByteToUnit(newBoard[tribunCid]);
      
      if (!attackerUnit || attackerUnit.color !== state.turn) {
        throw new Error(`Illegal ATTACK_TRIBUN: invalid attacker`);
      }
      if (!tribunUnit || !tribunUnit.tribun || tribunUnit.color === state.turn) {
        throw new Error(`Illegal ATTACK_TRIBUN: invalid tribun target`);
      }
      
      let canAttack = false;
      const primaryReachable = getAttackReachableTiles(
        attackerCid,
        attackerUnit.p,
        attackerUnit.color,
        attackerUnit.tribun,
        newBoard
      );
      if (primaryReachable.includes(tribunCid)) {
        canAttack = true;
      } else if (attackerUnit.s > 0) {
        const secondaryColor = getSecondaryPatternColor(attackerUnit.color, attackerUnit.s);
        const secondaryReachable = getAttackReachableTiles(
          attackerCid,
          attackerUnit.s,
          secondaryColor,
          false,
          newBoard
        );
        if (secondaryReachable.includes(tribunCid)) {
          canAttack = true;
        }
      }
      if (!canAttack) {
        throw new Error(`Illegal ATTACK_TRIBUN: attacker cannot attack tribun`);
      }
      
      // Game ends with winner
      newStatus = 'ended';
      newWinner = winnerColor;
      break;
    }
    
    case 10: { // DRAW
      const drawAction = fields.drawAction;
      const actorColor = fields.actorColor as Color;
      const currentOfferBy = newDrawOfferBy;
      newTurn = state.turn;
      
      if (drawAction === 0) {
        // Offer
        if (newDrawOfferBy !== null) {
          throw new Error(`Illegal DRAW offer: offer already active`);
        }
        if (newDrawOfferBlocked === actorColor) {
          throw new Error(`Illegal DRAW offer: actor is blocked`);
        }
        if (newDrawOfferBlocked !== null && newDrawOfferBlocked !== actorColor) {
          newDrawOfferBlocked = null;
        }
        newDrawOfferBy = actorColor;
      } else if (drawAction === 1) {
        // Retract
        if (newDrawOfferBy !== actorColor) {
          throw new Error(`Illegal DRAW retract: no active offer from actor`);
        }
        newDrawOfferBy = null;
      } else if (drawAction === 2) {
        // Accept - game ends as tie
        if (newDrawOfferBy !== null && newDrawOfferBy !== actorColor) {
          newStatus = 'ended';
          newWinner = null; // Tie
          newDrawOfferBy = null;
          newDrawOfferBlocked = null;
        } else {
          throw new Error(`Illegal DRAW accept: no active offer from opponent`);
        }
      } else if (drawAction === 3) {
        // Decline - remove offer and block rejected player
        if (currentOfferBy !== null && currentOfferBy !== actorColor) {
          newDrawOfferBy = null;
          newDrawOfferBlocked = currentOfferBy;
        } else {
          throw new Error(`Illegal DRAW decline: no active offer from opponent`);
        }
      }
      break;
    }
    
    case 11: { // END
      const endReason = fields.endReason;
      const loserColor = fields.loserColor as Color;
      newTurn = state.turn;
      
      newStatus = 'ended';
      if (endReason === 3) {
        // Timeout game tie
        newWinner = null;
      } else {
        // Resign, no-legal-moves, or timeout-player
        newWinner = loserColor === 0 ? 1 : 0;
      }
      newDrawOfferBy = null;
      newDrawOfferBlocked = null;
      break;
    }
    
    default:
      throw new Error(`Unknown opcode: ${op}`);
  }
  
  return {
    board: newBoard,
    turn: newTurn,
    ply: newPly,
    drawOfferBy: newDrawOfferBy,
    drawOfferBlocked: newDrawOfferBlocked,
    status: newStatus,
    winner: newWinner,
  };
}

// Default position setup
export interface DefaultPosition {
  black: {
    [unitType: string]: number[][];
  };
  white: {
    [unitType: string]: number[][];
  };
}

// Create initial board from default position
// Optionally accepts a custom position for debugging/testing special cases
// 
// Usage examples:
//   - Default: createInitialBoard() uses default-position.json
//   - Custom position: createInitialBoard({ black: { "1": [[0, 0]] }, white: { "1": [[1, 1]] } })
//   - 121-byte board: createInitialBoard(new Uint8Array(121).fill(...))
//   - Base64 string: createInitialBoard("base64encodedstring...")
//   - For quick debugging, you can also directly edit default-position.json
export function createInitialBoard(
  customInput?: DefaultPosition | Uint8Array | string
): Uint8Array {
  // If no input provided, use default position
  if (!customInput) {
    return createInitialBoardFromPosition(defaultPosition);
  }
  
  // If input is a string, assume it's base64 encoded board
  if (typeof customInput === "string") {
    const board = unpackBoard(customInput);
    if (board.length !== 121) {
      throw new Error(`Board must be exactly 121 bytes, got ${board.length}`);
    }
    return board;
  }
  
  // If input is a Uint8Array, validate and return it
  if (customInput instanceof Uint8Array) {
    if (customInput.length !== 121) {
      throw new Error(`Board must be exactly 121 bytes, got ${customInput.length}`);
    }
    return new Uint8Array(customInput); // Return a copy
  }
  
  // Otherwise, treat as DefaultPosition object
  return createInitialBoardFromPosition(customInput);
}

// Helper function to create board from position object
function createInitialBoardFromPosition(position: DefaultPosition): Uint8Array {
  const board = new Uint8Array(121);
  
  // Place black units
  for (const [unitType, coords] of Object.entries(position.black)) {
    const height = unitType === "t1" ? 1 : parseInt(unitType);
    const isTribun = unitType === "t1";
    
    for (const [x, y] of coords) {
      const cid = encodeCoord(x, y);
      const unit: Unit = {
        color: 0, // black
        tribun: isTribun,
        p: height as Height,
        s: 0,
      };
      board[cid] = unitToUnitByte(unit);
    }
  }
  
  // Place white units
  for (const [unitType, coords] of Object.entries(position.white)) {
    const height = unitType === "t1" ? 1 : parseInt(unitType);
    const isTribun = unitType === "t1";
    
    for (const [x, y] of coords) {
      const cid = encodeCoord(x, y);
      const unit: Unit = {
        color: 1, // white
        tribun: isTribun,
        p: height as Height,
        s: 0,
      };
      board[cid] = unitToUnitByte(unit);
    }
  }
  
  return board;
}

// Export default position
export { defaultPosition };

// Helper function to create board from CID-based unit specifications
// Useful for debugging/testing specific positions
// 
// Example usage:
//   createInitialBoardFromCids({
//     "wt1": [0],           // white tribun (p=1, s=0)
//     "w1": [1, 11, 12],     // white p=1, s=0
//     "b2": [69, 79],        // black p=2, s=0
//     "b24": [51],           // black p=2, s=4
//     "bt4": [28]            // black tribun (p=4, s=0)
//   })
//
// Unit format: (b|w)t?\d\d?
//   - (b|w): color - "b" (black) or "w" (white)
//   - t?: optional tribun marker
//   - \d: primary height (required)
//   - \d?: secondary height (optional, defaults to 0)
// Examples:
//   - "b1" = black, p=1, s=0
//   - "b12" = black, p=1, s=2
//   - "bt1" = black tribun, p=1, s=0
//   - "bt12" = black tribun, p=1, s=2
//   - "w4" = white, p=4, s=0
//   - "wt4" = white tribun, p=4, s=0
//   - "w48" = white, p=4, s=8
export function createInitialBoardFromCids(
  units: Record<string, number[]>
): Uint8Array {
  const board = new Uint8Array(121);
  const validHeights: Height[] = [0, 1, 2, 3, 4, 6, 8];
  
  // Helper to round height to nearest valid height
  const roundHeight = (h: number): Height => {
    if (validHeights.includes(h as Height)) {
      return h as Height;
    }
    // Find closest valid height (round down)
    const validHeight = validHeights.reduce((prev, curr) => 
      curr <= h && curr > prev ? curr : prev, 0
    );
    if (validHeight === 0 && h > 0) {
      return 8; // Use max valid height if can't round down
    }
    return validHeight as Height;
  };
  
  for (const [unitSpec, cids] of Object.entries(units)) {
    // Parse unit specification: format is (b|w)t?\d\d?
    // Examples: "b1", "b12", "bt1", "bt12", "w4", "wt4", "w48"
    const match = unitSpec.match(/^(b|w)(t?)(\d)(\d?)$/);
    if (!match) {
      throw new Error(`Invalid unit specification: ${unitSpec}. Expected format: "b1", "b12", "bt1", "bt12", "w4", "wt4", etc.`);
    }
    
    const color = match[1] === "w" ? 1 : 0; // white=1, black=0
    const isTribun = match[2] === "t"; // tribun if "t" is present
    const primaryDigit = match[3]; // first digit (primary height)
    const secondaryDigit = match[4] || ""; // optional second digit (secondary height)
    
    const p = roundHeight(parseInt(primaryDigit, 10));
    const s = secondaryDigit ? roundHeight(parseInt(secondaryDigit, 10)) : 0;
    
    // Place units at specified CIDs
    for (const cid of cids) {
      if (cid < 0 || cid > 120) {
        throw new Error(`Invalid CID: ${cid}. Must be between 0 and 120.`);
      }
      
      const unit: Unit = {
        color: color as Color,
        tribun: isTribun,
        p: p,
        s: s,
      };
      board[cid] = unitToUnitByte(unit);
    }
  }
  
  return board;
}

// Export UI backend functions
export * from './ui-backend';
