# Glossary

## Entities
- **Tile**: One hex cell on the board.
- **Board coordinate**: Integer pair `(x, y)`; see `rules/01-board-coordinates.md`.
- **cid**: Coordinate id in `[0..120]` used in encodings. Derived from `(x,y)` on an 11×11 grid.
- **Unit**: A stack-like piece on a tile with properties: `color`, `tribun`, `primary height`, `secondary height`.

## Players and colors
- **Player**: One of two participants.
- **Color**: `black` or `white`. In encodings: `0 = black`, `1 = white`.

## Heights
- **Primary height (p)**: The unit's main height (movement/attack type).
- **Secondary height (s)**: Height of an enslaved unit (belongs to the opponent in origin but is controlled by this unit).
- **Valid heights**: `{1,2,3,4,6,8}`. Height `0` means "absent/empty".
- **Invalid heights**: `{5,7,9+}` are never stored as valid *unit* primary heights after normalization.

## Tribun
- **Tribun**: The leader unit for a side (exactly one per side). Game ends when a tribun is attacked.
- **Tribun flag**: A boolean attached to the **primary** component only.
  - Tribun **cannot be enslaved**.
  - **Liberation cannot create a tribun** (liberated units always have `tribun=false`).

## Slave property (SP)
A constraint on units with a secondary height:
- If `s > 0`, then:
  - `p <= 4`, and
  - `2*p >= s`.
This MUST hold for valid units after normalization.

## Turns and actions
- **Turn**: One player chooses exactly one *turn kind* and executes it (or a game-control action like draw offer/resign).
- **Action**: A single 32-bit word (uint32) recorded in the game log. Includes board actions and game-control actions.

## UI terms
- **Clickable tiles set (C)**: Tiles that have meaning in the current UI state.
- **Unclickable tiles set (U)**: Tiles that do not have meaning in the current UI state.
- **d**: click direction, `d = +1` for left click, `d = -1` for right click.
