/**
 * UI Move Cache Builder
 * 
 * Builds per-tile caches by enumerating candidate actions and testing
 * them against a Bloom filter validator. This allows the UI to work
 * without downloading the full legal move list.
 */

import * as engine from '@tribunplay/engine';
import type { LegalBloomValidator } from '../../net/LegalBloom';
import type { UiMoveCache } from './UiMoveCache';
import type {
  EnemyTileCache,
  OwnPrimaryTileCache,
  OwnPrimaryTargetOptions,
  OwnSecondaryTileCache,
  SplitAllocationCache,
  EmptyTileCache,
  DonorRuleCache,
  Cid,
} from './types';

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
    const { x, y } = engine.decodeCoord(centerCid);
    const [dx, dy] = NEIGHBOR_VECTORS[dir];
    const nx = x + dx;
    const ny = y + dy;
    if (engine.onBoard(nx, ny)) {
      return engine.encodeCoord(nx, ny);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Get reachable tiles for a movement pattern (reuse engine logic)
 * This is a simplified version that matches the engine's getReachableTiles
 */
function getReachableTiles(
  fromCid: number,
  height: engine.Height,
  color: engine.Color,
  isTribun: boolean,
  board: Uint8Array,
  forAttack: boolean = false
): number[] {
  const { x, y } = engine.decodeCoord(fromCid);
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
      // Height 1: color-dependent
      const offsets = color === 0 ? [[1, 1]] : [[-1, -1]];
      if (forAttack) {
        const attackOffsets = color === 0 ? [[1, 0], [0, 1]] : [[-1, 0], [0, -1]];
        for (const [dx, dy] of attackOffsets) {
          try {
            reachable.push(engine.encodeCoord(x + dx, y + dy));
          } catch {}
        }
      } else {
        for (const [dx, dy] of offsets) {
          try {
            reachable.push(engine.encodeCoord(x + dx, y + dy));
          } catch {}
        }
      }
    }
  } else if (height === 2) {
    const offsets = [[1, 2], [-1, 1], [2, 1], [-1, -2], [1, -1], [-2, -1]];
    for (const [dx, dy] of offsets) {
      try {
        reachable.push(engine.encodeCoord(x + dx, y + dy));
      } catch {}
    }
  } else if (height === 3) {
    const offsets = [
      [3, 2], [2, 3], [1, 3], [3, 1], [-1, 2], [2, -1],
      [-3, -2], [-2, -3], [-1, -3], [-3, -1], [1, -2], [-2, 1],
    ];
    for (const [dx, dy] of offsets) {
      try {
        reachable.push(engine.encodeCoord(x + dx, y + dy));
      } catch {}
    }
  } else if (height === 4) {
    // Sliding: use height 2 offsets as direction vectors
    const dirVectors = [[1, 2], [-1, 1], [2, 1], [-1, -2], [1, -1], [-2, -1]];
    for (const [vx, vy] of dirVectors) {
      let step = 1;
      while (true) {
        try {
          const nx = x + vx * step;
          const ny = y + vy * step;
          const cid = engine.encodeCoord(nx, ny);
          const unit = engine.unitByteToUnit(board[cid]);
          
          if (forAttack) {
            if (unit !== null) {
              reachable.push(cid);
              break;
            }
          } else {
            if (unit !== null) break;
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
      // Expand t1 adjacency outward until the nearest units are found
      const visited = new Set<number>();
      const queue: Array<{ cid: number; dist: number }> = [];
      let foundDist: number | null = null;
      
      for (let dir = 0; dir < 6; dir++) {
        const neighborCid = getNeighborCid(fromCid, dir);
        if (neighborCid !== null) {
          queue.push({ cid: neighborCid, dist: 1 });
        }
      }
      
      while (queue.length > 0) {
        const { cid: currentCid, dist } = queue.shift()!;
        if (visited.has(currentCid)) continue;
        visited.add(currentCid);
        
        if (foundDist !== null && dist > foundDist) break;
        
        const unit = engine.unitByteToUnit(board[currentCid]);
        if (unit !== null) {
          if (foundDist === null) {
            foundDist = dist;
          }
          if (dist === foundDist) {
            reachable.push(currentCid);
          }
          continue;
        }
        
        if (foundDist === null) {
          for (let dir = 0; dir < 6; dir++) {
            const neighborCid = getNeighborCid(currentCid, dir);
            if (neighborCid !== null && !visited.has(neighborCid)) {
              queue.push({ cid: neighborCid, dist: dist + 1 });
            }
          }
        }
      }
    } else {
      // Height 6 move: same as height 4
      const dirVectors = [[1, 2], [-1, 1], [2, 1], [-1, -2], [1, -1], [-2, -1]];
      for (const [vx, vy] of dirVectors) {
        let step = 1;
        while (true) {
          try {
            const nx = x + vx * step;
            const ny = y + vy * step;
            const cid = engine.encodeCoord(nx, ny);
            const unit = engine.unitByteToUnit(board[cid]);
            if (unit !== null) break;
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
    for (let dir = 0; dir < 6; dir++) {
      const cid = getNeighborCid(fromCid, dir);
      if (cid !== null) reachable.push(cid);
    }
    
    // Jump moves
    for (let i = 0; i < 6; i++) {
      const [dx, dy] = NEIGHBOR_VECTORS[i];
      try {
        const midCid = engine.encodeCoord(x + dx, y + dy);
        const midUnit = engine.unitByteToUnit(board[midCid]);
        if (midUnit === null || midUnit.color === color) {
          const jumpCid = engine.encodeCoord(x + dx * 2, y + dy * 2);
          reachable.push(jumpCid);
        }
      } catch {}
    }
  }

  return reachable;
}

/**
 * Get attack reachable tiles (height 8 attacks as height 2)
 */
function getAttackReachableTiles(
  fromCid: number,
  height: engine.Height,
  color: engine.Color,
  isTribun: boolean,
  board: Uint8Array
): number[] {
  if (height === 8) {
    const { x, y } = engine.decodeCoord(fromCid);
    const offsets = [[1, 2], [-1, 1], [2, 1], [-1, -2], [1, -1], [-2, -1]];
    const reachable = new Set<number>();
    for (const [dx, dy] of offsets) {
      try {
        reachable.add(engine.encodeCoord(x + dx, y + dy));
      } catch {}
    }
    
    const moveLike = getReachableTiles(fromCid, height, color, isTribun, board, false);
    for (const cid of moveLike) {
      reachable.add(cid);
    }
    
    return Array.from(reachable);
  }
  return getReachableTiles(fromCid, height, color, isTribun, board, true);
}

/**
 * Build UI move cache from state and validator
 */
export function buildCache(
  state: engine.State,
  validator: LegalBloomValidator
): UiMoveCache {
  const legalActions = engine.generateLegalActions(state);
  const legalSet = new Set<number>(Array.from(legalActions));
  const isLegal = (action: number): boolean => legalSet.has(action) && validator.isProbablyLegal(action);

  const cache: UiMoveCache = {
    enemy: new Map(),
    ownPrimary: new Map(),
    ownSecondary: new Map(),
    empty: new Map(),
  };

  // Build enemy caches
  for (let cid = 0; cid < 121; cid++) {
    const unit = engine.unitByteToUnit(state.board[cid]);
    if (!unit || unit.color === state.turn) continue; // Only enemy tiles

    const damageOptions: number[] = [];
    let liberateAction: number | undefined;

    // Test DAMAGE actions (1..8)
    for (let dmg = 1; dmg <= 8; dmg++) {
      if (dmg >= unit.p) break; // Damage must be < target primary
      const action = engine.encodeDamage(cid, dmg);
      if (isLegal(action)) {
        damageOptions.push(action);
      }
    }

    // Test LIBERATE (only if target has secondary)
    if (unit.s > 0) {
      const action = engine.encodeLiberate(cid);
      if (isLegal(action)) {
        liberateAction = action;
      }
    }

    if (damageOptions.length > 0 || liberateAction !== undefined) {
      const options = [...damageOptions];
      if (liberateAction !== undefined) {
        options.push(liberateAction);
      }
      cache.enemy.set(cid, {
        damageOptions,
        hasLiberate: liberateAction !== undefined,
        liberateAction,
        options,
      });
    }
  }

  // Build ownPrimary and ownSecondary caches
  for (let cid = 0; cid < 121; cid++) {
    const unit = engine.unitByteToUnit(state.board[cid]);
    if (!unit || unit.color !== state.turn || unit.p === 0) continue;

    const targets = new Map<Cid, OwnPrimaryTargetOptions>();
    const highlighted = new Set<Cid>();

    // Enumerate primary pattern moves/attacks
    const primaryReachable = getReachableTiles(cid, unit.p, unit.color, unit.tribun, state.board, false);
    const primaryAttackReachable = getAttackReachableTiles(cid, unit.p, unit.color, unit.tribun, state.board);

    // Enumerate secondary pattern moves/attacks (if available)
    let secondaryReachable: number[] = [];
    let secondaryAttackReachable: number[] = [];
    if (unit.s > 0) {
      secondaryReachable = getReachableTiles(cid, unit.s, unit.color, false, state.board, false);
      secondaryAttackReachable = getAttackReachableTiles(cid, unit.s, unit.color, false, state.board);
    }

    // Process empty targets (MOVE)
    const allMoveReachable = new Set<number>([...primaryReachable, ...secondaryReachable]);
    for (const toCid of allMoveReachable) {
      const targetUnit = engine.unitByteToUnit(state.board[toCid]);
      if (targetUnit !== null) continue; // Must be empty for MOVE

      const options: number[] = [];
      
      // Test secondary MOVE
      if (unit.s > 0 && secondaryReachable.includes(toCid)) {
        const action = engine.encodeMove(cid, toCid, 1);
        if (isLegal(action)) {
          options.push(action);
        }
      }
      
      // Test primary MOVE
      const action = engine.encodeMove(cid, toCid, 0);
      if (isLegal(action)) {
        options.push(action);
      }

      if (options.length > 0) {
        targets.set(toCid, { options, isTribunAttack: false });
        highlighted.add(toCid);
      }
    }

    // Process enemy targets (KILL/ENSLAVE/ATTACK_TRIBUN)
    const allAttackReachable = new Set([...primaryAttackReachable, ...secondaryAttackReachable]);
    for (const targetCid of allAttackReachable) {
      const targetUnit = engine.unitByteToUnit(state.board[targetCid]);
      if (!targetUnit || targetUnit.color === state.turn) continue; // Must be enemy

      const options: number[] = [];
      let isTribunAttack = false;

      // Check for ATTACK_TRIBUN
      if (targetUnit.tribun) {
        const action = engine.encodeAttackTribun(cid, targetCid, state.turn);
        if (isLegal(action)) {
          options.push(action);
          isTribunAttack = true;
        }
      } else {
        // Test KILL actions
        if (secondaryAttackReachable.includes(targetCid)) {
          const action = engine.encodeKill(cid, targetCid, 1);
          if (isLegal(action)) {
            options.push(action);
          }
        }
        if (primaryAttackReachable.includes(targetCid)) {
          const action = engine.encodeKill(cid, targetCid, 0);
          if (isLegal(action)) {
            options.push(action);
          }
        }

        // Test ENSLAVE (only primary pattern, target must not be tribun, no secondary, S >= T)
        if (targetUnit.s === 0 && !targetUnit.tribun && primaryAttackReachable.includes(targetCid)) {
          const action = engine.encodeEnslave(cid, targetCid);
          if (isLegal(action)) {
            options.push(action);
          }
        }
      }

      if (options.length > 0) {
        targets.set(targetCid, { options, isTribunAttack });
        highlighted.add(targetCid);
      }
    }

    // Check if can enter secondary (has empty adjacent or split/backstabb possible)
    let canEnterSecondary = false;
    if (unit.s > 0 || unit.p > 0) {
      // Check for adjacent empty tiles
      for (let dir = 0; dir < 6; dir++) {
        const neighborCid = getNeighborCid(cid, dir);
        if (neighborCid !== null) {
          const neighborUnit = engine.unitByteToUnit(state.board[neighborCid]);
          if (neighborUnit === null) {
            canEnterSecondary = true;
            break;
          }
        }
      }
      
      // Also check if any split/backstabb action is probably legal
      if (!canEnterSecondary && unit.p > 0 && !unit.tribun) {
        // Quick check: test a simple split
        const testAlloc: [number, number, number, number, number, number] = [1, 0, 0, 0, 0, 0];
        const testAction = engine.encodeSplit(cid, testAlloc);
        if (isLegal(testAction)) {
          canEnterSecondary = true;
        }
      }
      if (!canEnterSecondary && unit.s > 0) {
        // Test backstabb
        for (let dir = 0; dir < 6; dir++) {
          const neighborCid = getNeighborCid(cid, dir);
          if (neighborCid !== null) {
            const neighborUnit = engine.unitByteToUnit(state.board[neighborCid]);
            if (neighborUnit === null) {
              const action = engine.encodeBackstabb(cid, dir);
              if (isLegal(action)) {
                canEnterSecondary = true;
                break;
              }
            }
          }
        }
      }
    }

    // Only add to ownPrimary cache if there are actual primary moves (targets)
    // canEnterSecondary is still tracked for toggling, but unit should only be
    // in cache if it has primary moves
    if (targets.size > 0) {
      cache.ownPrimary.set(cid, {
        targets,
        highlighted,
        canEnterSecondary,
      });
    }

    // Build ownSecondary cache
    if (unit.p > 0 && !unit.tribun) {
      const emptyAdjDirs: number[] = [];
      for (let dir = 0; dir < 6; dir++) {
        const neighborCid = getNeighborCid(cid, dir);
        if (neighborCid !== null) {
          const neighborUnit = engine.unitByteToUnit(state.board[neighborCid]);
          if (neighborUnit === null) {
            emptyAdjDirs.push(dir);
          }
        }
      }

      if (emptyAdjDirs.length > 0) {
        const H0 = unit.p;
        const S0 = unit.s;

        const allowedAllocValues = (dir: number, alloc: number[]): number[] => {
          const remainder = H0 - alloc.reduce((sum, val, idx) => (idx !== dir ? sum + val : sum), 0);
          const validHeights = [1, 2, 3, 4, 6, 8];
          const allowed = [0];
          for (const h of validHeights) {
            if (h <= remainder) {
              allowed.push(h);
            }
          }
          return allowed;
        };

        const isRemainingValid = (alloc: number[]): boolean => {
          const rem = H0 - alloc.reduce((a, b) => a + b, 0);
          if (rem < 0) return false;
          if (rem === 0) {
            // If remainder is 0 and secondary > 0, origin would liberate
            // UI may preview, but submission must be validated
            return true; // Allow preview
          }
          // SP constraint: if secondary > 0 and rem > 0, rem <= 4 and 2*rem >= secondary
          if (S0 > 0 && rem > 0) {
            return rem <= 4 && 2 * rem >= S0;
          }
          return true;
        };

        const deriveBackstabbAction = (alloc: number[]): number | null => {
          const totalAllocated = alloc.reduce((a, b) => a + b, 0);
          if (totalAllocated === H0 && S0 > 0) {
            const nonzeroCount = alloc.filter(a => a > 0).length;
            if (nonzeroCount === 1) {
              const dir = alloc.findIndex(a => a > 0);
              const action = engine.encodeBackstabb(cid, dir);
              if (isLegal(action)) {
                return action;
              }
            }
          }
          return null;
        };

        const constructSplitAction = (alloc: number[]): number => {
          return engine.encodeSplit(cid, alloc as [number, number, number, number, number, number]);
        };

        const splitCache: SplitAllocationCache = {
          emptyAdjDirs,
          allowedAllocValues,
          isRemainingValid,
          deriveBackstabbAction,
          constructSplitAction,
        };

        cache.ownSecondary.set(cid, { split: splitCache });
      }
    }
  }

  // Build empty caches
  for (let centerCid = 0; centerCid < 121; centerCid++) {
    const centerUnit = engine.unitByteToUnit(state.board[centerCid]);
    if (centerUnit !== null) continue; // Center must be empty

    const donorCids: Cid[] = [];
    const donorRules = new Map<Cid, DonorRuleCache>();
    const donorDirs = new Map<Cid, number>();
    const donorUnits = new Map<Cid, engine.Unit>();

    // Find adjacent owned tiles
    for (let dir = 0; dir < 6; dir++) {
      const neighborCid = getNeighborCid(centerCid, dir);
      if (neighborCid !== null) {
        const unit = engine.unitByteToUnit(state.board[neighborCid]);
        if (unit && unit.color === state.turn && unit.p > 0) {
          donorCids.push(neighborCid);
          donorDirs.set(neighborCid, dir);
          donorUnits.set(neighborCid, unit);

          // Build donor rules
          const validHeights = [0, 1, 2, 3, 4, 6, 8];
          const allowedDisplayedHeights: number[] = [0];
          
          if (unit.tribun) {
            // Tribun: [0, H]
            if (unit.p > 0) {
              allowedDisplayedHeights.push(unit.p);
            }
          } else {
            // Non-tribun: [0, ...validHeights<=H]
            for (const h of validHeights) {
              if (h > 0 && h <= unit.p) {
                allowedDisplayedHeights.push(h);
              }
            }
          }

          donorRules.set(neighborCid, {
            donorCid: neighborCid,
            allowedDisplayedHeights,
            actualPrimary: unit.p,
            isTribun: unit.tribun,
          });
        }
      }
    }

    if (donorCids.length < 2) continue; // Need at least 2 donors to start

    let hasLegalAction = false;
    
    // Test 2-donor combine candidates
    for (let i = 0; i < donorCids.length && !hasLegalAction; i++) {
      const aCid = donorCids[i];
      const aRule = donorRules.get(aCid);
      const dirA = donorDirs.get(aCid);
      if (!aRule || dirA === undefined) continue;
      
      for (let j = i + 1; j < donorCids.length && !hasLegalAction; j++) {
        const bCid = donorCids[j];
        const bRule = donorRules.get(bCid);
        const dirB = donorDirs.get(bCid);
        if (!bRule || dirB === undefined) continue;
        
        for (let donateA = 1; donateA <= aRule.actualPrimary && !hasLegalAction; donateA++) {
          for (let donateB = 1; donateB <= bRule.actualPrimary; donateB++) {
            const action = engine.encodeCombine(centerCid, dirA, dirB, donateA, donateB);
            if (isLegal(action)) {
              hasLegalAction = true;
              break;
            }
          }
        }
      }
    }
    
    // Test symmetric combines
    if (!hasLegalAction) {
      const sym6Action = engine.encodeSymCombine(centerCid, 0, 1);
      if (isLegal(sym6Action)) {
        hasLegalAction = true;
      }
    }
    if (!hasLegalAction) {
      for (const config of [1, 2] as const) {
        for (const donate of [1, 2]) {
          const action = engine.encodeSymCombine(centerCid, config, donate);
          if (isLegal(action)) {
            hasLegalAction = true;
            break;
          }
        }
        if (hasLegalAction) break;
      }
    }
    
    if (!hasLegalAction) continue;

    // Build canPair function
    const canPair = (aCid: Cid, bCid: Cid, donateA: number, donateB: number): boolean => {
      const dirA = donorDirs.get(aCid);
      const dirB = donorDirs.get(bCid);
      if (dirA === undefined || dirB === undefined || dirA === dirB) return false;

      const action = engine.encodeCombine(centerCid, dirA, dirB, donateA, donateB);
      return isLegal(action);
    };

    // Build symmetryModeForThird function
    const sym6Possible = (() => {
      if (donorCids.length !== 6) return false;
      const firstCid = donorCids[0];
      const firstUnit = donorUnits.get(firstCid);
      if (!firstUnit || firstUnit.tribun) return false;
      return donorCids.every((cid) => {
        const unit = donorUnits.get(cid);
        return (
          unit !== undefined &&
          !unit.tribun &&
          unit.color === firstUnit.color &&
          unit.p === firstUnit.p &&
          unit.s === firstUnit.s
        );
      });
    })();

    const symmetryModeForThird = (donors: Cid[]): 'sym3+' | 'sym3-' | 'sym6' | null => {
      if (donors.length !== 3) return null;

      const dirs: number[] = [];
      const units: engine.Unit[] = [];
      for (const donorCid of donors) {
        const dir = donorDirs.get(donorCid);
        if (dir === undefined) return null;
        dirs.push(dir);
        const unit = donorUnits.get(donorCid);
        if (!unit) return null;
        units.push(unit);
      }

      // Check for sym3 configurations
      const dirSet = new Set(dirs);
      const sym3Config1 = new Set([0, 4, 5]);
      const sym3Config2 = new Set([3, 1, 2]);
      const firstUnit = units[0];
      const unitsEqual = units.every(
        (unit) =>
          !unit.tribun &&
          unit.color === firstUnit.color &&
          unit.p === firstUnit.p &&
          unit.s === firstUnit.s
      );

      if (dirSet.size === 3) {
        if (unitsEqual && sym3Config1.has(dirs[0]) && sym3Config1.has(dirs[1]) && sym3Config1.has(dirs[2])) {
          return 'sym3+';
        }
        if (unitsEqual && sym3Config2.has(dirs[0]) && sym3Config2.has(dirs[1]) && sym3Config2.has(dirs[2])) {
          return 'sym3-';
        }
      }

      // Check for sym6 (test if sym6 is possible)
      if (sym6Possible) {
        return 'sym6';
      }

      return null;
    };

    const allowedSymmetricDonations = (mode: 'sym3+' | 'sym3-' | 'sym6'): number[] => {
      if (mode === 'sym6') {
        return [0, 1];
      } else {
        return [0, 1, 2];
      }
    };

    const constructCombineAction = (aCid: Cid, bCid: Cid, donateA: number, donateB: number): number => {
      const dirA = donorDirs.get(aCid);
      const dirB = donorDirs.get(bCid);
      if (dirA === undefined || dirB === undefined) throw new Error('Invalid donor positions');
      return engine.encodeCombine(centerCid, dirA, dirB, donateA, donateB);
    };

    const constructSymCombineAction = (mode: 'sym3+' | 'sym3-' | 'sym6', donate: number): number => {
      let config: 0 | 1 | 2;
      if (mode === 'sym6') {
        config = 0;
      } else if (mode === 'sym3+') {
        config = 1;
      } else {
        config = 2;
      }
      return engine.encodeSymCombine(centerCid, config, donate);
    };

    cache.empty.set(centerCid, {
      centerCid,
      donorCids,
      donorRules,
      canPair,
      symmetryModeForThird,
      allowedSymmetricDonations,
      constructCombineAction,
      constructSymCombineAction,
    });
  }

  return cache;
}
