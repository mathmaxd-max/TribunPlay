# UI FSM State Details (Normative)

This document defines the exact UI behavior per state.

## Shared definitions

### Click direction
- left click: `d = +1`
- right click: `d = -1`

### Cycle function
For an options array length `n > 0`:
- `i := (i + d) mod n`

### Click sets
For each state:
- `C` = clickable tiles (have meaning)
- `U` = all other tiles

Rule:
- In Idle: click on `U` does nothing.
- In non-Idle: click on `U` cleans up to Idle; if `quickTransition` is enabled, immediately re-handle as Idle click if the tile is clickable in Idle.

---

## State: Idle

### C (clickable tiles)
A tile is clickable in Idle iff clicking it enters one of:
- Enemy (enemy unit tile has attack options)
- Empty (empty tile is a valid combine/sym-combine center)
- Own (owned unit has any primary/secondary interaction options)

The set MUST be derived from the current `legalMoves`.

### Transition on click
- click enemy tile → Enemy
- click empty tile → Empty
- click own tile → Own (Primary or Secondary chosen as described below)

---

## State: Enemy

### Purpose
Cycle through attack outcomes against a selected enemy target without choosing individual attackers.

### Entry
- `targetCid` is the clicked enemy tile.
- `options`:
  - all `DAMAGE(targetCid, effectiveDamage)` in ascending effectiveDamage
  - optionally `LIBERATE(targetCid)` appended after damages
- `i` initialized to `0`.

### C
- `{targetCid}`

### Behavior
- click `targetCid` again → `i := (i + d) mod len(options)`
- submit → submit `options[i]`

---

## State: Empty (combine / symmetric combine)

### Entry
- `centerCid` is the clicked empty tile.
- Highlight potential donor participants (adjacent owned tiles appearing in any combine/sym action).

### Donor display and donation
Each donor tile has:
- actual primary `H`
- displayed primary `Hdisp`

Donation is:
- `donate = H - Hdisp`

Cycle `Hdisp` on click:
- Non-tribun donor: cycle through `{0} ∪ {valid heights <= H}`.
- Tribun donor: cycle through `{0, H}` only.

A donor participates iff `donate > 0`.

### Participation constraints
- At most 3 donors may be participating at once.
- **3 donors can only be selected if a symmetrical combination is possible** (either sym3 or sym6 configuration).

### Symmetry selection with 3 donors (deterministic)
When the third donor becomes active:
1) If the three donor positions form a legal **3-sym** configuration (3+ or 3-) → enter `sym3`.
2) Otherwise, the only valid interpretation is **sym6** at this center (if any sym6 legal action exists). If sym6 is not available, the third donor selection MUST be rejected.

### Donor interactability
- Only donors that **can participate** given the current choice of donors should be marked as interactable.
- If selecting a donor would make a symmetrical combination impossible (e.g., selecting a third donor when sym3 and sym6 are both unavailable), that donor MUST NOT be interactable.
- Donors that cannot participate in any valid combine/sym-combine configuration with the currently selected donors should remain in `selectable` or `default` state, not `interactable`.

### Symmetry donation toggling
In a symmetry mode, donation is global:
- `sym3`: global donate cycles `{0,1,2}` with `+d`.
- `sym6`: global donate cycles `{0,1}` with `+d`.

If global donate becomes `0`:
- deselect the third donor and restore the previous non-sym state (memory restoration).
This applies to both sym3 and sym6.

### C
- `centerCid` (reset)
- current participant donor tiles

### Click centerCid
- If there are active donations, reset to initial display (no donors participating).

### Preview
The UI MUST show a preview of the board state that would result from the current donor selections and donations, **even if the combination is illegal** (e.g., single donor, invalid heights, invalid configurations).
- The preview should directly construct the resulting board state without checking legality.
- This allows users to see what the board would look like even for temporary invalid configurations.

### Submission
Compute `candidates` as legal COMBINE/SYM_COMBINE actions matching the current donors + donate amounts + symmetry config.
- If `candidates` is non-empty, submit `candidates[i]` (with `i` cycled by clicking `centerCid` again or the last clicked donor).
- Submission is only allowed if the action word exists in `legalSet`.

---

## State: Own

Own has two submodes:
- Primary: movement/kill/enslave/tribun attack
- Secondary: split/backstabb allocator

### Mode toggle
Clicking the origin tile toggles Primary↔Secondary, with the additional rules:
- In Secondary: origin click first clears allocations if any exist (see below).
- In Primary: origin click resets any selected target/options back to initial.

---

## State: Own.Primary

### Entry
- `originCid` is the clicked owned tile.
- Substate begins in `initial` phase (no target selected).

### Highlighted target tiles
Highlighted tiles are the union of targets reachable via either pattern variant (if available):
- empty tiles with MOVE actions (primary and/or secondary pattern)
- enemy tiles with KILL actions (primary and/or secondary pattern)
- enemy tiles with ENSLAVE (if possible)
- enemy tribun tile with ATTACK_TRIBUN

### C
- `originCid`
- all highlighted tiles

### Click behavior
#### 1) Click originCid
- If a target is currently selected, clear selection and return to initial phase.
- Otherwise toggle to Own.Secondary if available.

#### 2) Click a highlighted target
Select the target and build `options`:

A) Target is empty:
- `options = [MOVE secondary if present, MOVE primary if present]`

B) Target is enemy non-tribun:
- `options = [KILL secondary if present, KILL primary if present, ENSLAVE if present]`
(omit missing entries)

C) Target is enemy tribun:
- `options = [ATTACK_TRIBUN(originCid -> tribunCid)]` (single option)

Initial `i`:
- if `d=+1`: `i=0`
- if `d=-1`: `i=len(options)-1`

#### 3) Click the same target again
- If target is tribun: no-op (single fixed option).
- Else: cycle `i := (i + d) mod len(options)`.

### Submission
- submit `options[i]` if present and legal.

---

## State: Own.Secondary (Split/Backstabb allocator)

### Entry
- `originCid` is the selected owned tile.
- initialize `alloc[0..5] = 0`.
- Adjacent empty tiles are participants.

### Allowed allocation values (per neighbor)
Let `H0` be the origin primary height at entry.

For neighbor direction `k`, define:
- `remAfterOthers(k) = H0 - Σ alloc[j] (j != k)`

Allowed values for `alloc[k]` are:
- `{0} ∪ { x ∈ {1,2,3,4,6,8} | x <= remAfterOthers(k) }`

**Encoding constraint:** SPLIT encodes each neighbor allocation as a 3-bit value `0..7`.
If the UI cycles to `x=8`, that value can only be submitted as a BACKSTABB-style full transfer (if legal);
SPLIT submission MUST remain disabled for any allocation vector containing an 8.


This rule MUST be used; the UI MUST NOT enumerate all SPLIT actions to derive these values.

### C
- `originCid`
- adjacent empty tiles

### Click behavior
#### 1) Click originCid
- If any allocation is nonzero: clear all allocations to zero (initial display).
- Else: toggle back to Own.Primary.

#### 2) Click an adjacent empty tile (direction k)
- cycle `alloc[k]` within the allowed values for that k.

### Determining the pending action
If allocations yield a unique intended action:
- If `Σ alloc == H0` and origin has `secondary>0` and exactly one neighbor has nonzero allocation:
  - pending action is BACKSTABB to that neighbor direction.
- Else:
  - pending action is SPLIT with the `h0..h5 = alloc[0..5]`.

Submission is allowed iff the constructed action word exists in `legalSet`.

### Preview
The UI MUST show a preview of the board state that would result from the current allocation amounts, **even if the split is illegal** (e.g., invalid heights, allocations exceeding primary, etc.).
- The preview should directly construct the resulting board state from allocation amounts without searching through legal moves (which could be 10k+).
- This allows users to see what the board would look like even for temporary invalid configurations.
- Heights should be displayed directly as specified in the allocation amounts.

### Notes on temporary invalidity
The UI MAY temporarily display origin primary values that are invalid or violate SP.
However, submission MUST be disabled unless the action word is legal.
