# TribunPlay Hosting Guide

This document describes the current state and structure of the TribunPlay project to assist with hosting and deployment.

## Project Overview

TribunPlay is a multiplayer turn-based strategy game built as a full-stack application with:
- **Frontend**: React + TypeScript + Vite (SPA)
- **Backend**: Cloudflare Workers + Durable Objects
- **Database**: Cloudflare D1 (SQLite)
- **Architecture**: Monorepo using npm workspaces

## Project Structure

```
TribunPlay/
├── apps/
│   ├── server/              # Cloudflare Worker + Durable Object backend
│   │   ├── src/
│   │   │   ├── index.ts              # Main worker entry point
│   │   │   ├── durable-objects/
│   │   │   │   └── GameRoom.ts       # Durable Object for game state management
│   │   │   └── endpoints/            # REST API endpoints
│   │   │       ├── gameCreate.ts
│   │   │       ├── gameJoin.ts
│   │   │       └── gameGet.ts
│   │   ├── migrations/
│   │   │   └── 0001_init.sql         # Database schema
│   │   ├── wrangler.jsonc            # Cloudflare Worker configuration
│   │   └── package.json
│   └── web/                  # React frontend application
│       ├── src/
│       │   ├── main.tsx              # React entry point
│       │   ├── App.tsx               # Main app component
│       │   ├── pages/
│       │   │   ├── Home.tsx          # Landing page (create/join game)
│       │   │   └── Game.tsx          # Game board UI
│       │   └── ui/                   # UI components and caching
│       ├── vite.config.ts            # Vite build configuration
│       ├── index.html
│       └── package.json
├── packages/
│   └── engine/               # Shared game logic (used by both web and server)
│       ├── src/
│       │   ├── index.ts              # Game engine exports
│       │   └── ui-backend.ts        # UI/backend shared utilities
│       └── package.json
├── docs/                     # Game rules, protocol, and architecture docs
├── package.json              # Root workspace configuration
└── tsconfig.base.json        # Shared TypeScript configuration
```

## Technology Stack

### Frontend (`apps/web`)
- **Framework**: React 18.2.0
- **Build Tool**: Vite 5.0.0
- **Language**: TypeScript 5.0+
- **Routing**: React Router DOM 6.20.0
- **Port**: 5173 (development)

### Backend (`apps/server`)
- **Runtime**: Cloudflare Workers
- **Framework**: Hono 4.6.20 (HTTP framework)
- **OpenAPI**: chanfana 2.6.3 (OpenAPI 3.1 generation)
- **Validation**: Zod 3.24.1
- **State Management**: Durable Objects (one per game room)
- **Port**: 8787 (development)

### Database
- **Type**: Cloudflare D1 (SQLite)
- **Database Name**: `tribunplay-db`
- **Tables**:
  - `games`: Game metadata and state
  - `game_actions`: Append-only action log (for replay/resync)

### Shared Package
- **Package**: `@tribunplay/engine`
- **Purpose**: Game logic shared between frontend and backend
- **Usage**: Imported as workspace dependency in both apps

## API Endpoints

The backend exposes the following endpoints:

### REST API
- `POST /api/game/create` - Create a new game
- `POST /api/game/join` - Join a game by code
- `GET /api/game/:code` - Get game information

### WebSocket
- `GET /ws/game/:gameId?token=...` - WebSocket connection to game room
  - Requires authentication token as query parameter
  - Connects to a Durable Object instance for the game

## Frontend-Backend Communication

### Development
- Frontend runs on `http://localhost:5173`
- Backend runs on `http://localhost:8787`
- Vite proxy configuration routes `/api` and `/ws` to the backend

### Production
- Frontend uses relative paths (`/api/...`, `/ws/...`)
- These paths must be proxied to the Cloudflare Worker
- WebSocket connections use `wss://` in production (detected via `window.location.protocol`)

## Build and Deployment

### Prerequisites
- Node.js 18+ and npm
- Cloudflare account
- Wrangler CLI installed globally: `npm install -g wrangler`

### Build Commands

```bash
# Install all dependencies
npm install

# Build the frontend
npm run build:web
# Output: apps/web/dist/

# Build the engine package (if needed)
npm run build --workspace=packages/engine

# Deploy the backend
npm run deploy:server
```

### Backend Deployment Steps

1. **Authenticate with Cloudflare**:
   ```bash
   wrangler login
   ```

2. **Create D1 Database** (if not exists):
   ```bash
   wrangler d1 create tribunplay-db
   ```
   This will output a `database_id` that you need to use in the next step.

3. **Update Configuration**:
   - Edit `apps/server/wrangler.jsonc`
   - Replace `"database_id": "placeholder-id"` with the actual database ID from step 2

4. **Run Database Migrations**:
   ```bash
   cd apps/server
   wrangler d1 migrations apply tribunplay-db
   ```

5. **Deploy Worker**:
   ```bash
   npm run deploy:server
   ```
   Or from root:
   ```bash
   npm run deploy:server
   ```

   The worker will be deployed to: `https://tribunplay-server.<your-subdomain>.workers.dev`

### Frontend Deployment

The frontend is a static SPA that needs to be hosted with API proxying:

1. **Build the frontend**:
   ```bash
   npm run build:web
   ```

2. **Deploy Options**:

   **Option A: Cloudflare Pages** (Recommended)
   - Upload `apps/web/dist/` directory
   - Configure custom domain (optional)
   - Set up proxy rules:
     - `/api/*` → `https://tribunplay-server.<your-subdomain>.workers.dev/api/*`
     - `/ws/*` → `https://tribunplay-server.<your-subdomain>.workers.dev/ws/*`
   - Use Cloudflare Pages Functions or Workers for proxying

   **Option B: Other Static Hosting**
   - Deploy `apps/web/dist/` to any static host (Vercel, Netlify, etc.)
   - Configure reverse proxy/rewrite rules:
     - `/api/*` → Backend Worker URL
     - `/ws/*` → Backend Worker URL (WebSocket upgrade required)

## Configuration Files

### `apps/server/wrangler.jsonc`
```jsonc
{
  "name": "tribunplay-server",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-11",
  "durable_objects": {
    "bindings": [
      {
        "name": "GAME_ROOM",
        "class_name": "GameRoom",
        "script_name": "tribunplay-server"
      }
    ]
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tribunplay-db",
      "database_id": "YOUR_DATABASE_ID_HERE"  // Must be updated!
    }
  ]
}
```

### `apps/web/vite.config.ts`
- Development proxy configuration (not used in production)
- Production builds are static and rely on hosting provider for proxying

## Environment Requirements

### Development
- Local Node.js environment
- Wrangler for local Worker development
- D1 database (local or remote)

### Production
- Cloudflare Workers (serverless runtime)
- Cloudflare D1 database
- Static file hosting with API proxying capability
- WebSocket support for game connections

## Key Architecture Points

1. **Durable Objects**: Each game room is a separate Durable Object instance, providing:
   - Isolated game state
   - Real-time WebSocket connections
   - Automatic scaling per game

2. **Action Log**: All game actions are stored in `game_actions` table as uint32 values, enabling:
   - Deterministic game replay
   - Reconnection/resync functionality
   - Audit trail

3. **Shared Engine**: The `packages/engine` package ensures game logic consistency between client and server.

4. **Authentication**: Game access uses tokens passed via:
   - Query parameter for WebSocket connections
   - Stored in localStorage on the client

## Database Schema

### `games` Table
- `id`: Primary key (game identifier)
- `code`: Unique game code (for joining)
- `status`: Game status (lobby, active, ended)
- `black_player_id`, `white_player_id`: Player identifiers
- `black_token`, `white_token`: Authentication tokens
- `initial_board`: BLOB of initial game state
- `ply`, `turn`: Current game progress
- Clock and end game fields

### `game_actions` Table
- `game_id`: Foreign key to games
- `ply`: Move number (part of composite primary key)
- `action_u32`: 4-byte action encoding
- `actor_color`: Player who made the action
- `think_ms`: Time taken for the move
- `created_at`: Timestamp

## Development Workflow

### Local Development
```bash
# Terminal 1: Start backend
npm run dev:server

# Terminal 2: Start frontend
npm run dev:web
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8787
- Vite automatically proxies API calls

### Testing Production Build Locally
```bash
# Build frontend
npm run build:web

# Preview static build
cd apps/web
npm run preview
```

## Important Notes for Hosting

1. **WebSocket Support**: The hosting provider must support WebSocket connections for `/ws/*` routes.

2. **CORS**: If frontend and backend are on different domains, CORS headers may need to be configured in the Worker.

3. **Database ID**: The `database_id` in `wrangler.jsonc` must match your actual D1 database ID.

4. **Durable Objects**: Durable Objects are automatically provisioned by Cloudflare - no manual setup needed.

5. **Static Assets**: The frontend build (`apps/web/dist/`) contains all static assets. Ensure proper MIME types and routing for SPA (all routes should serve `index.html`).

6. **Environment Variables**: No environment variables are currently required, but the Worker uses bindings defined in `wrangler.jsonc`.

## Troubleshooting

- **Database connection errors**: Verify `database_id` in `wrangler.jsonc`
- **WebSocket connection failures**: Check that proxy supports WebSocket upgrades
- **API 404 errors**: Verify proxy rules are correctly configured
- **Build errors**: Ensure all workspace dependencies are installed (`npm install` at root)

## Next Steps for Hosting

1. Set up Cloudflare account and authenticate
2. Create D1 database and update `wrangler.jsonc`
3. Deploy backend Worker
4. Build frontend
5. Deploy frontend with API/WebSocket proxying configured
6. Test end-to-end: create game, join game, play moves
7. Configure custom domain (optional)
