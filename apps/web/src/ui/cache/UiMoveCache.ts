/**
 * UI Move Cache Container
 * 
 * Main cache structure that holds per-tile caches for all UI states.
 */

import type { EnemyTileCache, OwnPrimaryTileCache, OwnSecondaryTileCache, EmptyTileCache, Cid } from './types';

/**
 * Overall cache container indexed by tile coordinate (cid)
 */
export interface UiMoveCache {
  enemy: Map<Cid, EnemyTileCache>;
  ownPrimary: Map<Cid, OwnPrimaryTileCache>;
  ownSecondary: Map<Cid, OwnSecondaryTileCache>;
  empty: Map<Cid, EmptyTileCache>;
  legalSet: Set<number>;
}
