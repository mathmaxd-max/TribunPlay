import type { DurableObjectState } from "@cloudflare/workers-types";

/**
 * GameRoom Durable Object
 * 
 * Manages authoritative game state, WebSocket connections, and action processing
 * for a single game instance. Handles players, spectators, and game lifecycle.
 */
export class GameRoom implements DurableObject {
	private state: DurableObjectState;
	private env: Env;
	
	// Game state (will be populated from engine)
	private gameState: any = null;
	private actionLog: Uint32Array[] = [];
	private ply: number = 0;
	
	// Connected clients (players + spectators)
	private connections: Map<string, WebSocket> = new Map();
	
	// Player seating
	private players: {
		black?: { name: string; connectionId: string };
		white?: { name: string; connectionId: string };
	} = {};

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	async fetch(request: Request): Promise<Response> {
		// Handle WebSocket upgrade
		const upgradeHeader = request.headers.get("Upgrade");
		if (upgradeHeader !== "websocket") {
			return new Response("Expected WebSocket", { status: 426 });
		}

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);

		// Accept the WebSocket connection
		this.handleWebSocket(server, request);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	private async handleWebSocket(ws: WebSocket, request: Request): Promise<void> {
		const connectionId = crypto.randomUUID();
		this.connections.set(connectionId, ws);

		ws.accept();

		// Handle incoming messages
		ws.addEventListener("message", async (event) => {
			try {
				if (typeof event.data === "string") {
					// JSON control message
					const message = JSON.parse(event.data);
					await this.handleControlMessage(connectionId, message, ws);
				} else if (event.data instanceof ArrayBuffer) {
					// Binary action word (4 bytes)
					if (event.data.byteLength === 4) {
						const view = new DataView(event.data);
						const actionWord = view.getUint32(0, true); // little-endian
						await this.handleActionWord(connectionId, actionWord, ws);
					}
				}
			} catch (error) {
				this.sendError(ws, error instanceof Error ? error.message : "Unknown error");
			}
		});

		ws.addEventListener("close", () => {
			this.connections.delete(connectionId);
			// Clean up player seating if this was a player connection
			if (this.players.black?.connectionId === connectionId) {
				delete this.players.black;
			}
			if (this.players.white?.connectionId === connectionId) {
				delete this.players.white;
			}
		});
	}

	private async handleControlMessage(
		connectionId: string,
		message: any,
		ws: WebSocket
	): Promise<void> {
		switch (message.t) {
			case "join_game":
				await this.handleJoinGame(connectionId, message, ws);
				break;
			case "create_game":
				await this.handleCreateGame(connectionId, message, ws);
				break;
			case "sync_req":
				await this.handleSyncRequest(connectionId, message, ws);
				break;
			default:
				this.sendError(ws, `Unknown message type: ${message.t}`);
		}
	}

	private async handleJoinGame(
		connectionId: string,
		message: { code?: string; role: string; name: string },
		ws: WebSocket
	): Promise<void> {
		// TODO: Look up game by code, assign seat if role is "player"
		// For now, basic implementation
		if (message.role === "player") {
			if (!this.players.black) {
				this.players.black = { name: message.name, connectionId };
			} else if (!this.players.white) {
				this.players.white = { name: message.name, connectionId };
			}
		}

		// Send initial state
		ws.send(
			JSON.stringify({
				t: "joined",
				gameId: this.state.id.toString(),
				role: message.role,
				players: this.players,
				status: this.gameState?.status || "lobby",
			})
		);
	}

	private async handleCreateGame(
		connectionId: string,
		message: { private?: boolean; timeControl?: any },
		ws: WebSocket
	): Promise<void> {
		// TODO: Initialize game state with engine
		// For now, just acknowledge
		ws.send(
			JSON.stringify({
				t: "game_created",
				gameId: this.state.id.toString(),
				code: "TODO", // Generate friend code
			})
		);
	}

	private async handleSyncRequest(
		connectionId: string,
		message: { gameId: string; fromPly?: number },
		ws: WebSocket
	): Promise<void> {
		// TODO: Send snapshot + action log from fromPly
		ws.send(
			JSON.stringify({
				t: "sync",
				gameId: this.state.id.toString(),
				ply: this.ply,
				state: this.gameState,
				actions: Array.from(this.actionLog),
			})
		);
	}

	private async handleActionWord(
		connectionId: string,
		actionWord: number,
		ws: WebSocket
	): Promise<void> {
		// TODO: Validate action using engine
		// TODO: Apply action using engine
		// TODO: Update clocks
		// TODO: Persist to DB
		
		// For now, just broadcast
		this.broadcastAction(actionWord);
	}

	private broadcastAction(actionWord: number): void {
		const buffer = new ArrayBuffer(4);
		const view = new DataView(buffer);
		view.setUint32(0, actionWord, true); // little-endian

		for (const ws of this.connections.values()) {
			if (ws.readyState === 1) { // WebSocket.OPEN
				ws.send(buffer);
			}
		}

		// Append to action log
		this.actionLog.push(new Uint32Array([actionWord]));
		this.ply++;
	}

	private sendError(ws: WebSocket, message: string): void {
		if (ws.readyState === 1) { // WebSocket.OPEN
			ws.send(
				JSON.stringify({
					t: "error",
					message,
				})
			);
		}
	}
}
