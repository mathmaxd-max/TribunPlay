/**
 * UI Move Cache Type Definitions
 * 
 * Defines the cache structures for each UI state type.
 * These caches enable fast tile highlighting and option cycling
 * without downloading the full legal move list.
 */

export type Cid = number; // 0..120

/**
 * Enemy tile cache - for cycling through damage/liberate options
 */
export interface EnemyTileCache {
  // Enemy: damages + optional liberation in display order
  damageOptions: number[]; // encoded uint32 DAMAGE actions, ascending by effective damage
  hasLiberate: boolean;    // if true, a LIBERATE action exists as last option
  liberateAction?: number; // encoded uint32 LIBERATE
  // Convenience: full list in UI order
  options: number[];       // [...damageOptions, (liberateAction?)]
}

/**
 * Own.Primary target options - for a specific target tile
 */
export interface OwnPrimaryTargetOptions {
  // options in cycling order, excluding tribun special case (single option)
  // MOVE to empty: [MOVE secondary?, MOVE primary?]
  // Attack enemy: [KILL secondary?, KILL primary?, ENSLAVE?]
  options: number[];
  // For tribun target: options length must be 1, no toggling
  isTribunAttack: boolean;
}

/**
 * Own.Primary tile cache - for movement/attack options from an origin
 */
export interface OwnPrimaryTileCache {
  // all tiles that can be interacted with from Own.Primary for this origin
  targets: Map<Cid, OwnPrimaryTargetOptions>;
  highlighted: Set<Cid>; // keys of targets
  // Whether origin supports toggling into Own.Secondary
  canEnterSecondary: boolean;
}

/**
 * Split allocation cache - for Own.Secondary state
 */
export interface SplitAllocationCache {
  // Adjacent empty tiles (direction indices 0..5) that are selectable in Own.Secondary
  emptyAdjDirs: number[]; // subset of 0..5

  // For each direction, allowed allocation amounts (UI cycling set):
  // {0} U {x in validHeights | x <= remainder after other allocations}
  //
  // This is dynamic; cache a fast function rather than precomputing all states.
  allowedAllocValues: (dir: number, alloc: number[]) => number[];

  // Valid remaining primary heights for the origin after allocations, including SP constraint.
  isRemainingValid: (alloc: number[]) => boolean;

  // Derive whether allocation implies Backstabb and provide the action word if so
  deriveBackstabbAction: (alloc: number[]) => number | null;

  // Construct SPLIT action word from alloc[6]
  constructSplitAction: (alloc: number[]) => number;
}

/**
 * Own.Secondary tile cache - for split/backstabb allocator
 */
export interface OwnSecondaryTileCache {
  split: SplitAllocationCache;
}

/**
 * Donor rule cache - for Empty state donor management
 */
export interface DonorRuleCache {
  donorCid: Cid;

  // Allowed displayed heights for donor primary (UI cycles these):
  // tribun: [0, H]
  // non-tribun: [0, ...validHeights<=H]
  allowedDisplayedHeights: number[];

  // donation = actualPrimary - displayed
  actualPrimary: number;
  isTribun: boolean;
}

/**
 * Empty tile cache - for combine/sym-combine
 */
export interface EmptyTileCache {
  centerCid: Cid;

  // Adjacent owned tiles that can ever participate at this center
  donorCids: Cid[];

  // Per donor rules (allowed displayed heights)
  donorRules: Map<Cid, DonorRuleCache>;

  // Pair compatibility: returns true if a COMBINE action with these donations is probably legal
  canPair: (aCid: Cid, bCid: Cid, donateA: number, donateB: number) => boolean;

  // Symmetry preview support: mode determined by 3rd donor
  symmetryModeForThird: (donors: Cid[]) => 'sym3+' | 'sym3-' | 'sym6' | null;

  // Allowed symmetric donation amounts:
  // sym3: [0,1,2]
  // sym6: [0,1]
  allowedSymmetricDonations: (mode: 'sym3+'|'sym3-'|'sym6') => number[];

  // Constructors for action words
  constructCombineAction: (aCid: Cid, bCid: Cid, donateA: number, donateB: number) => number;
  constructSymCombineAction: (mode: 'sym3+'|'sym3-'|'sym6', donate: number) => number;
}
