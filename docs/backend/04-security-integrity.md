# Security and Integrity Notes (Implementation Guide)

## Threat model (practical)
Assume clients may:
- submit illegal action words
- attempt to play out of turn
- spam actions
- spoof draw/abort behavior
- attempt to desync spectators by replaying different logs

## Controls (recommended)

### Server-authoritative legality
- Maintain `legalSet` for the current state.
- Accept a submitted action only if it is in `legalSet` and role/turn constraints are satisfied.

### Serialize per-room
- Process actions for a game room sequentially.
- Assign authoritative `ply` ordering on the server.

### Rate limiting
- Apply per-connection and per-room rate limits on action submissions.
- Disconnect or temporarily ban abusive clients.

### Authentication (optional but recommended)
- For ranked/tournaments: require authenticated identities.
- For casual friend-code games: anonymous identities are acceptable.

### Database as source of truth
- Persist before broadcast.
- On restart, reconstruct room state from DB snapshot + action log.

### Deterministic replay checks
- Optionally compute and store a state hash every N plies.
- On resync, send hash hints to allow client desync detection.

### Clock integrity
- Compute think times on server (monotonic clock).
- Never trust client-submitted timestamps.

## Spectator permissions
- Tournament manager may grant spectatorship to eliminated players automatically.
- Private games may restrict spectators by requiring the friend code.
