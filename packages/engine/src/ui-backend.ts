/**
 * UI Backend - State Machine Support
 * 
 * This module provides the backend logic for the tile-click UI finite state machine
 * described in docs/ui/01-fsm-overview.md and docs/ui/02-fsm-state-details.md.
 * 
 * The UI needs:
 * - Legal moves grouped by target/origin for efficient UI state management
 * - Clickable tiles for each UI state
 * - Options for each UI state (damage amounts, move patterns, etc.)
 * - Validation of UI selections against legal moves
 */

import {
  State,
  Unit,
  Color,
  generateLegalActions,
  decodeAction,
  unitByteToUnit,
  decodeCoord,
  encodeCoord,
  onBoard,
} from './index';

// Neighbor vectors (same as in index.ts)
const NEIGHBOR_VECTORS = [
  [1, 1],   // 0: up
  [1, 0],   // 1: left-up
  [0, 1],   // 2: right-up
  [-1, -1], // 3: down
  [-1, 0],  // 4: right-down
  [0, -1],  // 5: left-down
];

/**
 * Get neighbor cid in given direction
 */
function getNeighborCid(centerCid: number, dir: number): number | null {
  try {
    const { x, y } = decodeCoord(centerCid);
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

/**
 * UI State Types
 */
export type UIState = 
  | { type: 'idle' }
  | { type: 'enemy'; targetCid: number; optionIndex: number }
  | { type: 'empty'; centerCid: number; donors: Map<number, number>; optionIndex: number }
  | { type: 'own_primary'; originCid: number; targetCid: number | null; optionIndex: number }
  | { type: 'own_secondary'; originCid: number; allocations: number[] };

/**
 * Grouped legal moves for UI consumption
 */
export interface GroupedLegalMoves {
  // Set of all legal action words (for validation)
  legalSet: Set<number>;
  
  // Idle state: clickable tiles
  idleClickable: {
    enemy: number[];      // Enemy tiles with attack options
    empty: number[];       // Empty tiles with combine/sym-combine options
    own: number[];         // Own tiles with primary/secondary options
  };
  
  // Enemy state: options grouped by target
  enemyOptions: Map<number, number[]>;  // targetCid -> [action words for damage/liberate]
  
  // Empty state: combine options grouped by center
  emptyOptions: Map<number, {
    combine2: Array<{ dirA: number; dirB: number; donateA: number; donateB: number; action: number }>;
    sym3: Array<{ config: 0 | 1 | 2; donate: number; action: number }>;
    sym6: Array<{ donate: number; action: number }>;
  }>;
  
  // Own.Primary: options grouped by origin
  ownPrimaryOptions: Map<number, {
    moves: Array<{ toCid: number; part: 0 | 1; action: number }>;
    kills: Array<{ targetCid: number; part: 0 | 1; action: number }>;
    enslaves: Array<{ targetCid: number; action: number }>;
    tribunAttack: Array<{ tribunCid: number; action: number }>;
  }>;
  
  // Own.Secondary: split/backstabb options grouped by origin
  ownSecondaryOptions: Map<number, {
    splits: Array<{ heights: number[]; action: number }>;
    backstabbs: Array<{ dir: number; action: number }>;
  }>;
}

/**
 * Build grouped legal moves from state
 */
export function buildGroupedLegalMoves(state: State): GroupedLegalMoves {
  const legalActions = generateLegalActions(state);
  const legalSet = new Set(Array.from(legalActions));
  
  const idleClickable = {
    enemy: [] as number[],
    empty: [] as number[],
    own: [] as number[],
  };
  
  const enemyOptions = new Map<number, number[]>();
  const emptyOptions = new Map<number, {
    combine2: Array<{ dirA: number; dirB: number; donateA: number; donateB: number; action: number }>;
    sym3: Array<{ config: 0 | 1 | 2; donate: number; action: number }>;
    sym6: Array<{ donate: number; action: number }>;
  }>();
  const ownPrimaryOptions = new Map<number, {
    moves: Array<{ toCid: number; part: 0 | 1; action: number }>;
    kills: Array<{ targetCid: number; part: 0 | 1; action: number }>;
    enslaves: Array<{ targetCid: number; action: number }>;
    tribunAttack: Array<{ tribunCid: number; action: number }>;
  }>();
  const ownSecondaryOptions = new Map<number, {
    splits: Array<{ heights: number[]; action: number }>;
    backstabbs: Array<{ dir: number; action: number }>;
  }>();
  
  // Track which tiles are clickable in Idle
  const enemyTargets = new Set<number>();
  const emptyCenters = new Set<number>();
  const ownOrigins = new Set<number>();
  
  for (const action of legalActions) {
    const { opcode, fields } = decodeAction(action);
    
    switch (opcode) {
      case 0: { // MOVE
        const fromCid = fields.fromCid;
        ownOrigins.add(fromCid);
        if (!ownPrimaryOptions.has(fromCid)) {
          ownPrimaryOptions.set(fromCid, { moves: [], kills: [], enslaves: [], tribunAttack: [] });
        }
        ownPrimaryOptions.get(fromCid)!.moves.push({
          toCid: fields.toCid,
          part: fields.part as 0 | 1,
          action,
        });
        break;
      }
      
      case 1: { // KILL
        const attackerCid = fields.attackerCid;
        const targetCid = fields.targetCid;
        ownOrigins.add(attackerCid);
        enemyTargets.add(targetCid);
        if (!ownPrimaryOptions.has(attackerCid)) {
          ownPrimaryOptions.set(attackerCid, { moves: [], kills: [], enslaves: [], tribunAttack: [] });
        }
        ownPrimaryOptions.get(attackerCid)!.kills.push({
          targetCid,
          part: fields.part as 0 | 1,
          action,
        });
        break;
      }
      
      case 2: { // LIBERATE
        const targetCid = fields.targetCid;
        enemyTargets.add(targetCid);
        if (!enemyOptions.has(targetCid)) {
          enemyOptions.set(targetCid, []);
        }
        enemyOptions.get(targetCid)!.push(action);
        break;
      }
      
      case 3: { // DAMAGE
        const targetCid = fields.targetCid;
        enemyTargets.add(targetCid);
        if (!enemyOptions.has(targetCid)) {
          enemyOptions.set(targetCid, []);
        }
        enemyOptions.get(targetCid)!.push(action);
        break;
      }
      
      case 4: { // ENSLAVE
        const attackerCid = fields.attackerCid;
        const targetCid = fields.targetCid;
        ownOrigins.add(attackerCid);
        enemyTargets.add(targetCid);
        if (!ownPrimaryOptions.has(attackerCid)) {
          ownPrimaryOptions.set(attackerCid, { moves: [], kills: [], enslaves: [], tribunAttack: [] });
        }
        ownPrimaryOptions.get(attackerCid)!.enslaves.push({
          targetCid,
          action,
        });
        break;
      }
      
      case 5: { // COMBINE
        const centerCid = fields.centerCid;
        emptyCenters.add(centerCid);
        if (!emptyOptions.has(centerCid)) {
          emptyOptions.set(centerCid, { combine2: [], sym3: [], sym6: [] });
        }
        emptyOptions.get(centerCid)!.combine2.push({
          dirA: fields.dirA,
          dirB: fields.dirB,
          donateA: fields.donateA,
          donateB: fields.donateB,
          action,
        });
        break;
      }
      
      case 6: { // SYM_COMBINE
        const centerCid = fields.centerCid;
        const config = fields.config;
        emptyCenters.add(centerCid);
        if (!emptyOptions.has(centerCid)) {
          emptyOptions.set(centerCid, { combine2: [], sym3: [], sym6: [] });
        }
        if (config === 0) {
          emptyOptions.get(centerCid)!.sym6.push({
            donate: fields.donate,
            action,
          });
        } else {
          emptyOptions.get(centerCid)!.sym3.push({
            config: config as 0 | 1 | 2,
            donate: fields.donate,
            action,
          });
        }
        break;
      }
      
      case 7: { // SPLIT
        const actorCid = fields.actorCid;
        ownOrigins.add(actorCid);
        if (!ownSecondaryOptions.has(actorCid)) {
          ownSecondaryOptions.set(actorCid, { splits: [], backstabbs: [] });
        }
        ownSecondaryOptions.get(actorCid)!.splits.push({
          heights: [fields.h0, fields.h1, fields.h2, fields.h3, fields.h4, fields.h5],
          action,
        });
        break;
      }
      
      case 8: { // BACKSTABB
        const actorCid = fields.actorCid;
        ownOrigins.add(actorCid);
        if (!ownSecondaryOptions.has(actorCid)) {
          ownSecondaryOptions.set(actorCid, { splits: [], backstabbs: [] });
        }
        ownSecondaryOptions.get(actorCid)!.backstabbs.push({
          dir: fields.dir,
          action,
        });
        break;
      }
      
      case 9: { // ATTACK_TRIBUN
        const attackerCid = fields.attackerCid;
        const tribunCid = fields.tribunCid;
        ownOrigins.add(attackerCid);
        enemyTargets.add(tribunCid);
        if (!ownPrimaryOptions.has(attackerCid)) {
          ownPrimaryOptions.set(attackerCid, { moves: [], kills: [], enslaves: [], tribunAttack: [] });
        }
        ownPrimaryOptions.get(attackerCid)!.tribunAttack.push({
          tribunCid,
          action,
        });
        break;
      }
    }
  }
  
  // Build idle clickable sets
  idleClickable.enemy = Array.from(enemyTargets);
  idleClickable.empty = Array.from(emptyCenters);
  idleClickable.own = Array.from(ownOrigins);
  
  // Sort enemy options by effective damage (ascending)
  for (const [targetCid, actions] of enemyOptions.entries()) {
    const sorted = actions.slice().sort((a, b) => {
      const aDec = decodeAction(a);
      const bDec = decodeAction(b);
      if (aDec.opcode === 2) return 1; // LIBERATE comes last
      if (bDec.opcode === 2) return -1;
      if (aDec.opcode === 3 && bDec.opcode === 3) {
        return aDec.fields.effectiveDamage - bDec.fields.effectiveDamage;
      }
      return 0;
    });
    enemyOptions.set(targetCid, sorted);
  }
  
  return {
    legalSet,
    idleClickable,
    enemyOptions,
    emptyOptions,
    ownPrimaryOptions,
    ownSecondaryOptions,
  };
}

/**
 * Get clickable tiles for current UI state
 */
export function getClickableTiles(
  state: State,
  uiState: UIState,
  grouped: GroupedLegalMoves
): number[] {
  switch (uiState.type) {
    case 'idle':
      return [
        ...grouped.idleClickable.enemy,
        ...grouped.idleClickable.empty,
        ...grouped.idleClickable.own,
      ];
    
    case 'enemy':
      return [uiState.targetCid];
    
    case 'empty':
      const centerCid = uiState.centerCid;
      const clickable = [centerCid];
      const emptyOpts = grouped.emptyOptions.get(centerCid);
      if (emptyOpts) {
        // Add all donor positions
        const donorCids = new Set<number>();
        for (const combine of emptyOpts.combine2) {
          const dirA = getNeighborCid(centerCid, combine.dirA);
          const dirB = getNeighborCid(centerCid, combine.dirB);
          if (dirA !== null) donorCids.add(dirA);
          if (dirB !== null) donorCids.add(dirB);
        }
        for (const sym of emptyOpts.sym3) {
          const dirs = sym.config === 1 ? [0, 4, 5] : [3, 1, 2];
          for (const dir of dirs) {
            const cid = getNeighborCid(centerCid, dir);
            if (cid !== null) donorCids.add(cid);
          }
        }
        for (const sym of emptyOpts.sym6) {
          for (let dir = 0; dir < 6; dir++) {
            const cid = getNeighborCid(centerCid, dir);
            if (cid !== null) donorCids.add(cid);
          }
        }
        clickable.push(...Array.from(donorCids));
      }
      return clickable;
    
    case 'own_primary':
      const originCid = uiState.originCid;
      const primaryOpts = grouped.ownPrimaryOptions.get(originCid);
      const clickablePrimary = [originCid];
      if (primaryOpts) {
        for (const move of primaryOpts.moves) {
          clickablePrimary.push(move.toCid);
        }
        for (const kill of primaryOpts.kills) {
          clickablePrimary.push(kill.targetCid);
        }
        for (const enslave of primaryOpts.enslaves) {
          clickablePrimary.push(enslave.targetCid);
        }
        for (const tribun of primaryOpts.tribunAttack) {
          clickablePrimary.push(tribun.tribunCid);
        }
      }
      return Array.from(new Set(clickablePrimary));
    
    case 'own_secondary':
      const originCid2 = uiState.originCid;
      const secondaryClickable = [originCid2];
      // Add adjacent empty tiles
      for (let dir = 0; dir < 6; dir++) {
        const neighborCid = getNeighborCid(originCid2, dir);
        if (neighborCid !== null) {
          const unit = unitByteToUnit(state.board[neighborCid]);
          if (unit === null) {
            secondaryClickable.push(neighborCid);
          }
        }
      }
      return secondaryClickable;
  }
}

/**
 * Get options for Enemy state
 */
export function getEnemyOptions(
  targetCid: number,
  grouped: GroupedLegalMoves
): number[] {
  return grouped.enemyOptions.get(targetCid) || [];
}

/**
 * Get options for Own.Primary state
 */
export function getOwnPrimaryOptions(
  originCid: number,
  targetCid: number | null,
  grouped: GroupedLegalMoves
): number[] {
  const primaryOpts = grouped.ownPrimaryOptions.get(originCid);
  if (!primaryOpts) return [];
  
  if (targetCid === null) {
    // No target selected - return empty (UI should show highlighted tiles)
    return [];
  }
  
  const options: number[] = [];
  
  // Check if target is empty (MOVE options)
  const moves = primaryOpts.moves.filter(m => m.toCid === targetCid);
  for (const move of moves) {
    options.push(move.action);
  }
  
  // Check if target is enemy non-tribun (KILL/ENSLAVE options)
  const kills = primaryOpts.kills.filter(k => k.targetCid === targetCid);
  for (const kill of kills) {
    options.push(kill.action);
  }
  const enslaves = primaryOpts.enslaves.filter(e => e.targetCid === targetCid);
  for (const enslave of enslaves) {
    options.push(enslave.action);
  }
  
  // Check if target is enemy tribun (ATTACK_TRIBUN)
  const tribunAttacks = primaryOpts.tribunAttack.filter(t => t.tribunCid === targetCid);
  for (const attack of tribunAttacks) {
    options.push(attack.action);
  }
  
  // Sort: secondary pattern first, then primary pattern
  return options.sort((a, b) => {
    const aDec = decodeAction(a);
    const bDec = decodeAction(b);
    if (aDec.opcode === 0 && bDec.opcode === 0) {
      // MOVE: secondary (part=1) before primary (part=0)
      return bDec.fields.part - aDec.fields.part;
    }
    if (aDec.opcode === 1 && bDec.opcode === 1) {
      // KILL: secondary (part=1) before primary (part=0)
      return bDec.fields.part - aDec.fields.part;
    }
    // ENSLAVE comes after KILL
    if (aDec.opcode === 4) return 1;
    if (bDec.opcode === 4) return -1;
    return 0;
  });
}

/**
 * Get highlighted target tiles for Own.Primary state
 */
export function getOwnPrimaryHighlightedTiles(
  originCid: number,
  grouped: GroupedLegalMoves
): number[] {
  const primaryOpts = grouped.ownPrimaryOptions.get(originCid);
  if (!primaryOpts) return [];
  
  const highlighted = new Set<number>();
  for (const move of primaryOpts.moves) {
    highlighted.add(move.toCid);
  }
  for (const kill of primaryOpts.kills) {
    highlighted.add(kill.targetCid);
  }
  for (const enslave of primaryOpts.enslaves) {
    highlighted.add(enslave.targetCid);
  }
  for (const tribun of primaryOpts.tribunAttack) {
    highlighted.add(tribun.tribunCid);
  }
  return Array.from(highlighted);
}

/**
 * Validate and get pending action for Own.Secondary state
 */
export function getOwnSecondaryPendingAction(
  originCid: number,
  allocations: number[],
  grouped: GroupedLegalMoves,
  state: State
): number | null {
  const secondaryOpts = grouped.ownSecondaryOptions.get(originCid);
  if (!secondaryOpts) return null;
  
  const originUnit = unitByteToUnit(state.board[originCid]);
  if (!originUnit) return null;
  
  const H0 = originUnit.p;
  const totalAllocated = allocations.reduce((a, b) => a + b, 0);
  
  // Check for BACKSTABB: full primary to exactly one neighbor
  if (totalAllocated === H0 && originUnit.s > 0) {
    const nonzeroCount = allocations.filter(a => a > 0).length;
    if (nonzeroCount === 1) {
      const dir = allocations.findIndex(a => a > 0);
      const backstabb = secondaryOpts.backstabbs.find(b => b.dir === dir);
      if (backstabb && grouped.legalSet.has(backstabb.action)) {
        return backstabb.action;
      }
    }
  }
  
  // Check for SPLIT
  // Validate all allocations are valid (0-7, and valid heights)
  const validHeights = [0, 1, 2, 3, 4, 6, 8];
  for (let i = 0; i < 6; i++) {
    if (allocations[i] > 7) return null; // SPLIT can't encode 8
    if (allocations[i] > 0 && !validHeights.includes(allocations[i])) {
      return null;
    }
  }
  
  // Find matching SPLIT action
  for (const split of secondaryOpts.splits) {
    if (split.heights.length === 6) {
      let matches = true;
      for (let i = 0; i < 6; i++) {
        if (split.heights[i] !== allocations[i]) {
          matches = false;
          break;
        }
      }
      if (matches && grouped.legalSet.has(split.action)) {
        return split.action;
      }
    }
  }
  
  return null;
}

/**
 * Get allowed allocation values for a neighbor in Own.Secondary state
 */
export function getAllowedAllocationValues(
  originCid: number,
  neighborDir: number,
  allocations: number[],
  state: State
): number[] {
  const originUnit = unitByteToUnit(state.board[originCid]);
  if (!originUnit) return [0];
  
  const H0 = originUnit.p;
  const remAfterOthers = H0 - allocations.reduce((sum, val, idx) => 
    idx !== neighborDir ? sum + val : sum, 0);
  
  const validHeights = [1, 2, 3, 4, 6, 8];
  const allowed = [0];
  
  for (const h of validHeights) {
    if (h <= remAfterOthers) {
      allowed.push(h);
    }
  }
  
  return allowed;
}

/**
 * Get Empty state options based on current donor selections
 * 
 * @param centerCid - The empty center tile
 * @param donors - Map of donor cid -> displayed primary (Hdisp)
 * @param state - Current game state (needed to get actual primary heights)
 * @param grouped - Grouped legal moves
 */
export function getEmptyStateOptions(
  centerCid: number,
  donors: Map<number, number>, // cid -> displayed primary (Hdisp)
  state: State,
  grouped: GroupedLegalMoves
): number[] {
  const emptyOpts = grouped.emptyOptions.get(centerCid);
  if (!emptyOpts) return [];
  
  const options: number[] = [];
  const participatingDonors = Array.from(donors.entries()).filter(([cid, hDisp]) => {
    const unit = unitByteToUnit(state.board[cid]);
    if (!unit) return false;
    const donate = unit.p - hDisp; // Actual donation amount
    return donate > 0;
  });
  
  if (participatingDonors.length === 2) {
    // 2-donor combine
    const [cidA, hDispA] = participatingDonors[0];
    const [cidB, hDispB] = participatingDonors[1];
    const unitA = unitByteToUnit(state.board[cidA]);
    const unitB = unitByteToUnit(state.board[cidB]);
    if (!unitA || !unitB) return [];
    
    const donateA = unitA.p - hDispA;
    const donateB = unitB.p - hDispB;
    
    // Find direction indices
    let dirA = -1, dirB = -1;
    for (let dir = 0; dir < 6; dir++) {
      const neighborCid = getNeighborCid(centerCid, dir);
      if (neighborCid === cidA) dirA = dir;
      if (neighborCid === cidB) dirB = dir;
    }
    
    if (dirA >= 0 && dirB >= 0) {
      for (const combine of emptyOpts.combine2) {
        if ((combine.dirA === dirA && combine.dirB === dirB) ||
            (combine.dirA === dirB && combine.dirB === dirA)) {
          if (combine.donateA === donateA && combine.donateB === donateB) {
            options.push(combine.action);
          }
        }
      }
    }
  } else if (participatingDonors.length === 3) {
    // Check for sym3
    const dirs = participatingDonors.map(([cid]) => {
      for (let dir = 0; dir < 6; dir++) {
        if (getNeighborCid(centerCid, dir) === cid) return dir;
      }
      return -1;
    }).filter(d => d >= 0);
    
    if (dirs.length === 3) {
      // Check if sym3 configuration
      const dirSet = new Set(dirs);
      const sym3Config1 = new Set([0, 4, 5]);
      const sym3Config2 = new Set([3, 1, 2]);

      const isSym3Config1 = dirSet.size === 3 && dirs.every(d => sym3Config1.has(d));
      const isSym3Config2 = dirSet.size === 3 && dirs.every(d => sym3Config2.has(d));
      
      if (isSym3Config1 || isSym3Config2) {
        const config: 0 | 1 | 2 = isSym3Config1 ? 1 : 2;
        const [cid0] = participatingDonors[0];
        const unit0 = unitByteToUnit(state.board[cid0]);
        if (unit0) {
          const hDisp0 = participatingDonors[0][1];
          const donate = unit0.p - hDisp0;
          for (const sym of emptyOpts.sym3) {
            if (sym.config === config && sym.donate === donate) {
              options.push(sym.action);
            }
          }
        }
      }
    }
  } else if (participatingDonors.length === 6) {
    // Check for sym6 (all 6 neighbors)
    const [cid0] = participatingDonors[0];
    const unit0 = unitByteToUnit(state.board[cid0]);
    if (unit0) {
      const hDisp0 = participatingDonors[0][1];
      const donate = unit0.p - hDisp0;
      for (const sym of emptyOpts.sym6) {
        if (sym.donate === donate) {
          options.push(sym.action);
        }
      }
    }
  }
  
  return options;
}

/**
 * Validate that an action word is legal
 */
export function isActionLegal(action: number, grouped: GroupedLegalMoves): boolean {
  return grouped.legalSet.has(action);
}

/**
 * Get donor information for Empty state
 * Returns map of neighbor cid -> { actualPrimary, isTribun }
 */
export function getEmptyStateDonors(
  centerCid: number,
  state: State
): Map<number, { actualPrimary: number; isTribun: boolean }> {
  const donors = new Map<number, { actualPrimary: number; isTribun: boolean }>();
  
  for (let dir = 0; dir < 6; dir++) {
    const neighborCid = getNeighborCid(centerCid, dir);
    if (neighborCid !== null) {
      const unit = unitByteToUnit(state.board[neighborCid]);
      if (unit && unit.color === state.turn && unit.p > 0) {
        donors.set(neighborCid, {
          actualPrimary: unit.p,
          isTribun: unit.tribun,
        });
      }
    }
  }
  
  return donors;
}

/**
 * Determine which UI state a tile click should enter from Idle
 */
export function getTileClickState(
  cid: number,
  state: State,
  grouped: GroupedLegalMoves
): UIState | null {
  const unit = unitByteToUnit(state.board[cid]);
  
  if (!unit) {
    // Empty tile - check if it has combine options
    if (grouped.idleClickable.empty.includes(cid)) {
      return { type: 'empty', centerCid: cid, donors: new Map(), optionIndex: 0 };
    }
    return null;
  }
  
  if (unit.color !== state.turn) {
    // Enemy tile - check if it has attack options
    if (grouped.idleClickable.enemy.includes(cid)) {
      const options = getEnemyOptions(cid, grouped);
      return { type: 'enemy', targetCid: cid, optionIndex: 0 };
    }
    return null;
  }
  
  // Own tile - check if it has primary or secondary options
  if (grouped.idleClickable.own.includes(cid)) {
    const primaryOpts = grouped.ownPrimaryOptions.get(cid);
    const secondaryOpts = grouped.ownSecondaryOptions.get(cid);
    
    // Prefer primary if available, otherwise secondary
    if (primaryOpts && (primaryOpts.moves.length > 0 || primaryOpts.kills.length > 0 || 
        primaryOpts.enslaves.length > 0 || primaryOpts.tribunAttack.length > 0)) {
      return { type: 'own_primary', originCid: cid, targetCid: null, optionIndex: 0 };
    } else if (secondaryOpts && (secondaryOpts.splits.length > 0 || secondaryOpts.backstabbs.length > 0)) {
      return { type: 'own_secondary', originCid: cid, allocations: [0, 0, 0, 0, 0, 0] };
    }
  }
  
  return null;
}

/**
 * Get valid donation values for a donor in Empty state
 * For non-tribun: {0} U {donations that leave a valid remainder}
 * For tribun: {0, actualPrimary} only
 */
export function getValidDonationValues(
  donorCid: number,
  state: State
): number[] {
  const unit = unitByteToUnit(state.board[donorCid]);
  if (!unit) return [0];
  
  const validRemainders = new Set([0, 1, 2, 3, 4, 6, 8]);
  const allowed = [0];
  const maxDonate = Math.min(unit.p, 8);
  for (let donate = 1; donate <= maxDonate; donate++) {
    if (unit.tribun && donate !== unit.p) continue;
    const remaining = unit.p - donate;
    if (!validRemainders.has(remaining)) continue;
    if (remaining > 0 && unit.s > 0 && (remaining > 4 || 2 * remaining < unit.s)) continue;
    allowed.push(donate);
  }
  
  return allowed;
}
