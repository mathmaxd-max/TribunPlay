# Tribun — Technical Documentation (Spec + Implementation Guide)

**Spec version:** 0.1 (draft)
**Generated:** 2026-01-11


This documentation defines **Tribun** (rules), the **binary action encoding**, the **server-authoritative multiplayer backend**, the **database persistence model**, and the **tile-click UI finite state machine (FSM)**.

It is written to be:
- **Explicit**: normative requirements use **MUST / SHOULD / MAY**.
- **Unambiguous**: all encodings and algorithms are deterministic.
- **AI-friendly**: consistent headings, small sections, examples, and stable terms.

## Contents

### Game rules (normative)
- [`rules/00-glossary.md`](rules/00-glossary.md)
- [`rules/01-board-coordinates.md`](rules/01-board-coordinates.md)
- [`rules/02-units-heights-sp.md`](rules/02-units-heights-sp.md)
- [`rules/03-movement-attack.md`](rules/03-movement-attack.md)
- [`rules/04-turn-types.md`](rules/04-turn-types.md)
- [`rules/05-game-end-clock.md`](rules/05-game-end-clock.md)
- [`rules/06-scoring-tournament.md`](rules/06-scoring-tournament.md)

### Action encoding + protocol (normative)
- [`protocol/01-action-word.md`](protocol/01-action-word.md)
- [`protocol/02-websocket-protocol.md`](protocol/02-websocket-protocol.md)
- [`protocol/03-resync-replay.md`](protocol/03-resync-replay.md)

### Backend architecture (implementation guide)
- [`backend/01-engine-api.md`](backend/01-engine-api.md)
- [`backend/02-server-architecture.md`](backend/02-server-architecture.md)
- [`backend/03-database-schema.md`](backend/03-database-schema.md)
- [`backend/03-database-schema.sql`](backend/03-database-schema.sql)
- [`backend/04-security-integrity.md`](backend/04-security-integrity.md)

### UI FSM (normative for client behavior)
- [`ui/01-fsm-overview.md`](ui/01-fsm-overview.md)
- [`ui/02-fsm-state-details.md`](ui/02-fsm-state-details.md)
- [`ui/03-fsm-examples.md`](ui/03-fsm-examples.md)

### Examples
- [`examples/01-action-examples.md`](examples/01-action-examples.md)
- [`examples/02-ws-messages.md`](examples/02-ws-messages.md)
- [`examples/03-db-queries.md`](examples/03-db-queries.md)
- [`examples/04-tournament-flow.md`](examples/04-tournament-flow.md)
- [`examples/sample_initial_snapshot.json`](examples/sample_initial_snapshot.json)

## Normative language
This spec uses RFC 2119-style keywords:
- **MUST**: mandatory requirement.
- **SHOULD**: recommended unless there is a clear reason not to.
- **MAY**: optional.

## Out of scope
- Visual design and rendering.
- AI opponent / engine evaluation (only legal move generation is covered).
