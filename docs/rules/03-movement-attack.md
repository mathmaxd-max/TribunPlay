# Movement and Attack Patterns (Normative)

This section defines how a unit's **height** determines its movement and attack relations.

## Conventions

### Directions
Use the direction vectors from `rules/01-board-coordinates.md`.

### Color orientation
Height **1** depends on color:
- For **black**, the "forward" direction is `(+1,+1)` and the two forward-diagonals are `(+1,0)` and `(0,+1)`.
- For **white**, these vectors are **negated**.

All other heights are color-independent unless specified.

### Pattern choice (primary vs secondary)
For units with both `p` and `s`:
- For a given action, the player MUST choose **exactly one** of the two patterns (primary or secondary).
- Encodings represent this choice via a `part` bit (`0=primary`, `1=secondary`).

For **movement** with `part=1` (secondary pattern):
- The **entire unit stack** (primary + secondary + tribun flag) moves using the secondary pattern.

For movement with `part=0` (primary pattern):
- Only the primary component moves; any secondary remains on the origin tile (possibly triggering liberation).

## Tribun movement
The tribun is represented by the `tribun` flag on a unit.

- `t1` (tribun with height 1): moves and attacks adjacent hexagons (king-like on hex grid).
- For `tn` with `n > 1`: it moves/attacks as height `n` (no special behavior beyond normal height rules).

## Height patterns

### Height 1
- **Move**:
  - black: `(+1,+1)`
  - white: `(-1,-1)`
- **Attack**:
  - black: `(+1,0)` and `(0,+1)`
  - white: `(-1,0)` and `(0,-1)`

### Tribun height 1 (t1)
Moves and attacks all 6 adjacent tiles.

### Height 2
Moves and attacks by the following offsets (and their inverses):
- `(+1,+2)`, `(-1,+1)`, `(+2,+1)`, and multiply by `(-1)`.

### Height 3
Moves and attacks by the following offsets (and their inverses):
- `(+3,+2)`, `(+2,+3)`, `(+1,+3)`, `(+3,+1)`, `(-1,+2)`, `(+2,-1)`, and inverses.

### Height 4 (sliding like rook/bishop on hex)
- Choose one of the height-2 offsets as a direction vector `v`.
- Repeatedly add `v` until either:
  - a unit is encountered, or
  - the board border is hit.

Movement:
- May move to any empty tile on this ray before the first occupied tile.

Attack:
- May attack only the **first** occupied tile on the ray, and only if it contains an enemy unit.

### Height 6 (sliding move, expanding t1 attack)
Movement:
- Same as height 4 movement.

Attack:
- Repeatedly apply the `t1` adjacency expansion outward until a tile containing a unit is hit.
- The height-6 unit attacks **only** if the first encountered unit is an enemy.

(Implementations SHOULD precompute attack rays for performance.)

### Height 8 (mobile + jump)
A height-8 unit:
- Always attacks as the **height-2** pattern (regardless of movement).
- Always moves and attacks as `t1` adjacency (all 6 neighbors).

Additional jump move/attack:
- Let `v` be one of the 6 adjacency vectors (t1).
- The unit may move/attack to `+2*v` **iff** the intermediate tile `+v` is:
  - empty, or
  - occupied by a unit of the same color.
- The unit MAY jump over friendly units, but MUST NOT jump over enemy units.

## Attack eligibility
A unit can participate as an attacker if, using its chosen pattern (primary or secondary), the target tile is within its attack relation.

Attack participation sets may be large, but the final recorded action (e.g., DAMAGE/KILL/LIBERATE) does not encode the subset.

The rules for converting attacker heights to damage are defined in `rules/04-turn-types.md`.
