import type { DurableObjectState } from "@cloudflare/workers-types";
import * as engine from "@tribunplay/engine";

/**
 * GameRoom Durable Object
 * 
 * Manages authoritative game state, WebSocket connections, and action processing
 * for a single game instance. Handles players, spectators, and game lifecycle.
 */
export class GameRoom implements DurableObject {
	private state: DurableObjectState;
	private env: Env;
	
	// Game ID (stored after validation)
	private gameId: string | null = null;
	
	// Game state
	private gameState: engine.State | null = null;
	private legalSet: Set<number> = new Set();
	private actionLog: number[] = [];
	
	// Connected clients (players + spectators)
	private connections: Map<string, { ws: WebSocket; role: "black" | "white" | "spectator"; token: string }> = new Map();
	
	// Player seating
	private players: {
		black?: { token: string };
		white?: { token: string };
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
		await this.handleWebSocket(server, request);

		return new Response(null, {
			status: 101,
			webSocket: client,
		});
	}

	private async handleWebSocket(ws: WebSocket, request: Request): Promise<void> {
		const url = new URL(request.url);
		const token = url.searchParams.get("token");
		if (!token) {
			ws.close(1008, "Missing token");
			return;
		}
		
		const connectionId = crypto.randomUUID();
		
		// Get game ID from request header or DO name
		const gameId = request.headers.get("X-Game-Id") || (this.state.id as any).name || this.state.id.toString();
		
		// Store gameId for use in loadGameState
		this.gameId = gameId;
		
		const game = await this.env.DB.prepare(
			"SELECT black_token, white_token, status FROM games WHERE id = ?"
		).bind(gameId).first<{
			black_token: string | null;
			white_token: string | null;
			status: string;
		}>();
		
		if (!game) {
			ws.close(1008, "Game not found");
			return;
		}
		
		let role: "black" | "white" | "spectator";
		if (token === game.black_token) {
			role = "black";
			this.players.black = { token };
		} else if (token === game.white_token) {
			role = "white";
			this.players.white = { token };
		} else {
			role = "spectator";
		}
		
		this.connections.set(connectionId, { ws, role, token });
		ws.accept();

		// Load game state and send initial sync
		await this.loadGameState();
		await this.sendSync(ws, role);

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
						await this.handleActionWord(connectionId, actionWord, ws, role);
					}
				}
			} catch (error) {
				this.sendError(ws, error instanceof Error ? error.message : "Unknown error");
			}
		});

		ws.addEventListener("close", () => {
			this.connections.delete(connectionId);
		});
	}

	private async loadGameState(): Promise<void> {
		// Use stored gameId (set during WebSocket connection validation)
		if (!this.gameId) {
			// Fallback: try to get from DO name
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		
		const gameId = this.gameId;
		
		// Load game from DB
		const game = await this.env.DB.prepare(
			`SELECT initial_board, initial_turn, turn, ply, draw_offer_by 
			 FROM games WHERE id = ?`
		).bind(gameId).first<{
			initial_board: Uint8Array;
			initial_turn: number;
			turn: number;
			ply: number;
			draw_offer_by: number | null;
		}>();
		
		if (!game) {
			throw new Error("Game not found in database");
		}
		
		// Load actions
		const actionsResult = await this.env.DB.prepare(
			"SELECT action_u32 FROM game_actions WHERE game_id = ? ORDER BY ply ASC"
		).bind(gameId).all<{ action_u32: number }>();
		
		const actions = actionsResult.results?.map(r => r.action_u32) || [];
		
		// Rebuild state by replaying actions
		this.gameState = {
			board: new Uint8Array(game.initial_board),
			turn: game.initial_turn as engine.Color,
			ply: 0,
			drawOfferBy: game.draw_offer_by as engine.Color | null,
		};
		
		for (const action of actions) {
			this.gameState = engine.applyAction(this.gameState, action);
		}
		
		// Update legal set and send Bloom filter
		if (this.gameState) {
			const legalActions = engine.generateLegalActions(this.gameState);
			this.legalSet = new Set(Array.from(legalActions));
			
			// Send Bloom filter to all connections
			this.broadcastBloomFilter(Array.from(legalActions));
		}
		
		this.actionLog = actions;
	}

	private async sendSync(ws: WebSocket, role: "black" | "white" | "spectator"): Promise<void> {
		if (!this.gameState) {
			return;
		}
		
		const snapshot = {
			boardB64: engine.packBoard(this.gameState.board),
			turn: this.gameState.turn,
			ply: this.gameState.ply,
			drawOfferBy: this.gameState.drawOfferBy,
		};
		
		// Pack actions as base64
		const actionsBuffer = new ArrayBuffer(this.actionLog.length * 4);
		const actionsView = new DataView(actionsBuffer);
		for (let i = 0; i < this.actionLog.length; i++) {
			actionsView.setUint32(i * 4, this.actionLog[i], true);
		}
		const actionsB64 = btoa(String.fromCharCode(...new Uint8Array(actionsBuffer)));
		
		ws.send(JSON.stringify({
			t: "start",
			snapshot,
			actions: this.actionLog, // Also send as array for convenience
			actionsB64,
			role,
		}));
		
		// Send Bloom filter after initial sync
		const legalActions = engine.generateLegalActions(this.gameState);
		const bloom = this.createBloomFilter(Array.from(legalActions));
		ws.send(JSON.stringify({
			t: "legal",
			ply: this.gameState.ply,
			bloom,
		}));
	}

	private async handleControlMessage(
		connectionId: string,
		message: any,
		ws: WebSocket
	): Promise<void> {
		// For MVP, we mainly handle actions via binary messages
		// Control messages can be used for draw/resign if needed
		if (message.t === "sync_req") {
			const conn = this.connections.get(connectionId);
			if (conn) {
				await this.sendSync(ws, conn.role);
			}
		}
	}

	private async handleActionWord(
		connectionId: string,
		actionWord: number,
		ws: WebSocket,
		role: "black" | "white" | "spectator"
	): Promise<void> {
		if (!this.gameState) {
			this.sendError(ws, "Game state not loaded");
			return;
		}
		
		// Validate role
		const { opcode, fields } = engine.decodeAction(actionWord);
		if (opcode !== 10 && opcode !== 11) {
			// Board actions require player role
			if (role === "spectator") {
				this.sendError(ws, "Spectators cannot play");
				return;
			}
			
			// Validate turn
			const actorColor = role === "black" ? 0 : 1;
			if (actorColor !== this.gameState.turn) {
				this.sendError(ws, "Not your turn");
				return;
			}
		}
		
		// Validate legality
		if (!this.legalSet.has(actionWord)) {
			this.sendError(ws, "Illegal action");
			return;
		}
		
		// Apply action
		const newState = engine.applyAction(this.gameState, actionWord);
		
		// Persist to DB
		if (!this.gameId) {
			// Fallback: try to get from DO name
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		const gameId = this.gameId;
		const actorColor = role === "spectator" ? null : (role === "black" ? 0 : 1);
		
		await this.env.DB.prepare(
			`INSERT INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(
			gameId,
			newState.ply - 1, // ply before this action
			actionWord,
			actorColor,
			new Date().toISOString()
		).run();
		
		// Update game row
		await this.env.DB.prepare(
			`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ? WHERE id = ?`
		).bind(
			newState.ply,
			newState.turn,
			newState.drawOfferBy,
			gameId
		).run();
		
		// Update local state
		this.gameState = newState;
		const legalActions = engine.generateLegalActions(this.gameState);
		this.legalSet = new Set(Array.from(legalActions));
		this.actionLog.push(actionWord);
		
		// Broadcast action and Bloom filter
		this.broadcastAction(actionWord);
		this.broadcastBloomFilter(Array.from(legalActions));
	}

	private broadcastAction(actionWord: number): void {
		const buffer = new ArrayBuffer(4);
		const view = new DataView(buffer);
		view.setUint32(0, actionWord, true); // little-endian

		for (const { ws } of this.connections.values()) {
			if (ws.readyState === 1) { // WebSocket.OPEN
				ws.send(buffer);
			}
		}
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

	private broadcastBloomFilter(legalActions: number[]): void {
		if (!this.gameState) return;
		
		const bloom = this.createBloomFilter(legalActions);
		const message = JSON.stringify({
			t: "legal",
			ply: this.gameState.ply,
			bloom,
		});

		for (const { ws } of this.connections.values()) {
			if (ws.readyState === 1) { // WebSocket.OPEN
				ws.send(message);
			}
		}
	}

	/**
	 * Create a Bloom filter from a set of legal actions
	 */
	private createBloomFilter(
		legalActions: number[],
		m: number = Math.max(1024, legalActions.length * 8), // Default: 8 bits per action
		k: number = 3 // Default: 3 hash functions
	): { m: number; k: number; bitsB64: string } {
		const bits = new Uint8Array(Math.ceil(m / 8));
		
		// Add each legal action to the filter
		for (const action of legalActions) {
			for (let i = 0; i < k; i++) {
				const hash = this.hashAction(action, i);
				const bitIndex = hash % m;
				const byteIndex = Math.floor(bitIndex / 8);
				const bitOffset = bitIndex % 8;
				
				if (byteIndex < bits.length) {
					bits[byteIndex] |= (1 << bitOffset);
				}
			}
		}
		
		// Encode to base64
		const binary = String.fromCharCode(...bits);
		const bitsB64 = btoa(binary);
		
		return { m, k, bitsB64 };
	}

	/**
	 * Hash function for creating Bloom filter (FNV-1a)
	 */
	private hashAction(value: number, seed: number): number {
		let hash = 2166136261 ^ (seed * 16777619);
		hash ^= (value >>> 24) & 0xff;
		hash = (hash * 16777619) >>> 0;
		hash ^= (value >>> 16) & 0xff;
		hash = (hash * 16777619) >>> 0;
		hash ^= (value >>> 8) & 0xff;
		hash = (hash * 16777619) >>> 0;
		hash ^= value & 0xff;
		hash = (hash * 16777619) >>> 0;
		return hash >>> 0;
	}
}
