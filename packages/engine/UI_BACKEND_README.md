# UI Backend Implementation

This module provides the backend logic for the tile-click UI finite state machine described in `docs/ui/`.

## Overview

The UI backend (`ui-backend.ts`) provides:

1. **Grouped Legal Moves** - Organizes legal actions by UI state needs
2. **State Management Helpers** - Functions to determine clickable tiles and options for each UI state
3. **Action Validation** - Validates UI selections against legal moves

## Key Functions

### Core Data Structure

- `buildGroupedLegalMoves(state: State): GroupedLegalMoves` - Builds the grouped legal moves structure from game state

### State-Specific Functions

#### Idle State
- `getClickableTiles(state, uiState, grouped)` - Returns clickable tiles for current UI state
- `getTileClickState(cid, state, grouped)` - Determines which UI state a tile click should enter

#### Enemy State
- `getEnemyOptions(targetCid, grouped)` - Returns sorted options (damage amounts + liberate) for enemy target

#### Empty State (Combine/Sym-Combine)
- `getEmptyStateDonors(centerCid, state)` - Gets donor information (actual primary, isTribun)
- `getValidDonationValues(donorCid, state)` - Returns valid donation values for a donor
- `getEmptyStateOptions(centerCid, donors, state, grouped)` - Returns matching combine/sym-combine actions

#### Own.Primary State
- `getOwnPrimaryOptions(originCid, targetCid, grouped)` - Returns options for selected origin+target
- `getOwnPrimaryHighlightedTiles(originCid, grouped)` - Returns highlighted target tiles

#### Own.Secondary State (Split/Backstabb)
- `getOwnSecondaryPendingAction(originCid, allocations, grouped, state)` - Validates allocations and returns matching action
- `getAllowedAllocationValues(originCid, neighborDir, allocations, state)` - Returns allowed allocation values for a neighbor

### Validation

- `isActionLegal(action, grouped)` - Validates that an action word is in the legal set

## Usage Example

```typescript
import * as engine from '@tribunplay/engine';

// Build grouped legal moves
const grouped = engine.buildGroupedLegalMoves(gameState);

// Get clickable tiles for Idle state
const clickable = engine.getClickableTiles(
  gameState,
  { type: 'idle' },
  grouped
);

// Determine state for a tile click
const newState = engine.getTileClickState(tileCid, gameState, grouped);

// Get options for Enemy state
const enemyOptions = engine.getEnemyOptions(targetCid, grouped);

// Validate action before submission
if (engine.isActionLegal(actionWord, grouped)) {
  // Submit action
}
```

## UI State Machine Support

The backend fully supports all UI states described in `docs/ui/02-fsm-state-details.md`:

- **Idle**: Clickable tiles (enemy/empty/own)
- **Enemy**: Options sorted by effective damage, with LIBERATE last
- **Empty**: Donor management, combine/sym-combine matching
- **Own.Primary**: Move/kill/enslave/tribun attack options
- **Own.Secondary**: Split/backstabb allocation validation

All functions respect the legal move set and provide the data structures needed for efficient UI rendering and interaction.
