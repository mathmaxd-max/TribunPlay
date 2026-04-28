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
import { State } from './index';
/**
 * UI State Types
 */
export type UIState = {
    type: 'idle';
} | {
    type: 'enemy';
    targetCid: number;
    optionIndex: number;
} | {
    type: 'empty';
    centerCid: number;
    donors: Map<number, number>;
    optionIndex: number;
} | {
    type: 'own_primary';
    originCid: number;
    targetCid: number | null;
    optionIndex: number;
} | {
    type: 'own_secondary';
    originCid: number;
    allocations: number[];
};
/**
 * Grouped legal moves for UI consumption
 */
export interface GroupedLegalMoves {
    legalSet: Set<number>;
    idleClickable: {
        enemy: number[];
        empty: number[];
        own: number[];
    };
    enemyOptions: Map<number, number[]>;
    emptyOptions: Map<number, {
        combine2: Array<{
            dirA: number;
            dirB: number;
            donateA: number;
            donateB: number;
            action: number;
        }>;
        sym3: Array<{
            config: 0 | 1 | 2;
            donate: number;
            action: number;
        }>;
        sym6: Array<{
            donate: number;
            action: number;
        }>;
    }>;
    ownPrimaryOptions: Map<number, {
        moves: Array<{
            toCid: number;
            part: 0 | 1;
            action: number;
        }>;
        kills: Array<{
            targetCid: number;
            part: 0 | 1;
            action: number;
        }>;
        enslaves: Array<{
            targetCid: number;
            action: number;
        }>;
        tribunAttack: Array<{
            tribunCid: number;
            action: number;
        }>;
    }>;
    ownSecondaryOptions: Map<number, {
        splits: Array<{
            heights: number[];
            action: number;
        }>;
        backstabbs: Array<{
            dir: number;
            action: number;
        }>;
    }>;
}
/**
 * Build grouped legal moves from state
 */
export declare function buildGroupedLegalMoves(state: State): GroupedLegalMoves;
/**
 * Get clickable tiles for current UI state
 */
export declare function getClickableTiles(state: State, uiState: UIState, grouped: GroupedLegalMoves): number[];
/**
 * Get options for Enemy state
 */
export declare function getEnemyOptions(targetCid: number, grouped: GroupedLegalMoves): number[];
/**
 * Get options for Own.Primary state
 */
export declare function getOwnPrimaryOptions(originCid: number, targetCid: number | null, grouped: GroupedLegalMoves): number[];
/**
 * Get highlighted target tiles for Own.Primary state
 */
export declare function getOwnPrimaryHighlightedTiles(originCid: number, grouped: GroupedLegalMoves): number[];
/**
 * Validate and get pending action for Own.Secondary state
 */
export declare function getOwnSecondaryPendingAction(originCid: number, allocations: number[], grouped: GroupedLegalMoves, state: State): number | null;
/**
 * Get allowed allocation values for a neighbor in Own.Secondary state
 */
export declare function getAllowedAllocationValues(originCid: number, neighborDir: number, allocations: number[], state: State): number[];
/**
 * Get Empty state options based on current donor selections
 *
 * @param centerCid - The empty center tile
 * @param donors - Map of donor cid -> displayed primary (Hdisp)
 * @param state - Current game state (needed to get actual primary heights)
 * @param grouped - Grouped legal moves
 */
export declare function getEmptyStateOptions(centerCid: number, donors: Map<number, number>, // cid -> displayed primary (Hdisp)
state: State, grouped: GroupedLegalMoves): number[];
/**
 * Validate that an action word is legal
 */
export declare function isActionLegal(action: number, grouped: GroupedLegalMoves): boolean;
/**
 * Get donor information for Empty state
 * Returns map of neighbor cid -> { actualPrimary, isTribun }
 */
export declare function getEmptyStateDonors(centerCid: number, state: State): Map<number, {
    actualPrimary: number;
    isTribun: boolean;
}>;
/**
 * Determine which UI state a tile click should enter from Idle
 */
export declare function getTileClickState(cid: number, state: State, grouped: GroupedLegalMoves): UIState | null;
/**
 * Get valid donation values for a donor in Empty state
 * For non-tribun: {0} U {donations that leave a valid remainder}
 * For tribun: {0, actualPrimary} only
 */
export declare function getValidDonationValues(donorCid: number, state: State): number[];
//# sourceMappingURL=ui-backend.d.ts.map