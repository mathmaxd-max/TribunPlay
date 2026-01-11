# Turn Kinds (Normative)

On a player's turn, they MUST choose exactly one of the following **turn kinds** and execute it legally.

## Turn order
- At game start, one player is designated the **starting player** (independent of color).
- Turns alternate strictly between players.

Terminology:
- A unit is **owned** if its `color` equals the active player.
- A unit is **enemy** if its `color` equals the opponent.

## 1) Move
The player selects one owned unit and relocates it to a tile reachable by the chosen movement pattern.

### Pattern choice
- If the unit has `s > 0`, the player MUST choose either the primary pattern or the secondary pattern.
- If `s == 0`, only the primary pattern is available.

### Effects
- If the player chooses the **secondary** pattern:
  - The **entire unit** (primary + secondary + tribun flag) moves to the destination.
  - The origin becomes empty.
- If the player chooses the **primary** pattern:
  - Only the primary component moves; the secondary remains at origin.
  - If the origin has `p==0` and `s>0` after the move, **liberation** occurs (see `rules/02-units-heights-sp.md`).

## 2) Attack
The player selects a single enemy target unit and chooses a subset of owned units that can attack that target.

### Eligibility
A unit can participate as an attacker if, using either its primary or secondary pattern (but not both), the target is in its attack relation.

### Damage strength
For each participating attacker:
- Contributed strength is the chosen height (primary or secondary) that matched the attack pattern.

Let:
- `T = target.primary height` before the attack
- `S = sum(strength of all chosen attackers)`

Then the attack reduces the target's primary by:

- `D = min(T, S)`

### Tribun
If the target is a **tribun**, the game ends immediately (attacking the tribun is a win). There is no check/checkmate mechanic.

### Post-attack normalization
After reducing the target's primary by `D`, the target MUST be normalized:
- round down invalid heights
- enforce SP
- apply liberation if needed

If after normalization the tile is empty, then exactly one participating attacker MUST move into the emptied tile (using a legal movement consistent with the chosen part).

## 3) Enslave (Impero)
Enslave is an alternative outcome to an attack that would otherwise empty a non-tribun target.

### Preconditions
- Target is an enemy unit and **not** a tribun.
- Target has `secondary == 0`.
- The player selects attackers as in an attack such that the attack would remove the entire target primary (i.e., `S >= T`).

### Effects
Instead of removing the target and moving into the tile, the player may enslave:

1. The target flips control and becomes enslaved:
   - target's `color := attacker color` (controller)
   - target's `secondary := old target primary`
   - target's `primary := 0` temporarily
2. Exactly one participating attacker (using its **primary** pattern) moves its **primary height** onto the target tile:
   - target.primary becomes the moved primary height
   - the attacker loses that primary from its origin tile
3. If that moving attacker had a slave (`s>0`), that slave is **liberated** on the origin tile.
4. The resulting target unit MUST satisfy SP; if it would violate SP, the enslave is illegal.

## 4) Combine (2-donor)
The player selects:
- one empty center tile, and
- exactly two adjacent owned units (donors)

The player donates arbitrary positive amounts from the **primary heights** of the donors into the center.

### Effects
- A new unit of the same color is created at the center with:
  - `primary = sum(donated amounts)`
  - `secondary = 0`
  - `tribun = false` unless tribun participates (see below)
- Donor primary heights are reduced by their donated amounts.
- Donors are normalized (including liberation).

### Tribun participation
If a donor is a tribun:
- it MUST donate its entire primary height (leaving `p=0` at donor tile)
- the created unit becomes the new tribun (tribun flag transfers to the created unit)

### Validity constraints
- All resulting primary heights MUST be valid heights (or normalize into valid heights if rules allow; tournament play typically requires final validity).
- SP MUST NOT be violated for any resulting unit.

## 5) Symmetrical combination
The player selects one empty center tile and either:
- **3** adjacent donor tiles in one of the two symmetry configurations, or
- **6** adjacent donor tiles (all neighbors of the center)

### Symmetry configurations (3 tiles)
Let the center be `C`. A 3-tile configuration is legal iff donors occupy:
- `{C + dir0, C + dir4, C + dir5}` (equivalent to vectors `(+1,+1), (-1,0), (0,-1)`) or
- the inverse configuration `{C + dir3, C + dir1, C + dir2}`

### Additional constraints
- All donor units MUST be exactly equal.
- Tribun cannot participate.

### Donation rule
- For **6 donors**, each donates exactly **1** from primary.
- For **3 donors**, each donates either **1** or **2** from primary.

All donors donate the same amount.

### Effects
As in Combine, except:
- the created unit primary is `donate * donorCount`.

## 6) Split
The player selects one owned unit that is **not** a tribun and distributes its primary height into:
- its own tile, and
- any subset of empty adjacent tiles.

### Constraints
- All created primary heights MUST be valid.
- SP MUST NOT be violated.
- At least **two** resulting owned tiles must exist (count tiles that end with a nonzero owned unit).

Liberation applies at the origin if the primary becomes 0 while a slave remains.

## 7) Backstabb
The player selects one owned unit with `secondary > 0` and chooses an adjacent empty tile.

### Effects
- Place the unit's primary height onto the chosen adjacent empty tile as a new unit of the same color.
- The origin tile becomes empty.
- The secondary (enslaved) component is destroyed.
- Tribun is allowed; tribun flag moves with the primary.

## Notes on validity
UI may temporarily display invalid intermediate configurations, but **executed turns** MUST result in a valid board state after normalization rules are applied.
