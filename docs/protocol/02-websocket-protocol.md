# WebSocket Protocol (Server-Authoritative) — Normative

This protocol supports:
- friend-code games
- random matchmaking
- tournaments
- spectators
- reconnect + resync

## Transport
- WebSocket connection.
- Two frame types:
  1) **Binary**: exactly 4 bytes (little-endian uint32) for action words.
  2) **JSON text**: control messages (join/start/sync/errors/metadata).

The server MUST be authoritative:
- Clients submit candidate action words.
- Server accepts iff action is legal for the current authoritative state.
- Server broadcasts accepted actions to all participants (players + spectators).

## Roles
- `player`: can submit actions for their seat.
- `spectator`: read-only; receives state and actions.

## Required server invariants
- Only the current active player MAY submit board actions (opcodes 0–9).
- DRAW actions (opcode 10) MAY be submitted by either player at any time.
- END(resign) MAY be submitted by either player at any time.
- TIMEOUT and NO_LEGAL_MOVES MUST be server-emitted (clients MUST NOT submit them).

## JSON message envelopes
All JSON messages MUST contain:
- `t`: message type string

### Client → Server

#### Create a game (friend code)
```json
{"t":"create_game","private":true,"timeControl":{"initialMs":600000,"bufferMs":5000,"incrementMs":2000,"maxGameMs":null}}
```

#### Join a game (player or spectator)
```json
{"t":"join_game","code":"AB12CD","role":"player","name":"Max"}
```

```json
{"t":"join_game","code":"AB12CD","role":"spectator","name":"Alice"}
```

#### Join matchmaking queue
```json
{"t":"queue_join","mode":"single","timeControl":{"initialMs":300000,"bufferMs":3000,"incrementMs":1000}}
```

#### Leave matchmaking queue
```json
{"t":"queue_leave"}
```

#### Resync request
```json
{"t":"sync_req","gameId":"<uuid>","fromPly":42}
```

### Server → Client

#### Game created / joined
```json
{"t":"joined","gameId":"<uuid>","code":"AB12CD","role":"player","seat":"black","players":{"black":{"name":"Max"},"white":null},"status":"lobby"}
```

Spectator:
```json
{"t":"joined","gameId":"<uuid>","code":"AB12CD","role":"spectator","status":"active"}
```

#### Start snapshot
The server SHOULD send a snapshot to all participants when a game becomes active.

```json
{
  "t":"start",
  "gameId":"<uuid>",
  "ply":0,
  "snapshot":{
    "initialTurn":0,
    "startingPlayerColor":1,
    "boardBytesB64":"<base64 of 121-byte board>",
    "clocksMs":{"black":600000,"white":600000},
    "drawOfferBy":null
  }
}
```

#### Clock update (optional but recommended)
```json
{"t":"clock","gameId":"<uuid>","ply":17,"turn":"white","clocksMs":{"black":523000,"white":481000}}
```

#### Sync response
```json
{"t":"sync","gameId":"<uuid>","fromPly":42,"actionsB64":"<base64 of packed uint32 list>"}
```

#### Error
```json
{"t":"err","code":"ILLEGAL_ACTION","msg":"Action not legal in current state"}
```

## Binary frames (action submission and broadcast)

### Client submission
Client sends 4-byte little-endian uint32 action word.

### Server broadcast
On acceptance, server broadcasts the same 4-byte action word to:
- both players
- all spectators

The server MUST assign ply order (append-only). Clients MUST apply actions strictly in broadcast order.

## Ordering and terminal states
- If a terminal action has been broadcast (opcode 9 ATTACK_TRIBUN, opcode 10 DRAW accept, opcode 11 END), the match is ended.
- After end, the server MUST reject further actions for that game.

If multiple actions arrive close together, server ordering determines the outcome.
