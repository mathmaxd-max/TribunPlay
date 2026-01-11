# Tribun MVP — Cursor Build Spec (Cloudflare Pages + Workers/DO + D1)

This file is intended to be **copied into your repo** and used as the single source of truth for Cursor to generate the MVP codebase.

## Goal (MVP)

A user can:
1. Open the website, create a game, and receive a shareable **code/link**
2. Another user can join by code/link as opponent
3. Both can play a deterministic game (server-authoritative) over **WebSockets**
4. A third user can spectate, and reconnect/resync works (action log replay)
5. Game actions are transmitted as **uint32** (4 bytes) per action; control messages are JSON
6. Moves are persisted in a database (Cloudflare **D1**) in an append-only action table

> Note: UI can be minimal for MVP (board rendering can be simple). The main requirement is end-to-end multiplayer play.

---

## Tech Stack

- Frontend: **Vite + React + TypeScript**
- Backend: **Cloudflare Worker** + **Durable Object** (one DO instance per game room)
- Database: **Cloudflare D1 (SQLite)** for `games` and `game_actions`
- Shared logic: `packages/engine` TypeScript library used by both web and server

---

## Repository Layout

Create these folders:

```
docs/
apps/
  web/
  server/
packages/
  engine/
```

Use a workspace at repo root:

- Root `package.json` with workspaces `["apps/*", "packages/*"]`
- Single root `package-lock.json` (npm) is acceptable for MVP

---

## 1) Root Workspace Files

### 1.1 Root `package.json`

Create/update `package.json` at repo root:

- name: `tribun`
- private: true
- workspaces: `["apps/*", "packages/*"]`
- scripts:
  - `dev:web` → runs web dev server
  - `dev:server` → runs wrangler dev
  - `build:web` → builds web
  - `deploy:server` → deploys worker
  - `lint` optional

### 1.2 Root `tsconfig.base.json`

A shared TS config for both apps.

---

## 2) Shared Engine (`packages/engine`)

### 2.1 Purpose

The engine provides:
- Coordinate encoding/decoding (cid 0..120)
- Action word encoding/decoding (uint32)
- Minimal state representation for MVP
- `generateLegalMoves(state)` and `applyAction(state, action)` **stubs** for now

For MVP you may:
- Implement a **very simple ruleset** first (e.g., allow MOVE only) to verify end-to-end networking, persistence, resync.
- Then replace with full rules later.
- However, the API must be stable.

### 2.2 Engine Public API (must exist)

Create `packages/engine/src/index.ts` exporting:

- `type Color = 0 | 1`
- `type Height = 0|1|2|3|4|6|8`
- `interface Unit { color: Color; tribun: boolean; p: Height; s: Height }`
- `interface State { board: Uint8Array; turn: Color; ply: number; drawOfferBy: Color|null }`
- `encodeCoord(x:number,y:number): number`
- `decodeCoord(cid:number): {x:number,y:number}`
- `isValidTile(cid:number): boolean`
- `encodeAction...` helpers for:
  - MOVE, KILL, LIBERATE, DAMAGE (effective), ENSLAVE, COMBINE, SYM_COMBINE, SPLIT, BACKSTABB
  - ATTACK_TRIBUN, DRAW, END
- `decodeAction(action:number): { opcode:number, fields: Record<string, number> }`
- `generateLegalActions(state: State): Uint32Array` (stub OK for MVP; return a small set)
- `applyAction(state: State, action:number): State` (must be deterministic)
- `packBoard(board: Uint8Array): string` base64 for JSON transport
- `unpackBoard(b64: string): Uint8Array`

### 2.3 Unit-byte encoding (MVP-ready)

Use 1 byte per tile:
- bits 0..2: primary index in [0,1,2,3,4,6,8,reserved]
- bits 3..5: secondary index
- bit 6: color
- bit 7: tribun

Provide helpers:
- `unitByteToUnit(b: number): Unit|null`
- `unitToUnitByte(u: Unit|null): number`

---

## 3) Backend (`apps/server`) — Cloudflare Worker + Durable Object + D1

### 3.1 Requirements

Implement:
- HTTP API endpoints:
  - `POST /api/game/create` → creates game row, returns `{ gameId, code, token, wsUrl }`
  - `POST /api/game/join` with `{ code }` → seats player if available, returns `{ gameId, seat, token, wsUrl }`
  - `GET /api/game/:code` → returns `{ gameId, status }` (optional)
- WebSocket endpoint:
  - `GET /ws/game/:gameId?token=...` → upgrades to WS and attaches to the game Durable Object

Durable Object:
- One instance per game (keyed by gameId)
- Keeps in-memory state: current `State`, `legalSet`, connected clients
- On connection:
  - loads game + actions from D1
  - rebuilds state by replay (or from stored snapshot)
  - sends snapshot + action log to the client
- On binary message (4 bytes):
  - validate role + turn + legality (`action in legalSet`)
  - apply action, increment ply, update turn, update draw state, etc.
  - persist to D1 in `game_actions`
  - broadcast to all connections (binary 4 bytes)
- On JSON message:
  - support draw actions and resign requests if desired; server emits the authoritative uint32 action

### 3.2 D1 Schema (SQLite)

Add a migration SQL under `apps/server/migrations/0001_init.sql`:

Tables:

`games`:
- `id TEXT PRIMARY KEY` (uuid)
- `code TEXT UNIQUE`
- `status TEXT` ('lobby','active','ended')
- `created_at TEXT`
- `started_at TEXT`
- `ended_at TEXT`
- `black_player_id TEXT`
- `white_player_id TEXT`
- `black_token TEXT`
- `white_token TEXT`
- `starting_player_color INTEGER`
- `initial_turn INTEGER`
- `initial_board BLOB` (121 bytes)
- `time_control_json TEXT`
- `ply INTEGER`
- `turn INTEGER`
- `clock_black_ms INTEGER`
- `clock_white_ms INTEGER`
- `draw_offer_by INTEGER NULL`
- `winner_color INTEGER NULL`
- `end_opcode INTEGER NULL`
- `end_reason INTEGER NULL`

`game_actions`:
- `game_id TEXT`
- `ply INTEGER`
- `action_u32 INTEGER` (store as signed 64-bit in SQLite)
- `actor_color INTEGER NULL`
- `think_ms INTEGER NULL`
- `created_at TEXT`
- PRIMARY KEY (`game_id`,`ply`)

### 3.3 Server config

`wrangler.toml` (or `wrangler.jsonc`) must define:
- Durable Object binding `GAME_ROOM`
- D1 binding `DB`
- compatibility date
- migrations folder

---

## 4) Frontend (`apps/web`) — Minimal UI

### 4.1 Pages

Implement two routes:

- `/` Create/Join
  - Create game button
  - Join game form (code)
  - Shows link `/game/:code`
- `/game/:code`
  - Connects to backend:
    - POST join or spectate based on URL params
    - Opens WS to `wsUrl`
  - Displays:
    - connection state
    - seat/turn
    - clocks (simple)
    - a minimal board render (grid list of coordinates is fine)
    - a list of legal actions (derived client-side using `generateLegalActions` OR sent by server as JSON)
  - Allows sending an action:
    - if you have list: click sends 4-byte uint32 on WS

### 4.2 Networking

- Use fetch to call API on same origin if you proxy `/api` to worker; otherwise configure `VITE_API_BASE`.
- WebSocket binary handling:
  - send: 4-byte ArrayBuffer with uint32 LE
  - receive: 4-byte ArrayBuffer; applyAction locally to update UI state

### 4.3 Resync

On WS open, server sends JSON:
- `{ t:"start", snapshot:{ boardB64, turn, ply, clocks... }, actions:[u32...] }`
Client:
- loads snapshot
- replays actions in order
- then applies streamed actions

---

## 5) Minimal Engine Rules for MVP

To get playable quickly, implement a **temporary MVP ruleset**:

- Start with 2 units only (one per side) on fixed positions
- Allow only MOVE actions to adjacent valid tiles (like tribun t1)
- No attacks, no combine, no split
- End conditions can be omitted initially

This validates:
- code/link creation
- joining
- ws realtime
- persistence/replay
- spectators

Then you can incrementally add full rules.

---

## 6) Implementation Checklist (Cursor should produce code)

Cursor must generate:

- Root workspace `package.json` + `tsconfig.base.json`
- `packages/engine` with buildable TS library and the API described above
- `apps/server` Cloudflare Worker:
  - HTTP API routes
  - Durable Object with WS handling
  - D1 migrations + binding
  - `wrangler` config
- `apps/web` Vite React app:
  - create/join UI
  - game page with WS connection
  - action list and send/receive uint32
- Basic README in repo root describing dev + deploy commands

---

## 7) Commands (expected)

From repo root:

- Install: `npm install`
- Dev web: `npm run dev:web`
- Dev server: `npm run dev:server`
- Deploy server: `npm run deploy:server`
- Build web: `npm run build:web`

---

## 8) Best Practices / Non-Goals for MVP

- Do not over-engineer UI (no full hex rendering required)
- Keep backend authoritative; never trust client-submitted clocks
- Log every accepted action to DB before broadcasting
- Keep WS protocol stable (binary for actions, JSON for control)

---

## 9) Deliverables

After Cursor completes, you should be able to:

1. Run both dev servers locally
2. Create and join a game locally
3. Deploy server to Cloudflare (Workers)
4. Deploy web to Cloudflare Pages and connect your domain
5. Play a simple match end-to-end
