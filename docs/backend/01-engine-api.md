# Rules Engine API (Implementation Guide)

The rules engine is a deterministic library used by:
- the authoritative server (required)
- clients (optional; for UI hints and local precomputation)

## Goals
- Deterministic `generateLegalActions(state) -> actions[]`
- Deterministic `applyAction(state, actionWord) -> nextState`
- No I/O, no randomness inside the engine

## Suggested TypeScript interfaces

```ts
export type Color = 0 | 1; // 0 black, 1 white

export interface Unit {
  color: Color;
  tribun: boolean;
  p: 0|1|2|3|4|6|8;
  s: 0|1|2|3|4|6|8;
}

export interface State {
  board: (Unit|null)[];      // length 121 (cid-based) OR length 91 (packed)
  turn: Color;
  drawOfferBy: Color|null;
  status: 'active'|'ended';
  // clocks usually live outside core move legality; server can manage them.
}
```

## Core functions

### `generateLegalActions(state)`
Returns all legal action words for the current state.
- MUST include board actions (opcodes 0–9) for the active player.
- MUST include draw actions (opcode 10) if legal given `drawOfferBy`.
- SHOULD include resign END action (opcode 11 reason=0) as always legal while active.
- MUST NOT include server-only END actions (no-legal-moves, timeouts).

The result SHOULD be stable-sorted for reproducibility:
- sort numerically ascending by uint32.

### `applyAction(state, word)`
Applies one action word.
- MUST reject illegal actions (server uses this as a safety net).
- MUST enforce:
  - tribun cannot be enslaved
  - liberation cannot create tribun
  - normalization rules (except for DAMAGE; see below)

### DAMAGE special rule
When applying opcode 3 (DAMAGE):
- Subtract `effectiveDamage` from target primary.
- MUST NOT re-run post-attack normalization; effective damage already encodes the final normalized outcome.
- The generator MUST guarantee DAMAGE cannot cause kill/liberate.

### Terminal actions
- opcode 9 (ATTACK_TRIBUN): ends game with winner.
- opcode 10 (DRAW accept): ends game as tie.
- opcode 11 (END): ends game with specified reason.

Once `status='ended'`, no further actions are legal.

## Caching and hashing
Legal move generation is recomputed each ply.
Implementations SHOULD cache results by a hash of:
- board units
- side to move
- drawOfferBy

A 64-bit Zobrist hash is recommended.

## Building a fast legality structure
The server SHOULD convert the action list into:
- `Set<number>` for O(1) acceptance of submitted action words.

Clients MAY do the same for UI validation.

## Attack outcomes
The generator MUST output *resolved outcome* actions:
- KILL / LIBERATE / DAMAGE(effective) / ENSLAVE
Attack subsets are not encoded and do not need to be transmitted.

The generator is responsible for determining which outcomes are legal based on the rules.
