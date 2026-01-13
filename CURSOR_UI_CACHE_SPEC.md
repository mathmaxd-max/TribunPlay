# Cursor Spec — UI FSM Move Cache (Per-Tile, No Move List Download)

## Objective

Implement a **client-side UI cache** that supports fast, FSM-driven interaction without downloading the full legal move list from the server.

Requirements:
- The **client MUST NOT download** the full `legalMoves` list.
- The client MUST be able to:
  - Render **clickable tiles** per UI state instantly
  - Cycle through **options** (damage/liberate; move/kill/impero variants; symmetry donation values)
  - Determine **valid allocation amounts** for split/backstabb quickly
  - Gate submission by **membership** in a server-provided **legal validator** (see below)
- Implement logic in code **and** document it in `docs/` using best practices.

Deliver:
1) Code: UI cache builder, cache data structures, and FSM integration
2) Docs: one new doc describing cache computation, wire protocol, and algorithms

---

## Key Design: Server sends a validator, not the move list

The server remains authoritative and still computes the full `legalMoves` each ply, but it does **not** send them to the client.

Instead, on each turn (or after any accepted action), the server sends:

- A compact **Legal Validator** that allows the client to test: `isLegal(action_u32) -> boolean`

### MVP validator options (choose ONE; implement option A now)

**Option A (recommended now): Bloom filter**
- Server sends a Bloom filter for the set of legal `uint32` actions
- Client checks membership with false-positive risk; on submit, server verifies truth
- To avoid UX glitches, server should respond immediately with reject if a false positive happened
- For MVP: acceptable and simplest

**Option B: Perfect hash / cuckoo filter**
- More complex but fewer false positives; optional later

**Option C: Signed allow-list of relevant actions only**
- Not acceptable here because requirement says client should not need move list

### Required Implementation (Option A Bloom filter)

- Server message: `{t:"legal", ply, bloom:{m:number, k:number, bitsB64:string}}`
  - `m`: number of bits
  - `k`: number of hash functions
  - `bitsB64`: base64-encoded bit array
- Client implements: `isProbablyLegal(action:number): boolean`

> Even with Bloom filters, cache correctness is derived from local rules + validator membership.  
> The server remains the final arbiter.

---

## UI FSM States (must match existing design)

- Idle
- Enemy (selected enemy tile)
- Own.Primary (selected own tile; union of both patterns; options include secondary/primary/impero)
- Own.Secondary (split/backstabb allocator)
- Empty (combine/sym combine)

---

## Per-Tile Cache Requirements

Implement a `UiMoveCache` object computed from **current local state** (board + turn) and indexed by `cid` (0..120).

### TypeScript types (must implement)

Create `apps/web/src/ui/cache/types.ts`:

```ts
export type Cid = number; // 0..120

export interface EnemyTileCache {
  // Enemy: damages + optional liberation in display order
  damageOptions: number[]; // encoded uint32 DAMAGE actions, ascending by effective damage
  hasLiberate: boolean;    // if true, a LIBERATE action exists as last option
  liberateAction?: number; // encoded uint32 LIBERATE
  // Convenience: full list in UI order
  options: number[];       // [...damageOptions, (liberateAction?)]
}

export interface OwnPrimaryTargetOptions {
  // options in cycling order, excluding tribun special case (single option)
  // MOVE to empty: [MOVE secondary?, MOVE primary?]
  // Attack enemy: [KILL secondary?, KILL primary?, ENSLAVE?]
  options: number[];
  // For tribun target: options length must be 1, no toggling
  isTribunAttack: boolean;
}

export interface OwnPrimaryTileCache {
  // all tiles that can be interacted with from Own.Primary for this origin
  targets: Map<Cid, OwnPrimaryTargetOptions>;
  highlighted: Set<Cid>; // keys of targets
  // Whether origin supports toggling into Own.Secondary
  canEnterSecondary: boolean;
}

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

export interface OwnSecondaryTileCache {
  split: SplitAllocationCache;
}

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
```

### Overall cache container

Create `apps/web/src/ui/cache/UiMoveCache.ts`:

```ts
export interface UiMoveCache {
  enemy: Map<Cid, EnemyTileCache>;
  ownPrimary: Map<Cid, OwnPrimaryTileCache>;
  ownSecondary: Map<Cid, OwnSecondaryTileCache>;
  empty: Map<Cid, EmptyTileCache>;
}
```

---

## Cache Builder (core logic)

Create `apps/web/src/ui/cache/buildCache.ts`:

- Input:
  - `state` (local board state)
  - `turn`
  - `validator` (Bloom filter validator)
- Output:
  - `UiMoveCache`

The builder must:
- Iterate all tiles to create caches only where relevant:
  - `enemy` cache for enemy-occupied tiles that have at least one probable DAMAGE/LIBERATE action.
  - `ownPrimary` and `ownSecondary` cache for own-occupied tiles where actions exist.
  - `empty` cache for empty tiles that have at least one combine/sym possibility.

### IMPORTANT: Determine legality without move list

Build caches by:
1) Enumerating **candidate actions** for a tile based on local rules and constraints (movement vectors, adjacency, valid heights, SP rules).
2) For each candidate, test `validator.isProbablyLegal(action)` to decide whether to include it in cache.
3) On submit, the server verifies exact legality.

---

## Enemy Cache (per enemy tile)

For each enemy tile `T`:
- Generate candidate DAMAGE actions for effectiveDamage in 1..8:
  - Keep those where `validator.isProbablyLegal(encDamage(T, dmg))` is true
- Test LIBERATE:
  - Include if `validator.isProbablyLegal(encLiberate(T))` is true
- Cache:
  - `damageOptions` sorted ascending by damage
  - `options = [...damageOptions, liberate?]`

---

## Own.Primary Cache (per own tile)

For each own tile `O`:
- Determine union of targets reachable/attackable by **primary pattern** and **secondary pattern**.
- For each target `X`, generate possible actions and include those that validate:

**If X is empty:**
- MOVE secondary-pattern (part=1) if O has secondary and movement allows
- MOVE primary-pattern (part=0)

**If X is enemy non-tribun:**
- KILL secondary-pattern (part=1) if applicable
- KILL primary-pattern (part=0) if applicable
- ENSLAVE (impero) if applicable

**If X is enemy tribun:**
- ATTACK_TRIBUN single option only (no toggle)

Cache:
- `targets.get(X).options` in cycling order
- `targets.get(X).isTribunAttack`
- `highlighted`

Compute `canEnterSecondary`:
- true if O has at least one empty adjacent tile (allocator can operate) OR any derived split/backstabb action is probably legal.

---

## Own.Secondary Cache (split/backstabb allocator)

For each own tile O:
- Compute `emptyAdjDirs`: dirs where adjacent tile exists on board and is empty.

Implement `allowedAllocValues(dir, alloc)`:
- Let H0 = origin primary (current state)
- remainder = H0 - sum(alloc[j] for j != dir)
- allowed = [0] + all x in [1,2,3,4,6,8] where x <= remainder

Implement `isRemainingValid(alloc)`:
- rem = H0 - sum(alloc)
- SP constraint for origin if secondary>0 and rem>0:
  - rem <= 4 and 2*rem >= secondary
- If rem==0 and secondary>0, origin would liberate; UI may preview, but submission must still be validated by server.

Implement `deriveBackstabbAction(alloc)`:
- If exactly one dir has alloc[dir] == H0 and origin.secondary > 0:
  - word = encBackstabb(O, dir)
  - return word if `validator.isProbablyLegal(word)` else null

Construct SPLIT action word:
- word = encSplit(O, alloc[0..5])

UI submission preference:
- If deriveBackstabbAction returns non-null, use it (Backstabb is unambiguous).
- Else attempt SPLIT:
  - UI should require "2+ owned units" locally (count of nonzero allocations + (rem>0) >= 2) to avoid offering obviously illegal submissions.
  - Final check still uses validator + server.

---

## Empty Cache (combine / symmetry)

For each empty center C:
- Determine adjacent owned tiles as potential donors (6 dirs).
- For each donor D:
  - compute `allowedDisplayedHeights`:
    - tribun: [0, H]
    - else: [0, ...validHeights<=H]
  - store in `donorRules`

### Pair compatibility + participation restriction

Requirement:
- If any donor is participating (donation>0), only donors that can combine with current participating donors may be selected further.
- If no symmetry possible, only 2 donors can be selected at most (and must for a valid move).

Implement `canPair(aCid,bCid,donateA,donateB)`:
- compute dirA and dirB from center to donors (must be adjacent)
- word = encCombine(C, dirA, dirB, donateA, donateB)
- return `validator.isProbablyLegal(word)`

UI uses this to:
- constrain selectable donors after one donor is participating
- constrain second donor compatibility
- decide whether pair state is submit-enabled

### Symmetrical combination behavior (must implement)

UI steps:

1. There are 2 donors with donation amounts (pair state)
2. A third donor is selected
3. Save the 2 donor state
4. Preview a symmetrical combination (3+/3-/6 well defined by 3rd donor)
5. Clicking tiles of the symmetry toggles through the symmetrical donation amounts.
6. If toggled to 0 display the saved pair state

Implement `symmetryModeForThird(donors)` where donors length==3:
- If donors match 3-symmetry config relative to center:
  - return 'sym3+' or 'sym3-'
- Else return 'sym6' IF sym6 is possible at this center:
  - `validator.isProbablyLegal(encSymCombine(C,'sym6',1))` true
- Else return null (third donor not selectable)

When entering symmetry mode:
- Save pair state: displayed heights + which donors were participating
- Determine symmetry donor set:
  - sym3: exactly the 3 donors
  - sym6: all 6 adjacent donors must be owned and equal per rules; UI can still preview but submission requires validator truth
- Initialize `symDonate` to last-used for this center/mode or 1

Symmetry toggling:
- Clicking any donor in the symmetry set cycles `symDonate` by d:
  - sym3: [0,1,2]
  - sym6: [0,1]

If `symDonate` cycles to 0:
- Restore saved pair state and exit symmetry mode

Submission in symmetry mode:
- if `symDonate>0` and `validator.isProbablyLegal(encSymCombine(C,mode,symDonate))`, enable submit.

---

## Implementation Tasks (Cursor must do)

### A) Code (web)

1. Add Bloom filter validator implementation:
   - `apps/web/src/net/LegalBloom.ts`
   - message handler for `{t:"legal", ...}`

2. Add UI cache types and builder:
   - `apps/web/src/ui/cache/types.ts`
   - `apps/web/src/ui/cache/UiMoveCache.ts`
   - `apps/web/src/ui/cache/buildCache.ts`

3. Integrate cache into FSM:
   - Enemy uses `cache.enemy.get(cid).options`
   - Own.Primary uses `cache.ownPrimary.get(origin).targets` and `highlighted`
   - Own.Secondary uses allocator functions (no split action enumeration)
   - Empty uses donor rules, canPair, and symmetry preview/restore behavior

4. Remove any dependency on receiving `legalMoves` from server.

5. Add minimal tests:
   - allocation allowed values shrink with remainder
   - symmetry mode selection for third donor
   - bloom membership hashing

### B) Backend (server)

1. Generate Bloom filter from legal move set per ply and broadcast `{t:"legal", ...}`
2. Keep exact server validation; on reject send `{t:"reject", reason:"ILLEGAL"}`

### C) Docs

Add `docs/ui_move_cache.md` describing:
- validator (Bloom) format and hashing
- cache structures per UI state
- participation restriction logic
- symmetry preview/restore flow (with example)
- best practices, false positives, and handling server rejects

Use clear headings, tables for field layouts, and short code snippets.

---

## Acceptance Criteria

- Client highlights and cycles options instantly from cache (no scanning large lists)
- Client never downloads legal move lists
- Participation restriction works: when donation >0, only compatible donors remain selectable
- Symmetry preview/restore works as specified
- False positive case is handled gracefully (server rejects; client resyncs)
- Docs match code and are unambiguous
