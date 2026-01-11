# WebSocket Message Examples

## Create + join (friend code)

Client A:
```json
{"t":"create_game","private":true,"timeControl":{"initialMs":600000,"bufferMs":5000,"incrementMs":2000,"maxGameMs":null}}
```

Server:
```json
{"t":"joined","gameId":"6a8f...","code":"AB12CD","role":"player","seat":"black","status":"lobby"}
```

Client B joins as opponent:
```json
{"t":"join_game","code":"AB12CD","role":"player","name":"Opponent"}
```

Server broadcasts updated lobby:
```json
{"t":"joined","gameId":"6a8f...","code":"AB12CD","role":"player","seat":"white","status":"active"}
```

Server sends snapshot:
```json
{
  "t":"start",
  "gameId":"6a8f...",
  "ply":0,
  "snapshot":{
    "initialTurn":0,
    "startingPlayerColor":1,
    "boardBytesB64":"AAECAwQ... (121 bytes)",
    "clocksMs":{"black":600000,"white":600000},
    "drawOfferBy":null
  }
}
```

## Submitting an action (binary)
Client sends one 4-byte frame containing the uint32 action word.

Example MOVE primary word `0x0000243C`:
- bytes (little-endian): `3C 24 00 00`

Server validates and broadcasts the identical 4 bytes to all participants.

## Resync
Client requests missing actions:
```json
{"t":"sync_req","gameId":"6a8f...","fromPly":42}
```

Server returns packed actions:
```json
{"t":"sync","gameId":"6a8f...","fromPly":42,"actionsB64":"PDQAAAC..."}
```
