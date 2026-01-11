# Server Architecture (Implementation Guide)

This backend is **server-authoritative** and event-sourced.

## Core components

### 1) Game Room
A game room owns:
- authoritative `State` (engine state + drawOfferBy + status)
- clocks (ms) and timing timestamps
- `ply` and append-only action log
- connected clients (2 players + N spectators)
- cached `legalSet` for the current state

Responsibilities:
- accept/validate player submissions
- append action to log and broadcast
- update clocks and emit timeout/tie as END actions
- handle join/reconnect/spectate and resync

### 2) Matchmaking
A queue keyed by:
- mode (single/pair)
- time control parameters
- optionally rating (future)

When two compatible players are available:
- create a game room
- seat players
- start match

### 3) Tournament Manager
Creates games and aggregates results according to:
- Stage 1 singles qualifier
- Stage 2 knockout pairs
- Stage 3 quad finals
Eliminated players become spectators.

Persist tournament state in DB (recommended for resumability).

## Authoritative action acceptance

### Acceptance rules
On receiving a candidate action word:
1. If game ended → reject
2. If opcode is DRAW or END(resign) → allow from either seated player subject to draw state rules
3. Else require:
   - sender is active player (seat matches state.turn)
   - action ∈ `legalSet`

### Commit pipeline (best practice)
On acceptance, perform:
1. Apply action via engine
2. Update clocks / drawOfferBy / status
3. Persist (transaction)
4. Broadcast binary action to all connections

If persistence fails, do NOT broadcast (avoid diverging replicas).

## Clock handling
Server computes per-turn think time using monotonic clock:
- apply buffer / increment rules
- if player main time < 0 → emit END(timeout-player, loserColor)
- if maxGameTime reached → emit END(timeout-game-tie)

Timeout END actions are server-emitted (clients must not send them).

## Spectators and resync
- Spectators receive snapshots + action log and live actions.
- Reconnect uses DB action log from last known `ply`.

## Scaling notes
- One room is single-threaded (serialize actions).
- Use one process or durable-object per room if deployed on edge runtimes.
- DB is the source of truth for history; in-memory is a cache.
