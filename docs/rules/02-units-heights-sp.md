# Units, Heights, and Slave Property (Normative)

## Unit definition
A unit is described by four values:
1. **Color**: which player commands it (`black` or `white`)
2. **Tribun**: boolean; the leader unit for that side (exactly one per side)
3. **Primary height (p)**: movement/attack type and strength component
4. **Secondary height (s)**: height of an enslaved unit (usually `0`)

A tile is empty iff `p == 0` and `s == 0`.

## Valid heights
- Valid nonzero heights are: `{1,2,3,4,6,8}`.
- Height `0` means “absent”.

Invalid heights `{5,7,9+}` MUST NOT exist as **final stored primary heights** after normalization.

## Tribun constraints
- Each side has exactly **one** tribun unit.
- Tribun **cannot be enslaved**.
- **Liberation cannot create a tribun**: when a unit is liberated, the resulting unit MUST have `tribun=false`.
- The tribun flag is **glued to the primary** component:
  - If primary moves (or is moved as part of whole-stack movement), tribun moves with it.
  - If primary is removed from a tile (e.g., split of primary away, or move of primary away), tribun leaves with the primary.
  - If a tile becomes empty, tribun cannot remain.

Tribun MAY execute **Backstabb**. Tribun is still glued to the primary as above.

## Slave Property (SP)
If a unit has an enslaved component (`s > 0`), then it MUST satisfy:

- `p <= 4`, and
- `2*p >= s`.

If SP is violated after an operation, the unit's primary MUST be set to `0` (triggering possible liberation; see below).

## Height normalization (post-operation)
Normalization MUST be applied after any operation that changes a unit's heights, unless explicitly stated otherwise.

### 1) Round down invalid heights
If a unit's primary becomes invalid, it MUST be reduced to the next smaller valid height:

- `5 → 4`
- `7 → 6`
- `<=0 → 0`

(With the canonical height set, other invalid values SHOULD not occur.)

### 2) Enforce SP
If `s > 0` and SP is violated, set `p = 0`.

### 3) Liberation
If after steps (1) and (2) a unit has `p == 0` and `s > 0`, then **liberation** occurs:

- `p := s`
- `s := 0`
- `color := opposite(color)`
- `tribun := false`  (**mandatory**; liberation cannot create a tribun)

If after liberation the resulting `p` is invalid, it MUST be rounded down as in (1).

## Unit byte encoding (for DB snapshots)
For compact board storage, a unit MAY be stored as 1 byte:

- bits `0..2`: `pIndex` in `[0..7]` mapping to `[0,1,2,3,4,6,8,reserved]`
- bits `3..5`: `sIndex` in `[0..7]` mapping to `[0,1,2,3,4,6,8,reserved]`
- bit `6`: `color` (0 black, 1 white)
- bit `7`: `tribun` (1 true)

Empty tile MUST be encoded as `0x00`.

Implementations MUST ensure:
- tribun implies `p > 0`
- tribun implies `s == 0` (since tribun cannot be enslaved)
