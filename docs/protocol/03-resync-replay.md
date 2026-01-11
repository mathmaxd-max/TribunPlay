# Resync, Replay, and Spectating (Normative)

## Authoritative history model
A match is defined by:
1) An **initial snapshot** (board + clocks + starting player), and
2) An append-only sequence of **action words** (uint32) indexed by `ply`.

Any client (player or spectator) MUST be able to reconstruct the current state by:
- loading the snapshot, and
- applying actions in order from `ply=0` to the latest.

## Snapshot contents (minimum)
A snapshot MUST include:
- `board`: 121 bytes (cid 0..120) encoded as unit bytes (see `rules/02-units-heights-sp.md`)
- `initialTurn` / `nextTurn` (color)
- clock times (ms) for both players
- `drawOfferBy` (null or color)
- `startingPlayerColor` (for analytics; not needed to replay)
- `timeControl` (for clock UI; not needed to validate moves once replayed)

## Packed action list encoding (recommended)
For JSON sync responses, actions SHOULD be packed as:
- concatenated little-endian uint32 values
- then base64 encoded (`actionsB64`)

This is compact and avoids JSON arrays of large length.

## Client resync algorithm
Given `fromPly` and server response:
1. Validate the response corresponds to the expected game.
2. Decode `actionsB64` into a byte array.
3. Split into 4-byte chunks; each chunk is a uint32 action word.
4. For each action:
   - apply it using `applyAction(state, actionWord)`
   - increment local ply

If any action fails to apply deterministically, the client MUST discard local state and request a full snapshot + full action list.

## Spectator join
On spectator join, server SHOULD:
- send the latest snapshot (or initial snapshot)
- send the full action list (or from last snapshot ply)
- start streaming new actions live

## State hashing (optional)
Implementations MAY compute a 64-bit hash after each ply and include it in clock updates:
- clients can detect desync early
- server can refuse invalid client state references

Hash MUST include:
- board units
- side to move
- draw offer state
(Clock values are optional for hash; choose consistently.)
