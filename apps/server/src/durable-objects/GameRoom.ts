import type { DurableObjectState } from "@cloudflare/workers-types";
import * as engine from "@tribunplay/engine";

type ColorClock = { black: number; white: number };
type TimeControl = {
	initialMs: ColorClock;
	bufferMs: ColorClock;
	incrementMs: ColorClock;
	maxGameMs?: number | null;
};

const DEFAULT_TIME_CONTROL: TimeControl = {
	initialMs: { black: 300000, white: 300000 },
	bufferMs: { black: 20000, white: 20000 },
	incrementMs: { black: 0, white: 0 },
	maxGameMs: null,
};

const readColorClock = (raw: any, fallback: ColorClock): ColorClock => {
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return { black: raw, white: raw };
	}
	if (raw && typeof raw === "object") {
		return {
			black: Number.isFinite(raw.black) ? raw.black : fallback.black,
			white: Number.isFinite(raw.white) ? raw.white : fallback.white,
		};
	}
	return fallback;
};

const normalizeTimeControl = (raw: any): TimeControl => {
	const base = DEFAULT_TIME_CONTROL;
	if (!raw || typeof raw !== "object") {
		return { ...base };
	}
	const initialMs = readColorClock(raw.initialMs, base.initialMs);
	const bufferMs = readColorClock(raw.bufferMs, base.bufferMs);
	const incrementMs = readColorClock(raw.incrementMs, base.incrementMs);
	const maxGameMs =
		raw.maxGameMs === null || Number.isFinite(raw.maxGameMs)
			? raw.maxGameMs
			: base.maxGameMs ?? null;
	return {
		initialMs,
		bufferMs,
		incrementMs,
		maxGameMs,
	};
};

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
	private supportsDrawOfferBlocked: boolean | null = null;
	
	// Clock and buffer state (server-authoritative)
	private clockBlackMs: number = 0;
	private clockWhiteMs: number = 0;
	private bufferBlackMs: number = 0;
	private bufferWhiteMs: number = 0;
	private turnStartTime: number | null = null;
	private timeControl: TimeControl | null = null;
	private gameStartTime: number | null = null;
	
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
		if (this.gameState && this.timeControl) {
			return;
		}

		// Use stored gameId (set during WebSocket connection validation)
		if (!this.gameId) {
			// Fallback: try to get from DO name
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		
		const gameId = this.gameId;
		
		// Load game from DB
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		const game = await this.env.DB.prepare(
			supportsBlocked
				? `SELECT initial_board, initial_turn, turn, ply, draw_offer_by, draw_offer_blocked,
			        time_control_json, clock_black_ms, clock_white_ms, created_at, started_at
			 FROM games WHERE id = ?`
				: `SELECT initial_board, initial_turn, turn, ply, draw_offer_by,
			        time_control_json, clock_black_ms, clock_white_ms, created_at, started_at
			 FROM games WHERE id = ?`
		).bind(gameId).first<{
			initial_board: Uint8Array;
			initial_turn: number;
			turn: number;
			ply: number;
			draw_offer_by: number | null;
			draw_offer_blocked?: number | null;
			time_control_json: string | null;
			clock_black_ms: number | null;
			clock_white_ms: number | null;
			created_at: string;
			started_at: string | null;
		}>();
		
		if (!game) {
			throw new Error("Game not found in database");
		}
		
		// Load and initialize time control
		if (game.time_control_json) {
			try {
				this.timeControl = normalizeTimeControl(JSON.parse(game.time_control_json));
			} catch (e) {
				this.timeControl = { ...DEFAULT_TIME_CONTROL };
			}
		} else {
			this.timeControl = { ...DEFAULT_TIME_CONTROL };
		}
		
		// Load actions
		const actionsResult = await this.env.DB.prepare(
			"SELECT action_u32, created_at FROM game_actions WHERE game_id = ? ORDER BY ply ASC"
		).bind(gameId).all<{ action_u32: number; created_at: string }>();
		
		const actions = actionsResult.results?.map(r => r.action_u32) || [];
		const lastActionAt = actionsResult.results?.length
			? actionsResult.results[actionsResult.results.length - 1].created_at
			: null;
		const firstActionAt = actionsResult.results?.length
			? actionsResult.results[0].created_at
			: null;
		
		// Rebuild state by replaying actions
		this.gameState = {
			board: new Uint8Array(game.initial_board),
			turn: game.initial_turn as engine.Color,
			ply: 0,
			drawOfferBy: game.draw_offer_by as engine.Color | null,
			drawOfferBlocked: supportsBlocked ? (game.draw_offer_blocked as engine.Color | null) : null,
		};
		
		for (const action of actions) {
			this.gameState = engine.applyAction(this.gameState, action);
		}

		// Initialize clocks from DB or use initial time
		this.clockBlackMs = game.clock_black_ms ?? this.timeControl.initialMs.black;
		this.clockWhiteMs = game.clock_white_ms ?? this.timeControl.initialMs.white;
		
		// Initialize buffers to full value at turn start
		this.bufferBlackMs = this.timeControl.bufferMs.black;
		this.bufferWhiteMs = this.timeControl.bufferMs.white;
		
		// Set turn start time based on last action (fallback to now if missing)
		if (lastActionAt) {
			const parsed = Date.parse(lastActionAt);
			this.turnStartTime = Number.isNaN(parsed) ? Date.now() : parsed;
		} else if (this.turnStartTime === null) {
			this.turnStartTime = Date.now();
		}

		// Set game start time for max game clock
		if (game.started_at) {
			const parsedStart = Date.parse(game.started_at);
			this.gameStartTime = Number.isNaN(parsedStart) ? null : parsedStart;
		} else if (firstActionAt) {
			const parsedStart = Date.parse(firstActionAt);
			this.gameStartTime = Number.isNaN(parsedStart) ? null : parsedStart;
		} else {
			this.gameStartTime = null;
		}

		await this.scheduleNextAlarm();

		this.actionLog = actions;
		
		// Update legal set and send Bloom filter
		if (this.gameState) {
			const legalActions = engine.generateLegalActions(this.gameState);
			const legalList = Array.from(legalActions);
			this.legalSet = new Set(legalList);

			const endedForNoMoves = await this.maybeEndOnNoMoves(gameId, legalList);
			if (!endedForNoMoves) {
				// Send Bloom filter to all connections
				this.broadcastBloomFilter(legalList);
			}
		}
	}

	private async ensureDrawOfferBlockedSupport(): Promise<boolean> {
		if (this.supportsDrawOfferBlocked !== null) {
			return this.supportsDrawOfferBlocked;
		}
		try {
			const info = await this.env.DB.prepare("PRAGMA table_info(games)").all<{ name: string }>();
			this.supportsDrawOfferBlocked =
				info.results?.some((row) => row.name === "draw_offer_blocked") ?? false;
		} catch {
			this.supportsDrawOfferBlocked = false;
		}
		return this.supportsDrawOfferBlocked;
	}

	private async sendSync(ws: WebSocket, role: "black" | "white" | "spectator"): Promise<void> {
		if (!this.gameState) {
			return;
		}
		
		const snapshot: any = {
			boardB64: engine.packBoard(this.gameState.board),
			turn: this.gameState.turn,
			ply: this.gameState.ply,
			drawOfferBy: this.gameState.drawOfferBy,
			drawOfferBlocked: this.gameState.drawOfferBlocked,
			status: this.gameState.status ?? "active",
			winner: this.gameState.winner ?? null,
		};
		
		// Include clock and buffer state in snapshot
		const nowMs = Date.now();
		const clockSnapshot = this.getClockSnapshot(nowMs);
		if (clockSnapshot && this.timeControl) {
			snapshot.clocksMs = clockSnapshot.clocksMs;
			snapshot.buffersMs = clockSnapshot.buffersMs;
			snapshot.timeControl = this.timeControl;
			snapshot.serverTimeMs = nowMs;
			snapshot.turnStartTimeMs = this.turnStartTime;
			snapshot.gameStartTimeMs = this.gameStartTime;
		}
		
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
		} else if (message.t === "time_sync" && Number.isFinite(message.clientTimeMs)) {
			if (ws.readyState === 1) {
				ws.send(
					JSON.stringify({
						t: "time_sync",
						clientTimeMs: message.clientTimeMs,
						serverTimeMs: Date.now(),
					})
				);
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
		} else {
			if (role === "spectator") {
				this.sendError(ws, "Spectators cannot play");
				return;
			}
			const expectedColor = role === "black" ? 0 : 1;
			if (opcode === 10 && fields.actorColor !== expectedColor) {
				this.sendError(ws, "Draw action color mismatch");
				return;
			}
			if (opcode === 11 && fields.loserColor !== expectedColor) {
				this.sendError(ws, "Resign action color mismatch");
				return;
			}
		}
		
		// Validate legality
		if (!this.legalSet.has(actionWord)) {
			this.sendError(ws, "Illegal action");
			return;
		}
		
		const shouldStartGame = this.gameStartTime === null && opcode !== 10 && opcode !== 11;
		const startedAtIso = shouldStartGame ? new Date().toISOString() : null;
		if (shouldStartGame) {
			this.gameStartTime = Date.parse(startedAtIso!);
		}

		// Apply action
		const previousState = this.gameState;
		const newState = engine.applyAction(this.gameState, actionWord);
		
		// Update clocks if turn changed
		const timeoutLoser =
			previousState.turn !== newState.turn
				? this.updateClocksAfterAction(previousState.turn, newState.turn)
				: null;
		
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
		
		// Update game row with clock values
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`
			).bind(
				newState.ply,
				newState.turn,
				newState.drawOfferBy,
				newState.drawOfferBlocked,
				this.clockBlackMs,
				this.clockWhiteMs,
				startedAtIso,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`
			).bind(
				newState.ply,
				newState.turn,
				newState.drawOfferBy,
				this.clockBlackMs,
				this.clockWhiteMs,
				startedAtIso,
				gameId
			).run();
		}
		
		// Update local state
		this.gameState = newState;
		const legalActions = engine.generateLegalActions(this.gameState);
		const legalList = Array.from(legalActions);
		this.legalSet = new Set(legalList);
		this.actionLog.push(actionWord);
		
		// Broadcast action and Bloom filter
		this.broadcastAction(actionWord);
		const endedForNoMoves = await this.maybeEndOnNoMoves(gameId, legalList);
		if (!endedForNoMoves) {
			this.broadcastBloomFilter(legalList);
		}
		
		// Broadcast clock update if turn changed
		if (previousState.turn !== newState.turn) {
			this.broadcastClockUpdate(newState);
		}

		// End game on timeout
		if (timeoutLoser !== null) {
			await this.applyTimeoutEnd(timeoutLoser, gameId);
		}

		await this.scheduleNextAlarm();
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

	/**
	 * Update clocks and buffers after an action is completed
	 * Applies buffer/increment rules and checks for timeouts
	 */
	private updateClocksAfterAction(previousTurn: engine.Color, _newTurn: engine.Color): engine.Color | null {
		if (!this.timeControl || !this.turnStartTime || this.gameState?.status === "ended") {
			return null;
		}
		
		const elapsed = Math.max(0, Date.now() - this.turnStartTime);
		const previousColor = previousTurn === 0 ? "black" : "white";
		const bufferFull = this.timeControl.bufferMs[previousColor];
		const timeOverBuffer = Math.max(0, elapsed - bufferFull);
		let timedOut: engine.Color | null = null;
		
		// Update clock and buffer for the player who just moved
		if (previousColor === "black") {
			// Buffer reduces the clock only after it is exhausted
			this.clockBlackMs = Math.max(0, this.clockBlackMs - timeOverBuffer);
			
			if (this.clockBlackMs <= 0) {
				this.clockBlackMs = 0;
				timedOut = 0;
			} else {
				// Apply increment after turn completion
				this.clockBlackMs = Math.max(0, this.clockBlackMs + this.timeControl.incrementMs.black);
			}
		} else {
			// Buffer reduces the clock only after it is exhausted
			this.clockWhiteMs = Math.max(0, this.clockWhiteMs - timeOverBuffer);
			
			if (this.clockWhiteMs <= 0) {
				this.clockWhiteMs = 0;
				timedOut = 1;
			} else {
				// Apply increment after turn completion
				this.clockWhiteMs = Math.max(0, this.clockWhiteMs + this.timeControl.incrementMs.white);
			}
		}
		
		// Reset buffers to full for the next turn
		this.bufferBlackMs = this.timeControl.bufferMs.black;
		this.bufferWhiteMs = this.timeControl.bufferMs.white;
		
		// Update turn start time
		this.turnStartTime = Date.now();
		
		return timedOut;
	}

	private broadcastClockUpdate(state: engine.State): void {
		const nowMs = Date.now();
		const clockSnapshot = this.getClockSnapshot(nowMs);
		const message = JSON.stringify({
			t: "clock",
			ply: state.ply,
			turn: state.turn === 0 ? "black" : "white",
			serverTimeMs: nowMs,
			turnStartTimeMs: this.turnStartTime,
			gameStartTimeMs: this.gameStartTime,
			clocksMs: clockSnapshot?.clocksMs ?? {
				black: this.clockBlackMs,
				white: this.clockWhiteMs,
			},
			buffersMs: clockSnapshot?.buffersMs ?? {
				black: this.timeControl?.bufferMs.black ?? this.bufferBlackMs,
				white: this.timeControl?.bufferMs.white ?? this.bufferWhiteMs,
			},
		});

		for (const { ws } of this.connections.values()) {
			if (ws.readyState === 1) { // WebSocket.OPEN
				ws.send(message);
			}
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

	private hasPlayableActions(legalActions: number[]): boolean {
		for (const action of legalActions) {
			const op = engine.opcode(action);
			if (op <= 9) {
				return true;
			}
		}
		return false;
	}

	private async maybeEndOnNoMoves(gameId: string, legalActions: number[]): Promise<boolean> {
		if (!this.gameState || this.gameState.status === "ended") {
			return false;
		}
		if (this.hasPlayableActions(legalActions)) {
			return false;
		}
		const loserColor = this.gameState.turn;
		await this.applyNoLegalMovesEnd(loserColor, gameId);
		return true;
	}

	private async applyNoLegalMovesEnd(loserColor: engine.Color, gameId: string): Promise<void> {
		if (!this.gameState || this.gameState.status === "ended") return;
		
		const endAction = engine.encodeEnd(1, loserColor);
		const endedState = engine.applyAction(this.gameState, endAction);
		
		await this.env.DB.prepare(
			`INSERT INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(
			gameId,
			endedState.ply - 1,
			endAction,
			null,
			new Date().toISOString()
		).run();
		
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ? WHERE id = ?`
			).bind(
				endedState.ply,
				endedState.turn,
				endedState.drawOfferBy,
				endedState.drawOfferBlocked,
				this.clockBlackMs,
				this.clockWhiteMs,
				"ended",
				endedState.winner ?? null,
				11,
				1,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ? WHERE id = ?`
			).bind(
				endedState.ply,
				endedState.turn,
				endedState.drawOfferBy,
				this.clockBlackMs,
				this.clockWhiteMs,
				"ended",
				endedState.winner ?? null,
				11,
				1,
				gameId
			).run();
		}
		
		this.gameState = endedState;
		const legalActions = engine.generateLegalActions(endedState);
		this.legalSet = new Set(Array.from(legalActions));
		this.actionLog.push(endAction);
		
		this.broadcastAction(endAction);
		this.broadcastBloomFilter(Array.from(legalActions));
	}

	private async applyTimeoutEnd(loserColor: engine.Color, gameId: string): Promise<void> {
		if (!this.gameState || this.gameState.status === "ended") return;
		
		const endAction = engine.encodeEnd(2, loserColor);
		const endedState = engine.applyAction(this.gameState, endAction);
		
		await this.env.DB.prepare(
			`INSERT INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(
			gameId,
			endedState.ply - 1,
			endAction,
			null,
			new Date().toISOString()
		).run();
		
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ? WHERE id = ?`
			).bind(
				endedState.ply,
				endedState.turn,
				endedState.drawOfferBy,
				endedState.drawOfferBlocked,
				this.clockBlackMs,
				this.clockWhiteMs,
				"ended",
				endedState.winner ?? null,
				11,
				2,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ? WHERE id = ?`
			).bind(
				endedState.ply,
				endedState.turn,
				endedState.drawOfferBy,
				this.clockBlackMs,
				this.clockWhiteMs,
				"ended",
				endedState.winner ?? null,
				11,
				2,
				gameId
			).run();
		}
		
		this.gameState = endedState;
		const legalActions = engine.generateLegalActions(endedState);
		this.legalSet = new Set(Array.from(legalActions));
		this.actionLog.push(endAction);
		
		this.broadcastAction(endAction);
		this.broadcastBloomFilter(Array.from(legalActions));
	}

	private getClockSnapshot(
		nowMs: number = Date.now()
	): { clocksMs: { black: number; white: number }; buffersMs: { black: number; white: number } } | null {
		if (!this.timeControl || !this.gameState) return null;
		const clocksMs = {
			black: this.clockBlackMs,
			white: this.clockWhiteMs,
		};
		const buffersMs = {
			black: this.timeControl.bufferMs.black,
			white: this.timeControl.bufferMs.white,
		};
		if (this.turnStartTime === null) {
			return { clocksMs, buffersMs };
		}
		const elapsed = Math.max(0, nowMs - this.turnStartTime);
		const activeColor = this.gameState.turn === 0 ? "black" : "white";
		const bufferFull = this.timeControl.bufferMs[activeColor];
		const bufferRemaining = Math.max(0, bufferFull - elapsed);
		const clockDeduction = Math.max(0, elapsed - bufferFull);
		if (activeColor === "black") {
			clocksMs.black = Math.max(0, clocksMs.black - clockDeduction);
			buffersMs.black = bufferRemaining;
		} else {
			clocksMs.white = Math.max(0, clocksMs.white - clockDeduction);
			buffersMs.white = bufferRemaining;
		}
		return { clocksMs, buffersMs };
	}

	private async scheduleNextAlarm(): Promise<void> {
		if (!this.gameState || !this.timeControl) return;
		if (this.gameState.status === "ended") {
			await this.state.storage.deleteAlarm();
			return;
		}

		let nextDeadline: number | null = null;
		if (this.turnStartTime !== null) {
			const activeColor = this.gameState.turn === 0 ? "black" : "white";
			const bufferMs = this.timeControl.bufferMs[activeColor];
			const clockMs = activeColor === "black" ? this.clockBlackMs : this.clockWhiteMs;
			const deadline = this.turnStartTime + bufferMs + clockMs;
			if (Number.isFinite(deadline)) {
				nextDeadline = deadline;
			}
		}

		if (this.timeControl.maxGameMs != null && this.gameStartTime !== null) {
			const maxDeadline = this.gameStartTime + this.timeControl.maxGameMs;
			if (Number.isFinite(maxDeadline)) {
				nextDeadline = nextDeadline === null ? maxDeadline : Math.min(nextDeadline, maxDeadline);
			}
		}

		if (nextDeadline === null) return;
		await this.state.storage.setAlarm(new Date(nextDeadline));
	}

	private async applyMaxGameEnd(gameId: string): Promise<void> {
		if (!this.gameState || this.gameState.status === "ended") return;
		
		const endAction = engine.encodeEnd(3);
		const endedState = engine.applyAction(this.gameState, endAction);
		
		await this.env.DB.prepare(
			`INSERT INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(
			gameId,
			endedState.ply - 1,
			endAction,
			null,
			new Date().toISOString()
		).run();
		
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ? WHERE id = ?`
			).bind(
				endedState.ply,
				endedState.turn,
				endedState.drawOfferBy,
				endedState.drawOfferBlocked,
				this.clockBlackMs,
				this.clockWhiteMs,
				"ended",
				endedState.winner ?? null,
				11,
				3,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ? WHERE id = ?`
			).bind(
				endedState.ply,
				endedState.turn,
				endedState.drawOfferBy,
				this.clockBlackMs,
				this.clockWhiteMs,
				"ended",
				endedState.winner ?? null,
				11,
				3,
				gameId
			).run();
		}
		
		this.gameState = endedState;
		const legalActions = engine.generateLegalActions(endedState);
		this.legalSet = new Set(Array.from(legalActions));
		this.actionLog.push(endAction);
		
		this.broadcastAction(endAction);
		this.broadcastBloomFilter(Array.from(legalActions));
	}

	async alarm(): Promise<void> {
		await this.loadGameState();
		if (!this.gameState || this.gameState.status === "ended") {
			return;
		}
		if (!this.gameId) {
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		const gameId = this.gameId;
		const now = Date.now();

		if (this.timeControl?.maxGameMs != null && this.gameStartTime !== null) {
			if (now - this.gameStartTime >= this.timeControl.maxGameMs) {
				await this.applyMaxGameEnd(gameId);
				await this.scheduleNextAlarm();
				return;
			}
		}

		const snapshot = this.getClockSnapshot();
		if (snapshot) {
			const activeColor = this.gameState.turn === 0 ? "black" : "white";
			if (snapshot.clocksMs[activeColor] <= 0) {
				const loserColor: engine.Color = activeColor === "black" ? 0 : 1;
				await this.applyTimeoutEnd(loserColor, gameId);
			}
		}

		await this.scheduleNextAlarm();
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
