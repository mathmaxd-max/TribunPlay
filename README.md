# Tribun MVP

A multiplayer game server built with Cloudflare Workers, Durable Objects, D1, and React.

## Tech Stack

- **Frontend**: Vite + React + TypeScript
- **Backend**: Cloudflare Worker + Durable Object (one DO instance per game room)
- **Database**: Cloudflare D1 (SQLite) for `games` and `game_actions`
- **Shared logic**: `packages/engine` TypeScript library used by both web and server

## Project Structure

```
├── apps/
│   ├── server/          # Cloudflare Worker + Durable Object
│   └── web/             # Vite React frontend
├── packages/
│   └── engine/          # Shared game engine logic
└── docs/                # Game rules and protocol documentation
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Cloudflare account (for deployment)
- Wrangler CLI (`npm install -g wrangler`)

### Installation

```bash
npm install
```

### Development

#### Start the web dev server

```bash
npm run dev:web
```

The web app will be available at `http://localhost:5173`

#### Start the server (Cloudflare Worker)

```bash
npm run dev:server
```

The server will be available at `http://localhost:8787`

**Note**: For local development, you'll need to:
1. Run `wrangler login` to authenticate with Cloudflare
2. Create a D1 database: `wrangler d1 create tribunplay-db`
3. Update `apps/server/wrangler.jsonc` with the actual `database_id`
4. Run migrations: `wrangler d1 migrations apply tribunplay-db --local` (for local) or `wrangler d1 migrations apply tribunplay-db` (for remote)

### Building

#### Build the web app

```bash
npm run build:web
```

#### Build the engine package

```bash
npm run build --workspace=packages/engine
```

### Deployment

#### Deploy the server to Cloudflare

```bash
npm run deploy:server
```

Before deploying:
1. Ensure you have a D1 database created
2. Update `apps/server/wrangler.jsonc` with the correct `database_id`
3. Run migrations: `wrangler d1 migrations apply tribunplay-db`

#### Deploy the web app to Cloudflare Pages

1. Build the web app: `npm run build:web`
2. Deploy the `apps/web/dist` directory to Cloudflare Pages
3. Configure the Pages project to proxy `/api` and `/ws` requests to your Worker

## MVP Features

- Create a game and receive a shareable code/link
- Join a game by code as opponent
- Play a deterministic game (server-authoritative) over WebSockets
- Spectate games
- Reconnect/resync works (action log replay)
- Game actions transmitted as uint32 (4 bytes) per action
- Moves persisted in D1 database in append-only action table

## Game Rules (MVP)

The MVP implements a simplified ruleset:
- 2 units only (one per side) on fixed positions
- Only MOVE actions to adjacent valid tiles
- No attacks, no combine, no split
- Basic draw and resign functionality

Full rules can be incrementally added later.

## API Endpoints

- `POST /api/game/create` - Create a new game
- `POST /api/game/join` - Join a game by code
- `GET /api/game/:code` - Get game info
- `GET /ws/game/:gameId?token=...` - WebSocket connection to game room

## License

ISC
