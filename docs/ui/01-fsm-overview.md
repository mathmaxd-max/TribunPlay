# UI FSM Overview (Normative)

This UI is a **tile-click finite state machine** with:
- Left click: `d = +1`
- Right click (desktop optional): `d = -1`
- Cycling is always `+d` modulo option length.

The UI maintains:
- a current UI state (Idle/Enemy/Empty/Own...)
- a **clickable tiles set C** for the current state
- a **selected action** (a uint32 action word) when submit is possible

The UI MUST NOT invent legality:
- A move/action is submittable only if it matches a single action word in the authoritative `legalSet`.

## Board Preview

The UI MUST show a preview of how the board would look after making a move, **even for temporary illegal moves**:
- This applies to all UI states (Enemy, Empty, Own.Primary, Own.Secondary).
- For Empty and Own.Secondary states, the preview should be constructed directly from user input (donors/donations or allocations) without validating against legal moves.
- The preview allows users to see the visual outcome of their selections before submission.
- Submission remains disabled unless the action word is legal.

## Inputs required from the engine
The client needs:
- `legalMoves[]` and `legalSet` for the current position (or at minimum `legalSet` + enough grouping for UI).

For performance, build a derived index:
- group legal actions by target tile, origin tile, etc.
(See `ui/02-fsm-state-details.md` for concrete groupings.)

## Global UI configuration
- `quickTransition: boolean`
  - If true and the user clicks a tile that has no meaning in the current state, the UI:
    1) cleans up to Idle, then
    2) re-processes the same click as an Idle click (if that tile is clickable from Idle).

## States
- Idle
- Enemy (target selected)
- Empty (combine/sym-combine into selected empty center)
- Own (origin selected) with submodes:
  - Primary (movement/kill/enslave/tribun attack)
  - Secondary (split/backstabb allocator)

## Global non-tile actions
Draw and resign are not naturally tile-addressed.
Best practice is to expose them as UI chrome controls:
- DRAW offer / retract / accept (opcode 10)
- RESIGN (opcode 11 reason=0)

They MAY be usable in any UI state.
