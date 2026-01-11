# Database Schema (Postgres / Supabase) — Implementation Guide

This schema supports:
- friend-code games
- matchmaking games
- spectators (via replay)
- tournaments with persistent brackets
- append-only action logs (event sourcing)

## Design principles
- **Event sourcing**: store initial snapshot + append-only action rows.
- **Atomicity**: game row summary and action insert must occur in one transaction.
- **uint32 safety**: store action words as `BIGINT` with a 0..4294967295 check.

## Core tables

### `games`
One row per game room/match.

Key columns:
- `initial_board (bytea)`: 121 bytes, indexed by `cid 0..120`, unit-byte encoded.
- `time_control (jsonb)`: `{initialMs, bufferMs, incrementMs, maxGameMs?}`
- `ply`: last committed ply count
- `clock_black_ms`, `clock_white_ms`: remaining time
- `draw_offer_by`: null/0/1
- `status`: lobby/active/ended

### `game_actions`
Append-only log of actions.
- Primary key `(game_id, ply)` enforces strict ordering.
- `action_u32 (bigint)` stores the uint32 action word.
- `think_ms` stores the server-measured think time for tiebreaks.

### `game_snapshots` (optional)
Periodic snapshots for faster join on long games.
Not required initially.

## Tournaments
Use:
- `tournaments`
- `tournament_players`
- `tournament_matches`
- `tournament_match_games`

These provide a resumable tournament state.

## Transaction pattern (best practice)
On accepting an action:
1. `INSERT game_actions(...)`
2. `UPDATE games SET ply=ply+1, clocks..., draw_offer_by..., status...`
3. Commit
4. Broadcast the accepted action

Broadcast MUST NOT occur before commit.

See `examples/03-db-queries.md` for sample SQL.
