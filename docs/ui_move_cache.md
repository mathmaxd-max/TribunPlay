# UI Move Cache System

## Overview

The UI move cache system enables fast, FSM-driven interaction without downloading the full legal move list from the server. Instead, the client builds per-tile caches locally by testing candidate actions against a server-provided Bloom filter validator.

## Architecture

### Data Flow

```
Server: generateLegalActions() → Build Bloom Filter → Send {t:"legal", bloom:{...}}
Client: Receive Bloom Filter → Build Cache (test candidates) → Use Cache for UI
```

The server remains authoritative and computes the full legal move set each ply, but only sends a compact Bloom filter. The client uses this filter to test candidate actions and build caches for instant UI interaction.

## Bloom Filter Validator

### Format

The server sends Bloom filter data in the message format:

```json
{
  "t": "legal",
  "ply": 42,
  "bloom": {
    "m": 1024,
    "k": 3,
    "bitsB64": "base64-encoded-bit-array"
  }
}
```

- `m`: Number of bits in the filter
- `k`: Number of hash functions
- `bitsB64`: Base64-encoded bit array

### Hashing Algorithm

The Bloom filter uses FNV-1a hash with seed variation for multiple hash functions:

```typescript
hash(value: number, seed: number): number {
  let hash = 2166136261 ^ (seed * 16777619);
  hash ^= (value >>> 24) & 0xff;
  hash = (hash * 16777619) >>> 0;
  hash ^= (value >>> 16) & 0xff;
  hash = (hash * 16777619) >>> 0;
  hash ^= (value >>> 8) & 0xff;
  hash = (hash * 16777619) >>> 0;
  hash ^= value & 0xff;
  hash = (hash * 16777619) >>> 0;
  return hash >>> 0;
}
```

Each action word (uint32) is hashed `k` times with different seeds, and all corresponding bits must be set for `isProbablyLegal()` to return true.

### False Positives

Bloom filters may have false positives (reporting an action as legal when it's not). The server handles this by:

1. Validating all submitted actions against the authoritative legal set
2. Sending `{t:"error", message:"Illegal action"}` if a false positive is submitted
3. Client should resync on reject

False negatives are not possible - if an action is legal, the Bloom filter will always report it as legal.

## Cache Structures

### Enemy Tile Cache

For each enemy-occupied tile that has attack options:

```typescript
interface EnemyTileCache {
  damageOptions: number[];      // DAMAGE actions, ascending by effective damage
  hasLiberate: boolean;          // If LIBERATE action exists
  liberateAction?: number;       // LIBERATE action word
  options: number[];             // Full list: [...damageOptions, liberateAction?]
}
```

**Building**: Enumerate DAMAGE(1..8) and LIBERATE candidates, test against validator.

### Own.Primary Tile Cache

For each own-occupied tile with movement/attack options:

```typescript
interface OwnPrimaryTileCache {
  targets: Map<Cid, OwnPrimaryTargetOptions>;
  highlighted: Set<Cid>;         // Keys of targets
  canEnterSecondary: boolean;    // Whether can toggle to Own.Secondary
}

interface OwnPrimaryTargetOptions {
  options: number[];             // MOVE/KILL/ENSLAVE options in cycling order
  isTribunAttack: boolean;       // True if single ATTACK_TRIBUN option
}
```

**Building**: 
- Enumerate reachable tiles using movement patterns (primary and secondary)
- For each target, test MOVE/KILL/ENSLAVE/ATTACK_TRIBUN candidates
- Sort options: secondary pattern before primary, ENSLAVE after KILL

### Own.Secondary Tile Cache

For split/backstabb allocator:

```typescript
interface OwnSecondaryTileCache {
  split: SplitAllocationCache;
}

interface SplitAllocationCache {
  emptyAdjDirs: number[];        // Adjacent empty tile directions (0..5)
  allowedAllocValues: (dir: number, alloc: number[]) => number[];
  isRemainingValid: (alloc: number[]) => boolean;
  deriveBackstabbAction: (alloc: number[]) => number | null;
  constructSplitAction: (alloc: number[]) => number;
}
```

**Building**: 
- Find adjacent empty tiles
- Cache dynamic functions for allocation validation
- No pre-enumeration of split actions (too many combinations)

### Empty Tile Cache

For combine/sym-combine:

```typescript
interface EmptyTileCache {
  centerCid: Cid;
  donorCids: Cid[];              // Adjacent owned tiles
  donorRules: Map<Cid, DonorRuleCache>;
  canPair: (aCid, bCid, donateA, donateB) => boolean;
  symmetryModeForThird: (donors: Cid[]) => 'sym3+' | 'sym3-' | 'sym6' | null;
  allowedSymmetricDonations: (mode) => number[];
  constructCombineAction: (aCid, bCid, donateA, donateB) => number;
  constructSymCombineAction: (mode, donate) => number;
}
```

**Building**:
- Find all adjacent owned tiles
- Build donor rules (allowed displayed heights)
- Cache functions for pair compatibility and symmetry detection

## Participation Restriction

### Critical Constraint

When exactly 2 donors are selected (both with donation > 0), only donors that could symmetrically combine with those 2 may be further selected.

### Implementation Logic

1. **2 donors participating**: Check if they could form part of a sym3 or sym6 combination
   - For sym3: the 2 donors must be part of one of the valid 3-donor configurations (dirs [0,4,5] or [3,1,2])
   - For sym6: all 6 adjacent donors must be owned and equal
   - Only allow selecting a 3rd donor that would complete a valid symmetry configuration
   - If no symmetry is possible, no further donors should be selectable

2. **1 donor participating**: Only allow donors that can pair with the participating one (tested via `canPair()`)

3. **0 donors participating**: All donors are selectable

### Example

```
Center C has 6 adjacent donors: A, B, C, D, E, F (directions 0-5)

User selects A (donation > 0) → Only donors that can pair with A are selectable
User then selects B (donation > 0) → Now only donors that create symmetry with A+B are selectable
  - If A and B are at dirs [0, 4], then only dir 5 can be selected (sym3+)
  - If A and B are at dirs [3, 1], then only dir 2 can be selected (sym3-)
  - If A and B don't match a sym3 config, test if sym6 is possible
  - If no symmetry possible, no further donors selectable
```

## Symmetry Preview/Restore

### Flow

1. User has 2 donors with donation amounts (pair state)
2. User selects a 3rd donor
3. Save the 2-donor state (displayed heights + which donors were participating)
4. Determine symmetry mode using `symmetryModeForThird()`:
   - `sym3+`: dirs [0, 4, 5]
   - `sym3-`: dirs [3, 1, 2]
   - `sym6`: all 6 donors
5. Preview symmetrical combination with symmetric donation amount
6. Clicking any donor in the symmetry set cycles `symDonate`:
   - sym3: [0, 1, 2]
   - sym6: [0, 1]
7. If `symDonate` cycles to 0: restore saved pair state and exit symmetry mode

### Implementation

```typescript
// Determine symmetry mode
const mode = emptyCache.symmetryModeForThird([donorA, donorB, donorC]);

// Cycle symmetric donation
const allowed = emptyCache.allowedSymmetricDonations(mode);
// Cycle through: 0 → 1 → 2 → 0 (for sym3) or 0 → 1 → 0 (for sym6)

// Construct action
if (symDonate > 0) {
  const action = emptyCache.constructSymCombineAction(mode, symDonate);
  // Submit if validator.isProbablyLegal(action)
}
```

## Best Practices

### Cache Building

1. **Enumerate candidates based on local rules**: Use movement patterns, adjacency, valid heights, SP rules
2. **Test against validator**: Only include candidates where `validator.isProbablyLegal(action)` is true
3. **Don't pre-enumerate everything**: For Own.Secondary and Empty states, use dynamic functions rather than enumerating all combinations

### False Positive Handling

1. **Server rejects false positives**: Server validates all submissions and sends error on false positive
2. **Client resyncs**: On reject, client should request resync to get updated state and validator
3. **Graceful degradation**: UI should handle validator absence gracefully (disable submission)

### Performance

1. **Cache is computed once per state change**: Rebuild cache when validator or game state changes
2. **Use memoization**: Cache computation is expensive, use React `useMemo` or similar
3. **Lazy evaluation**: For dynamic functions (allocation values, pair compatibility), compute on-demand

## Wire Protocol

### Server → Client

**Legal Validator Update**:
```json
{
  "t": "legal",
  "ply": 42,
  "bloom": {
    "m": 1024,
    "k": 3,
    "bitsB64": "AAECAwQ..."
  }
}
```

Sent:
- After initial sync (`sendSync`)
- After each accepted action (state change)

### Client → Server

No changes - still sends binary action words (4 bytes, little-endian uint32).

**Error Handling**:
```json
{
  "t": "error",
  "message": "Illegal action"
}
```

Sent when:
- Action is not in legal set (including false positives from Bloom filter)
- Not player's turn
- Spectator tries to play
- Other validation failures

## Testing Considerations

### Unit Tests

1. **Bloom filter membership**: Test that legal actions are always reported as legal
2. **False positive rate**: Measure false positive rate (should be low with proper m/k)
3. **Cache correctness**: Verify cache correctly identifies clickable tiles
4. **Allocation constraints**: Test that `allowedAllocValues` correctly shrinks with remainder
5. **Symmetry detection**: Test `symmetryModeForThird` for all valid configurations

### Integration Tests

1. **Participation restriction**: When 2 donors selected, verify only symmetry-compatible 3rd donors are selectable
2. **Symmetry preview/restore**: Test full flow of entering symmetry mode, cycling, and restoring
3. **False positive handling**: Submit a false positive action, verify server rejects and client handles gracefully
4. **Cache rebuild**: Verify cache rebuilds correctly when validator updates

## Migration Notes

### Removed Dependencies

- `buildGroupedLegalMoves()`: No longer used
- `GroupedLegalMoves`: Replaced by `UiMoveCache`
- `isActionLegal()`: Replaced by `validator.isProbablyLegal()`

### New Dependencies

- `LegalBloomValidator`: Bloom filter validator
- `buildCache()`: Cache builder
- `UiMoveCache`: Cache container

### Breaking Changes

- Client no longer receives full legal move list
- UI must use cache instead of grouped moves
- Action validation uses Bloom filter (may have false positives)
