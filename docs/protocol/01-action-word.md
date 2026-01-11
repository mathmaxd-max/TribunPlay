# 32-bit Action Word Encoding (Normative)

All game events that change match state are encoded as a single 32-bit unsigned integer (**uint32**) called an **action word**.

## Wire format
- Transported as **4 bytes** in **little-endian** order.
- Interpreted as an unsigned 32-bit integer in `[0..4294967295]`.

## Layout
- Bits `28..31` (4 bits): `opcode`
- Bits `0..27`  (28 bits): `payload`

Notation:
- `word = (opcode << 28) | payload`

## Common fields

### Coordinate id (cid)
- 7-bit `cid` in `[0..120]` (see `rules/01-board-coordinates.md`).
- Payload fields that store a coordinate use 7 bits.

### part bit
For MOVE and KILL:
- `part=0` means primary pattern (moves primary only).
- `part=1` means secondary pattern (moves entire stack).

## Opcode summary

| opcode | name          | terminal | notes |
|--------|---------------|----------|------|
| 0 | MOVE        | no  | relocate unit |
| 1 | KILL        | no  | attack empties target and one attacker moves in |
| 2 | LIBERATE    | no  | attack outcome that liberates a slave |
| 3 | DAMAGE      | no  | **effective** damage; strictly less than target primary |
| 4 | ENSLAVE     | no  | enslave (impero) outcome |
| 5 | COMBINE     | no  | 2-donor combine |
| 6 | SYM_COMBINE | no  | 3- or 6-donor symmetric combine |
| 7 | SPLIT       | no  | split primary into adjacent tiles |
| 8 | BACKSTABB   | no  | destroy slave, sidestep primary |
| 9 | ATTACK_TRIBUN | yes | win by attacking tribun |
| 10| DRAW        | depends | offer/retract/accept; accept ends game |
| 11| END         | yes | resign / no-legal-moves / timeouts |

Opcodes 12–15 are reserved.

---

## Opcode 0: MOVE
Payload bits:
- `0..6`   `fromCid`
- `7..13`  `toCid`
- `14`     `part` (0 primary, 1 secondary)

---

## Opcode 1: KILL
Payload bits:
- `0..6`   `attackerCid`  (the unit that moves into target)
- `7..13`  `targetCid`
- `14`     `part`         (movement pattern used by the moving attacker)

---

## Opcode 2: LIBERATE
Payload bits:
- `0..6`   `targetCid`

---

## Opcode 3: DAMAGE (effective)
Payload bits:
- `0..6`   `targetCid`
- `7..9`   `effDmgMinus1`  → `effectiveDamage = effDmgMinus1 + 1` (1..8)

### Semantics (normative)
- DAMAGE MUST represent the **effective** reduction in target primary after all normalization rules.
- DAMAGE MUST be strictly less than the target's current primary height (otherwise KILL or LIBERATE is used).
- When applying DAMAGE during replay:
  - `target.primary := target.primary - effectiveDamage`
  - No further normalization is applied for this action (the generator has already baked it in).

---

## Opcode 4: ENSLAVE
Payload bits:
- `0..6`   `attackerCid` (the attacker that moves its primary onto target)
- `7..13`  `targetCid`

---

## Opcode 5: COMBINE
Payload bits:
- `0..6`   `centerCid` (empty)
- `7..9`   `dirA` (0..5), donor A at `center + dirA`
- `10..12` `dirB` (0..5), donor B at `center + dirB`
- `13..15` `donAminus1` → donateA = +1 (1..8)
- `16..18` `donBminus1` → donateB = +1 (1..8)

---

## Opcode 6: SYM_COMBINE
Payload bits:
- `0..6`   `centerCid`
- `7..8`   `config`:
  - `0` = 6 donors (all neighbors)
  - `1` = 3 donors (3+)
  - `2` = 3 donors (3-)
  - `3` reserved
- `9..10`  `donMinus1`:
  - donate = `donMinus1 + 1`
  - For config=0 (6 donors), donate MUST be 1.

---

## Opcode 7: SPLIT
Payload bits:
- `0..6`   `actorCid`
- `7..9`   `h0` amount placed on neighbor dir0 (0..7)
- `10..12` `h1`
- `13..15` `h2`
- `16..18` `h3`
- `19..21` `h4`
- `22..24` `h5`

Remainder stays on actor tile:
- `rem = actorPrimary - (h0+h1+h2+h3+h4+h5)`

### Encoding note
- Each `h0..h5` is a 3-bit value in `0..7`.
- Therefore SPLIT cannot encode allocating **8** directly to a neighbor.
- To move a full primary height of 8 off the origin in one step, use BACKSTABB (opcode 8) when legal.


---

## Opcode 8: BACKSTABB
Payload bits:
- `0..6`   `actorCid`
- `7..9`   `dir` destination neighbor direction

---

## Opcode 9: ATTACK_TRIBUN (terminal)
Payload bits:
- `0..6`   `attackerCid`
- `7..13`  `tribunCid`
- `14`     `winnerColor` (0 black, 1 white)

### UI constraint
Tribun attack selection MUST NOT toggle between primary/secondary variants; it is a single fixed action.

---

## Opcode 10: DRAW (offer/retract/accept)
Payload bits:
- `0..1`   `drawAction`:
  - `0` offer
  - `1` retract
  - `2` accept
  - `3` reserved
- `2`      `actorColor` (0 black, 1 white)

Rules:
- Draw actions MAY occur at any time (not only on turn).
- Accept ends the game immediately as a tie.

---

## Opcode 11: END (terminal)
Payload bits:
- `0..2`   `endReason`:
  - `0` resign
  - `1` no-legal-moves
  - `2` timeout-player (loss)
  - `3` timeout-game-tie (max total game time reached)
  - `4..7` reserved
- `3`      `loserColor` (meaningful for reasons 0..2; ignored for reason 3)

---

## TypeScript helpers (example)
```ts
export function op(word: number): number { return (word >>> 28) & 0xF; }
export function payload(word: number): number { return word & 0x0FFFFFFF; }

export function make(opcode: number, payload: number): number {
  return (((opcode & 0xF) << 28) | (payload & 0x0FFFFFFF)) >>> 0;
}
```
