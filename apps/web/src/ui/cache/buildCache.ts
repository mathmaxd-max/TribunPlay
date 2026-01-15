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
import type { OwnPrimaryTargetOptions, SplitAllocationCache, DonorRuleCache, Cid } from './types';

const NEIGHBOR_VECTORS = [
  [1, 1],   // 0: up
  [1, 0],   // 1: left-up
  [0, 1],   // 2: right-up
  [-1, -1], // 3: down
  [-1, 0],  // 4: right-down
  [0, -1],  // 5: left-down
];

const VALID_HEIGHTS = [0, 1, 2, 3, 4, 6, 8];

function isDonationRemainderValid(remaining: number, secondary: number): boolean {
  if (!VALID_HEIGHTS.includes(remaining)) return false;
  if (remaining === 0) return true;
  if (secondary <= 0) return true;
  return remaining <= 4 && 2 * remaining >= secondary;
}

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
 * Build UI move cache from state and validator
 */
export function buildCache(
  state: engine.State,
  validator: LegalBloomValidator
): UiMoveCache {
  void validator;
  const legalActions = engine.generateLegalActions(state);
  const legalSet = new Set<number>();
  for (const action of legalActions) {
    legalSet.add(action >>> 0);
  }
  const isLegal = (action: number): boolean => legalSet.has(action >>> 0);
  const isLocallyLegal = (action: number): boolean => legalSet.has(action >>> 0);

  const legalByOrigin = new Map<
    Cid,
    {
      moves: Map<Cid, Map<0 | 1, number>>;
      kills: Map<Cid, Map<0 | 1, number>>;
      enslaves: Map<Cid, number>;
      tribun: Map<Cid, number>;
    }
  >();

  const getLegalEntry = (originCid: Cid) => {
    let entry = legalByOrigin.get(originCid);
    if (!entry) {
      entry = {
        moves: new Map(),
        kills: new Map(),
        enslaves: new Map(),
        tribun: new Map(),
      };
      legalByOrigin.set(originCid, entry);
    }
    return entry;
  };

  for (const action of legalActions) {
    const decoded = engine.decodeAction(action);
    switch (decoded.opcode) {
      case 0: { // MOVE
        const fromCid = decoded.fields.fromCid as Cid;
        const toCid = decoded.fields.toCid as Cid;
        const part = decoded.fields.part as 0 | 1;
        const entry = getLegalEntry(fromCid);
        let targetMap = entry.moves.get(toCid);
        if (!targetMap) {
          targetMap = new Map();
          entry.moves.set(toCid, targetMap);
        }
        targetMap.set(part, action);
        break;
      }
      case 1: { // KILL
        const attackerCid = decoded.fields.attackerCid as Cid;
        const targetCid = decoded.fields.targetCid as Cid;
        const part = decoded.fields.part as 0 | 1;
        const entry = getLegalEntry(attackerCid);
        let targetMap = entry.kills.get(targetCid);
        if (!targetMap) {
          targetMap = new Map();
          entry.kills.set(targetCid, targetMap);
        }
        targetMap.set(part, action);
        break;
      }
      case 4: { // ENSLAVE
        const attackerCid = decoded.fields.attackerCid as Cid;
        const targetCid = decoded.fields.targetCid as Cid;
        const entry = getLegalEntry(attackerCid);
        entry.enslaves.set(targetCid, action);
        break;
      }
      case 9: { // ATTACK_TRIBUN
        const attackerCid = decoded.fields.attackerCid as Cid;
        const tribunCid = decoded.fields.tribunCid as Cid;
        const entry = getLegalEntry(attackerCid);
        entry.tribun.set(tribunCid, action);
        break;
      }
      default:
        break;
    }
  }

  const cache: UiMoveCache = {
    enemy: new Map(),
    ownPrimary: new Map(),
    ownSecondary: new Map(),
    empty: new Map(),
    legalSet,
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
    const legalEntry = legalByOrigin.get(cid);
    if (legalEntry) {
      const targetCids = new Set<Cid>([
        ...legalEntry.moves.keys(),
        ...legalEntry.kills.keys(),
        ...legalEntry.enslaves.keys(),
        ...legalEntry.tribun.keys(),
      ]);

      for (const targetCid of targetCids) {
        const targetUnit = engine.unitByteToUnit(state.board[targetCid]);
        if (!targetUnit) {
          const moves = legalEntry.moves.get(targetCid);
          if (!moves) continue;
          const options: number[] = [];
          if (moves.has(1)) {
            options.push(moves.get(1)!);
          }
          if (moves.has(0)) {
            options.push(moves.get(0)!);
          }
          if (options.length > 0) {
            targets.set(targetCid, { options, isTribunAttack: false });
            highlighted.add(targetCid);
          }
          continue;
        }

        if (targetUnit.color === state.turn) {
          continue;
        }

        if (targetUnit.tribun) {
          const action = legalEntry.tribun.get(targetCid);
          if (action !== undefined && isLegal(action)) {
            targets.set(targetCid, { options: [action], isTribunAttack: true });
            highlighted.add(targetCid);
          }
          continue;
        }

        const options: number[] = [];
        const kills = legalEntry.kills.get(targetCid);
        if (kills?.has(1)) {
          options.push(kills.get(1)!);
        }
        if (kills?.has(0)) {
          options.push(kills.get(0)!);
        }
        const enslave = legalEntry.enslaves.get(targetCid);
        if (enslave !== undefined) {
          options.push(enslave);
        }
        if (options.length > 0) {
          targets.set(targetCid, { options, isTribunAttack: false });
          highlighted.add(targetCid);
        }
      }
    }

    // Check if can enter secondary (has empty adjacent or split/backstabb possible)
    let canEnterSecondary = false;
    const canSplit = unit.p > 1 && !unit.tribun;
    const canBackstabb = unit.s > 0;
    if (canSplit || canBackstabb) {
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
      if (!canEnterSecondary && canSplit) {
        // Quick check: test a simple split
        const testAlloc: [number, number, number, number, number, number] = [1, 0, 0, 0, 0, 0];
        const testAction = engine.encodeSplit(cid, testAlloc);
        if (isLegal(testAction)) {
          canEnterSecondary = true;
        }
      }
      if (!canEnterSecondary && canBackstabb) {
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
    if ((unit.p > 1 || unit.s > 0) && !unit.tribun) {
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
              if (isLocallyLegal(action)) {
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
    const donorCidsByDir: Array<Cid | null> = new Array(6).fill(null);

    // Find adjacent owned tiles
    for (let dir = 0; dir < 6; dir++) {
      const neighborCid = getNeighborCid(centerCid, dir);
      if (neighborCid !== null) {
        const unit = engine.unitByteToUnit(state.board[neighborCid]);
        if (unit && unit.color === state.turn && unit.p > 0) {
          donorCids.push(neighborCid);
          donorDirs.set(neighborCid, dir);
          donorUnits.set(neighborCid, unit);
          donorCidsByDir[dir] = neighborCid;

          // Build donor rules
          const allowedDisplayedHeights: number[] = [];
          const candidates = unit.tribun ? [0, unit.p] : VALID_HEIGHTS.filter(h => h <= unit.p);
          for (const h of candidates) {
            if (isDonationRemainderValid(h, unit.s)) {
              allowedDisplayedHeights.push(h);
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
      if (isLegal(action)) return true;
      const swapped = engine.encodeCombine(centerCid, dirB, dirA, donateB, donateA);
      return isLegal(swapped);
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

    const getSymmetryUnits = (mode: 'sym3+' | 'sym3-' | 'sym6'): engine.Unit[] | null => {
      const dirs = mode === 'sym6' ? [0, 1, 2, 3, 4, 5] : mode === 'sym3+' ? [0, 4, 5] : [3, 1, 2];
      const units: engine.Unit[] = [];
      for (const dir of dirs) {
        const cid = donorCidsByDir[dir];
        if (cid === null || cid === undefined) return null;
        const unit = donorUnits.get(cid);
        if (!unit) return null;
        units.push(unit);
      }
      return units;
    };

    const allowedSymmetricDonations = (mode: 'sym3+' | 'sym3-' | 'sym6'): number[] => {
      const allowed = [0];
      const units = getSymmetryUnits(mode);
      if (!units || units.length === 0) return allowed;

      const firstUnit = units[0];
      const unitsEqual = units.every(
        (unit) =>
          !unit.tribun &&
          unit.color === firstUnit.color &&
          unit.p === firstUnit.p &&
          unit.s === firstUnit.s
      );
      if (!unitsEqual) return allowed;

      const maxDonate = mode === 'sym6' ? 1 : 2;
      for (let donate = 1; donate <= maxDonate; donate++) {
        if (donate > firstUnit.p) continue;
        const remaining = firstUnit.p - donate;
        const newPrimary = donate * units.length;
        if (!VALID_HEIGHTS.includes(newPrimary)) continue;
        if (!isDonationRemainderValid(remaining, firstUnit.s)) continue;
        allowed.push(donate);
      }
      return allowed;
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
