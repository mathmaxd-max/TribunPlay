import type { DurableObjectState } from "@cloudflare/workers-types";
import * as engine from "@tribunplay/engine";

type ColorClock = { black: number; white: number };
type TimeControl = {
	initialMs: ColorClock;
	bufferMs: ColorClock;
	incrementMs: ColorClock;
	maxGameMs?: number | null;
};
type RoomStatus = "lobby" | "active" | "ended";
type RoomSettings = {
	hostColor: "black" | "white" | "random";
	startColor: "black" | "white" | "random";
	nextStartColor: "same" | "other" | "random";
	setupConfig: engine.SetupConfig;
};
type ConnectionRole = "black" | "white" | "spectator";
type LobbyAccountMode = "guest" | "token" | null;
type LobbyPerson = {
	connectionId: string;
	name: string;
	isGuest: boolean;
	seat: ConnectionRole;
};
type ConnectionEntry = {
	ws: WebSocket;
	role: ConnectionRole;
	token: string;
	displayName: string;
	isGuest: boolean;
	accountMode: LobbyAccountMode;
	accountId: string | null;
};
// Guest-host abandonment policy:
// if the last WS connection belonging to host_account_id disappears while roomStatus === "lobby",
// the lobby is purged after a short grace period to tolerate refresh/reconnect gaps.
const GUEST_HOST_ABANDONMENT_GRACE_MS = 8000;

const DEFAULT_TIME_CONTROL: TimeControl = {
	initialMs: { black: 300000, white: 300000 },
	bufferMs: { black: 20000, white: 20000 },
	incrementMs: { black: 0, white: 0 },
	maxGameMs: null,
};
const DEFAULT_ROOM_SETTINGS: RoomSettings = {
	hostColor: "random",
	startColor: "random",
	nextStartColor: "other",
	setupConfig: engine.normalizeSetupConfig(undefined),
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

const normalizeRoomSettings = (raw: any): RoomSettings => {
	const base = DEFAULT_ROOM_SETTINGS;
	if (!raw || typeof raw !== "object") {
		return { ...base };
	}
	const hostColor =
		raw.hostColor === "black" || raw.hostColor === "white" || raw.hostColor === "random"
			? raw.hostColor
			: base.hostColor;
	const startColor =
		raw.startColor === "black" || raw.startColor === "white" || raw.startColor === "random"
			? raw.startColor
			: base.startColor;
	const nextStartColor =
		raw.nextStartColor === "same" || raw.nextStartColor === "other" || raw.nextStartColor === "random"
			? raw.nextStartColor
			: base.nextStartColor;
	return {
		hostColor,
		startColor,
		nextStartColor,
		setupConfig: engine.normalizeSetupConfig(raw.setupConfig),
	};
};

const normalizeSetupSelections = (raw: any): engine.SetupSelectionsBySide => {
	const readSelection = (value: any): engine.SetupSelection | null => {
		if (!value || typeof value !== "object" || typeof value.hash !== "string") {
			return null;
		}
		return {
			hash: engine.normalizeSetupHash(value.hash),
			flip: Boolean(value.flip),
		};
	};
	return {
		black: readSelection(raw?.black),
		white: readSelection(raw?.white),
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
	private isGuestOnlyMatchCache: boolean | null = null;
	private hasPurgedGuestOnlyHistory = false;

	/**
	 * Guardrails for draw offer UX:
	 * - After offering, withdrawing is allowed, but only after a 5s cooldown.
	 *
	 * These are enforced server-side to prevent client spam / bypass.
	 */
	private drawOfferLastOfferAtMsByColor: [number | null, number | null] = [null, null];
	
	// Clock and buffer state (server-authoritative)
	private clockBlackMs: number = 0;
	private clockWhiteMs: number = 0;
	private bufferBlackMs: number = 0;
	private bufferWhiteMs: number = 0;
	private turnStartTime: number | null = null;
	private timeControl: TimeControl | null = null;
	private gameStartTime: number | null = null;
	private roomStatus: RoomStatus = "lobby";
	private roomSettings: RoomSettings = { ...DEFAULT_ROOM_SETTINGS };
	private setupSelections: engine.SetupSelectionsBySide = { black: null, white: null };
	private initialBoard: Uint8Array | null = null;
	private currentStartColor: engine.Color | null = null;
	private rematchOffers: { black: boolean; white: boolean } = { black: false, white: false };
	private hostAccountId: string | null = null;
	private hostIsGuest: boolean = false;
	private guestHostCleanupDeadlineMs: number | null = null;
	private lobbyWasDeleted = false;
	private closingLobbySockets = false;
	
	// Connected clients (players + spectators)
	private connections: Map<string, ConnectionEntry> = new Map();
	
	// Player seating
	private players: {
		black?: { token: string };
		white?: { token: string };
	} = {};

	constructor(state: DurableObjectState, env: Env) {
		this.state = state;
		this.env = env;
	}

	private logGame(event: string, payload: Record<string, unknown> = {}): void {
		const record = {
			ts: new Date().toISOString(),
			side: "server",
			tag: "WS-GAME",
			event,
			gameId: this.gameId,
			connections: this.connections.size,
			...payload,
		};
		console.info("[WS-GAME]", JSON.stringify(record));
	}

	private describeAction(actionWord: number): {
		signed: number;
		unsigned: number;
		hex: string;
		opcode: number | null;
	} {
		const unsigned = actionWord >>> 0;
		let opcode: number | null = null;
		try {
			opcode = engine.decodeAction(unsigned).opcode;
		} catch {
			opcode = null;
		}
		return {
			signed: actionWord | 0,
			unsigned,
			hex: `0x${unsigned.toString(16).padStart(8, "0")}`,
			opcode,
		};
	}

	private hasHostConnectionOnline(): boolean {
		if (!this.hostAccountId) return false;
		for (const conn of this.connections.values()) {
			if (conn.accountId === this.hostAccountId) return true;
		}
		return false;
	}

	private isHostConnection(conn: ConnectionEntry | null | undefined): boolean {
		if (!conn || !this.hostAccountId || !conn.accountId) return false;
		return conn.accountId === this.hostAccountId;
	}

	private async updateGuestHostAbandonmentPolicy(trigger: string): Promise<void> {
		if (this.roomStatus !== "lobby" || !this.hostAccountId || !this.hostIsGuest || this.lobbyWasDeleted) {
			if (this.guestHostCleanupDeadlineMs !== null) {
				this.guestHostCleanupDeadlineMs = null;
				this.logGame("host.guest_cleanup.cancel", { trigger, reason: "policy_not_applicable" });
			}
			await this.scheduleNextAlarm();
			return;
		}

		if (this.hasHostConnectionOnline()) {
			if (this.guestHostCleanupDeadlineMs !== null) {
				this.logGame("host.guest_cleanup.cancel", { trigger, reason: "host_online" });
			}
			this.guestHostCleanupDeadlineMs = null;
			await this.scheduleNextAlarm();
			return;
		}

		if (this.guestHostCleanupDeadlineMs === null) {
			this.guestHostCleanupDeadlineMs = Date.now() + GUEST_HOST_ABANDONMENT_GRACE_MS;
			this.logGame("host.guest_cleanup.scheduled", {
				trigger,
				deadlineMs: this.guestHostCleanupDeadlineMs,
				graceMs: GUEST_HOST_ABANDONMENT_GRACE_MS,
			});
		}
		await this.scheduleNextAlarm();
	}

	private closeAllLobbySockets(reason: string): void {
		if (this.closingLobbySockets) return;
		this.closingLobbySockets = true;
		const payload = JSON.stringify({ t: "lobby_closed", reason });
		for (const conn of this.connections.values()) {
			if (conn.ws.readyState === 1) {
				try {
					conn.ws.send(payload);
				} catch {}
				try {
					conn.ws.close(1000, "lobby_closed");
				} catch {}
			}
		}
	}

	private async purgeGuestHostAbandonedLobby(trigger: string): Promise<boolean> {
		if (this.roomStatus !== "lobby" || !this.hostAccountId || !this.hostIsGuest || this.lobbyWasDeleted) {
			return false;
		}
		if (this.hasHostConnectionOnline()) {
			this.guestHostCleanupDeadlineMs = null;
			return false;
		}
		if (!this.gameId) {
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		await this.env.DB.batch([
			this.env.DB.prepare("DELETE FROM game_actions WHERE game_id = ?").bind(this.gameId),
			this.env.DB.prepare("DELETE FROM game_participants WHERE game_id = ?").bind(this.gameId),
			this.env.DB.prepare("DELETE FROM games WHERE id = ?").bind(this.gameId),
		]);
		this.lobbyWasDeleted = true;
		this.guestHostCleanupDeadlineMs = null;
		this.logGame("host.guest_cleanup.purged", { trigger });
		this.closeAllLobbySockets("guest_host_abandoned");
		return true;
	}

	private normalizeLobbyName(name: string | null | undefined, fallback: string): string {
		if (typeof name !== "string") return fallback;
		const compact = name.trim().replace(/\s+/g, " ").slice(0, 48);
		return compact || fallback;
	}

	private async resolveSeatIdentity(seat: "black" | "white"): Promise<{
		accountId: string | null;
		name: string;
		isGuest: boolean;
		accountMode: LobbyAccountMode;
	}> {
		if (!this.gameId) {
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		const row = await this.env.DB
			.prepare(
				`SELECT
				   g.black_player_id,
				   g.white_player_id,
				   black_participant.name AS black_participant_name,
				   white_participant.name AS white_participant_name,
				   black_account.name AS black_account_name,
				   white_account.name AS white_account_name,
				   black_account.provider AS black_provider,
				   white_account.provider AS white_provider
				 FROM games g
				 LEFT JOIN game_participants black_participant
				   ON black_participant.game_id = g.id AND black_participant.seat = 'black'
				 LEFT JOIN game_participants white_participant
				   ON white_participant.game_id = g.id AND white_participant.seat = 'white'
				 LEFT JOIN accounts black_account ON black_account.id = g.black_player_id
				 LEFT JOIN accounts white_account ON white_account.id = g.white_player_id
				 WHERE g.id = ?`,
			)
			.bind(this.gameId)
			.first<{
				black_player_id: string | null;
				white_player_id: string | null;
				black_participant_name: string | null;
				white_participant_name: string | null;
				black_account_name: string | null;
				white_account_name: string | null;
				black_provider: string | null;
				white_provider: string | null;
			}>();

		if (!row) {
			const fallback = seat === "black" ? "Black Player" : "White Player";
			return { accountId: null, name: fallback, isGuest: false, accountMode: null };
		}

		if (seat === "black") {
			const fallback = "Black Player";
			return {
				accountId: row.black_player_id,
				name: this.normalizeLobbyName(row.black_participant_name ?? row.black_account_name, fallback),
				isGuest: row.black_provider === "guest",
				accountMode: row.black_provider === "guest" ? "guest" : row.black_provider ? "token" : null,
			};
		}
		return {
			accountId: row.white_player_id,
			name: this.normalizeLobbyName(row.white_participant_name ?? row.white_account_name, "White Player"),
			isGuest: row.white_provider === "guest",
			accountMode: row.white_provider === "guest" ? "guest" : row.white_provider ? "token" : null,
		};
	}

	private async hydrateConnectionIdentity(connectionId: string): Promise<void> {
		const conn = this.connections.get(connectionId);
		if (!conn) return;
		if (conn.role !== "black" && conn.role !== "white") return;
		const seatIdentity = await this.resolveSeatIdentity(conn.role);
		const fallback = conn.role === "black" ? "Black Player" : "White Player";
		conn.displayName = this.normalizeLobbyName(seatIdentity.name, fallback);
		conn.isGuest = seatIdentity.isGuest;
		conn.accountMode = seatIdentity.accountMode;
		conn.accountId = seatIdentity.accountId;
	}

	private findPrimaryConnectionByRole(role: ConnectionRole): [string, ConnectionEntry] | null {
		for (const entry of this.connections.entries()) {
			if (entry[1].role === role) return entry;
		}
		return null;
	}

	private getConnectionRole(connectionId: string): ConnectionRole | null {
		return this.connections.get(connectionId)?.role ?? null;
	}

	private getRoomRoster(): { black: LobbyPerson | null; white: LobbyPerson | null; spectators: LobbyPerson[] } {
		let black: LobbyPerson | null = null;
		let white: LobbyPerson | null = null;
		const spectators: LobbyPerson[] = [];
		for (const [connectionId, conn] of this.connections.entries()) {
			const person: LobbyPerson = {
				connectionId,
				name: this.normalizeLobbyName(conn.displayName, conn.role === "spectator" ? "Spectator" : `${conn.role} player`),
				isGuest: Boolean(conn.isGuest),
				seat: conn.role,
			};
			if (conn.role === "black" && !black) {
				black = person;
			} else if (conn.role === "white" && !white) {
				white = person;
			} else {
				spectators.push({ ...person, seat: "spectator" });
			}
		}
		return { black, white, spectators };
	}

	private async resolveAccountSnapshot(accountId: string): Promise<{ name: string; email: string | null; isGuest: boolean } | null> {
		const row = await this.env.DB
			.prepare("SELECT name, email, provider FROM accounts WHERE id = ?")
			.bind(accountId)
			.first<{ name: string; email: string | null; provider: string }>();
		if (!row) return null;
		return {
			name: this.normalizeLobbyName(row.name, "Player"),
			email: row.email ?? null,
			isGuest: row.provider === "guest",
		};
	}

	private async assignLobbySeat(targetConnectionId: string, seat: ConnectionRole): Promise<void> {
		const target = this.connections.get(targetConnectionId);
		if (!target) {
			throw new Error("Target participant is not connected");
		}
		if (target.role === seat) return;
		if ((seat === "black" || seat === "white") && !target.accountId) {
			throw new Error("Target participant is not identified yet");
		}

		const nextRoles = new Map<string, ConnectionRole>();
		for (const [id, conn] of this.connections.entries()) {
			nextRoles.set(id, conn.role);
		}
		nextRoles.set(targetConnectionId, seat);
		if (seat === "black") {
			const currentBlack = this.findPrimaryConnectionByRole("black");
			if (currentBlack && currentBlack[0] !== targetConnectionId) {
				nextRoles.set(currentBlack[0], "spectator");
			}
		}
		if (seat === "white") {
			const currentWhite = this.findPrimaryConnectionByRole("white");
			if (currentWhite && currentWhite[0] !== targetConnectionId) {
				nextRoles.set(currentWhite[0], "spectator");
			}
		}

		let nextBlackId: string | null = null;
		let nextWhiteId: string | null = null;
		for (const [id, role] of nextRoles.entries()) {
			if (role === "black" && !nextBlackId) nextBlackId = id;
			if (role === "white" && !nextWhiteId) nextWhiteId = id;
		}

		const blackConn = nextBlackId ? this.connections.get(nextBlackId) ?? null : null;
		const whiteConn = nextWhiteId ? this.connections.get(nextWhiteId) ?? null : null;
		if (blackConn && !blackConn.accountId) {
			throw new Error("Black seat requires an identified participant");
		}
		if (whiteConn && !whiteConn.accountId) {
			throw new Error("White seat requires an identified participant");
		}

		const blackAccount =
			blackConn?.accountId ? await this.resolveAccountSnapshot(blackConn.accountId) : null;
		if (blackConn?.accountId && !blackAccount) throw new Error("Failed to resolve black player account");
		const whiteAccount =
			whiteConn?.accountId ? await this.resolveAccountSnapshot(whiteConn.accountId) : null;
		if (whiteConn?.accountId && !whiteAccount) {
			throw new Error("Failed to resolve white player account");
		}

		if (!this.gameId) {
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		const nowIso = new Date().toISOString();
		const statements = [
			this.env.DB
				.prepare(
					"UPDATE games SET black_player_id = ?, black_token = ?, white_player_id = ?, white_token = ? WHERE id = ?",
				)
				.bind(
					blackConn?.accountId ?? null,
					blackConn?.token ?? null,
					whiteConn?.accountId ?? null,
					whiteConn?.token ?? null,
					this.gameId,
				),
			this.env.DB.prepare("DELETE FROM game_participants WHERE game_id = ? AND seat = 'black'").bind(this.gameId),
			this.env.DB.prepare("DELETE FROM game_participants WHERE game_id = ? AND seat = 'white'").bind(this.gameId),
		];
		if (blackConn?.accountId && blackAccount) {
			statements.push(
				this.env.DB
					.prepare(
						`INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
						 VALUES (?, 'black', ?, ?, ?, ?, ?)`,
					)
					.bind(this.gameId, blackConn.accountId, blackAccount.name, blackAccount.email, nowIso, nowIso),
			);
		}
		if (whiteConn?.accountId && whiteAccount) {
			statements.push(
				this.env.DB
					.prepare(
						`INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
						 VALUES (?, 'white', ?, ?, ?, ?, ?)`,
					)
					.bind(this.gameId, whiteConn.accountId, whiteAccount.name, whiteAccount.email, nowIso, nowIso),
			);
		}
		await this.env.DB.batch(statements);

		for (const [id, role] of nextRoles.entries()) {
			const conn = this.connections.get(id);
			if (conn) conn.role = role;
		}
		await Promise.all(
			Array.from(this.connections.entries()).map(async ([id, conn]) => {
				if (conn.role === "black" || conn.role === "white") {
					await this.hydrateConnectionIdentity(id);
				}
			}),
		);
		if (blackConn) this.players.black = { token: blackConn.token };
		else delete this.players.black;
		if (whiteConn) this.players.white = { token: whiteConn.token };
		else delete this.players.white;

		this.rematchOffers = { black: false, white: false };
		await this.updateGuestHostAbandonmentPolicy("assignLobbySeat");
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
			`SELECT
			   black_token,
			   white_token,
			   status,
			   COALESCE(games.host_account_id, games.black_player_id) AS host_account_id,
			   host_account.provider AS host_provider
			 FROM games
			 LEFT JOIN accounts host_account ON host_account.id = COALESCE(games.host_account_id, games.black_player_id)
			 WHERE games.id = ?`
		).bind(gameId).first<{
			black_token: string | null;
			white_token: string | null;
			status: string;
			host_account_id: string | null;
			host_provider: string | null;
		}>();
		
		if (!game) {
			ws.close(1008, "Game not found");
			return;
		}
		this.hostAccountId = game.host_account_id;
		this.hostIsGuest = game.host_provider === "guest";
		
		let role: ConnectionRole;
		if (token === game.black_token) {
			role = "black";
			this.players.black = { token };
		} else if (token === game.white_token) {
			role = "white";
			this.players.white = { token };
		} else {
			role = "spectator";
		}
		
		this.connections.set(connectionId, {
			ws,
			role,
			token,
			displayName: role === "black" ? "Black Player" : role === "white" ? "White Player" : "Spectator",
			isGuest: false,
			accountMode: null,
			accountId: null,
		});
		await this.hydrateConnectionIdentity(connectionId);
		ws.accept();
		this.logGame("ws.accept", {
			connectionId,
			role,
			gameId,
		});

		// Load game state and send initial sync
		await this.loadGameState();
		await this.sendSync(ws, role);
		this.broadcastRoomUpdate();
		await this.updateGuestHostAbandonmentPolicy("ws.connect");

		// Handle incoming messages
		ws.addEventListener("message", async (event) => {
			try {
				if (typeof event.data === "string") {
					// JSON control message
					const message = JSON.parse(event.data);
					// `time_sync` is expected to be frequent; logging it spams server logs.
					const messageType = message?.t ?? null;
					const currentRole = this.getConnectionRole(connectionId) ?? role;
					if (messageType !== "time_sync") {
						this.logGame("ws.message.inbound", {
							connectionId,
							role: currentRole,
							dataType: typeof event.data,
							ctor: (event.data as any)?.constructor?.name ?? null,
							byteLength: null,
						});
						this.logGame("ws.message.json", {
							connectionId,
							role: currentRole,
							type: messageType,
						});
					}
					await this.handleControlMessage(connectionId, message, ws);
				} else if (
					event.data instanceof ArrayBuffer ||
					ArrayBuffer.isView(event.data) ||
					event.data instanceof Blob
				) {
					const currentRole = this.getConnectionRole(connectionId) ?? role;
					this.logGame("ws.message.inbound", {
						connectionId,
						role: currentRole,
						dataType: typeof event.data,
						ctor: (event.data as any)?.constructor?.name ?? null,
						byteLength:
							event.data instanceof ArrayBuffer
								? event.data.byteLength
								: event.data instanceof Blob
								? event.data.size
								: null,
					});
					let binaryData: ArrayBuffer | null = null;
					if (event.data instanceof ArrayBuffer) {
						binaryData = event.data;
					} else if (ArrayBuffer.isView(event.data)) {
						const bytes = new Uint8Array(
							event.data.buffer,
							event.data.byteOffset,
							event.data.byteLength
						);
						binaryData = bytes.slice().buffer;
					} else if (event.data instanceof Blob) {
						binaryData = await event.data.arrayBuffer();
					}

					// Binary action word (4 bytes)
					if (binaryData && binaryData.byteLength === 4) {
						const view = new DataView(binaryData);
						const actionWord = view.getUint32(0, true); // little-endian
						this.logGame("ws.message.action", {
							connectionId,
							role: currentRole,
							...this.describeAction(actionWord),
							ply: this.gameState?.ply ?? null,
						});
						await this.handleActionWord(connectionId, actionWord, ws);
					} else {
						this.logGame("ws.message.ignored", {
							connectionId,
							role: currentRole,
							dataType: typeof event.data,
							ctor: (event.data as any)?.constructor?.name ?? null,
							reason: "binary_length_not_4",
						});
					}
				} else {
					const currentRole = this.getConnectionRole(connectionId) ?? role;
					this.logGame("ws.message.inbound", {
						connectionId,
						role: currentRole,
						dataType: typeof event.data,
						ctor: (event.data as any)?.constructor?.name ?? null,
						byteLength: null,
					});
					this.logGame("ws.message.ignored", {
						connectionId,
						role: currentRole,
						dataType: typeof event.data,
						ctor: (event.data as any)?.constructor?.name ?? null,
					});
				}
			} catch (error) {
				const currentRole = this.getConnectionRole(connectionId) ?? role;
				this.logGame("ws.message.error", {
					connectionId,
					role: currentRole,
					error: error instanceof Error ? error.message : String(error),
				});
				this.sendError(ws, error instanceof Error ? error.message : "Unknown error");
			}
		});

		ws.addEventListener("close", (event) => {
			const currentRole = this.getConnectionRole(connectionId) ?? role;
			this.connections.delete(connectionId);
			this.logGame("ws.close", {
				connectionId,
				role: currentRole,
				code: event.code,
				reason: event.reason,
				wasClean: event.wasClean,
			});
			if (this.closingLobbySockets) {
				return;
			}
			this.broadcastRoomUpdate();
			void this.updateGuestHostAbandonmentPolicy("ws.close");
			if (this.roomStatus === "ended") {
				void this.purgeGuestOnlyHistoryIfRequired("ws.close");
			}
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
				? `SELECT games.status, games.initial_board, games.initial_turn, games.turn, games.ply, games.draw_offer_by, games.draw_offer_blocked,
			        COALESCE(games.host_account_id, games.black_player_id) AS host_account_id, host_account.provider AS host_provider,
			        games.time_control_json, games.room_settings_json, games.setup_state_json, games.clock_black_ms, games.clock_white_ms, games.created_at, games.started_at
			 FROM games
			 LEFT JOIN accounts host_account ON host_account.id = COALESCE(games.host_account_id, games.black_player_id)
			 WHERE games.id = ?`
				: `SELECT games.status, games.initial_board, games.initial_turn, games.turn, games.ply, games.draw_offer_by,
			        COALESCE(games.host_account_id, games.black_player_id) AS host_account_id, host_account.provider AS host_provider,
			        games.time_control_json, games.room_settings_json, games.setup_state_json, games.clock_black_ms, games.clock_white_ms, games.created_at, games.started_at
			 FROM games
			 LEFT JOIN accounts host_account ON host_account.id = COALESCE(games.host_account_id, games.black_player_id)
			 WHERE games.id = ?`
		).bind(gameId).first<{
			status: string;
			initial_board: Uint8Array;
			initial_turn: number;
			turn: number;
			ply: number;
			draw_offer_by: number | null;
			draw_offer_blocked?: number | null;
			host_account_id: string | null;
			host_provider: string | null;
			time_control_json: string | null;
			room_settings_json: string | null;
			setup_state_json: string | null;
			clock_black_ms: number | null;
			clock_white_ms: number | null;
			created_at: string;
			started_at: string | null;
		}>();
		
		if (!game) {
			throw new Error("Game not found in database");
		}

		this.roomStatus =
			game.status === "active" || game.status === "ended" || game.status === "lobby"
				? (game.status as RoomStatus)
				: "lobby";
		this.hostAccountId = game.host_account_id ?? null;
		this.hostIsGuest = game.host_provider === "guest";
		if (game.room_settings_json) {
			try {
				this.roomSettings = normalizeRoomSettings(JSON.parse(game.room_settings_json));
			} catch {
				this.roomSettings = { ...DEFAULT_ROOM_SETTINGS };
			}
		} else {
			this.roomSettings = { ...DEFAULT_ROOM_SETTINGS };
		}
		if (game.setup_state_json) {
			try {
				this.setupSelections = normalizeSetupSelections(JSON.parse(game.setup_state_json));
			} catch {
				this.setupSelections = { black: null, white: null };
			}
		} else {
			this.setupSelections = { black: null, white: null };
		}
		if (this.roomStatus !== "ended") {
			this.rematchOffers = { black: false, white: false };
		}
		this.initialBoard = new Uint8Array(game.initial_board);
		this.currentStartColor = game.initial_turn as engine.Color;
		
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
			"SELECT action_u32, actor_color, created_at FROM game_actions WHERE game_id = ? ORDER BY ply ASC"
		).bind(gameId).all<{ action_u32: number; actor_color: number | null; created_at: string }>();
		
		const actions = actionsResult.results || [];
		const lastActionAt = actionsResult.results?.length
			? actionsResult.results[actionsResult.results.length - 1].created_at
			: null;
		const firstActionAt = actionsResult.results?.length
			? actionsResult.results[0].created_at
			: null;
		
		// Rebuild state by replaying actions
		this.gameState = {
			board: new Uint8Array(this.initialBoard ?? game.initial_board),
			turn: game.initial_turn as engine.Color,
			ply: 0,
			drawOfferBy: game.draw_offer_by as engine.Color | null,
			drawOfferBlocked: supportsBlocked ? (game.draw_offer_blocked as engine.Color | null) : null,
		};
		
		for (const entry of actions) {
			const action = entry.action_u32 >>> 0;
			const decoded = engine.decodeAction(action);
			if (decoded.opcode === 10) {
				if (entry.actor_color !== 0 && entry.actor_color !== 1) {
					throw new Error(`Invalid DRAW replay entry without actor_color at ply ${this.gameState.ply}`);
				}
				if (decoded.fields.actorColor !== entry.actor_color) {
					throw new Error(
						`Legacy or invalid DRAW encoding in replay at ply ${this.gameState.ply}: encoded actor=${decoded.fields.actorColor}, stored actor=${entry.actor_color}`
					);
				}
			}
			this.gameState = engine.applyAction(this.gameState, action);
		}

		// Initialize clocks from DB or use initial time
		this.clockBlackMs = game.clock_black_ms ?? this.timeControl.initialMs.black;
		this.clockWhiteMs = game.clock_white_ms ?? this.timeControl.initialMs.white;
		
		// Initialize buffers to full value at turn start
		this.bufferBlackMs = this.timeControl.bufferMs.black;
		this.bufferWhiteMs = this.timeControl.bufferMs.white;
		
		// Set turn start time based on last action (only if active)
		if (this.roomStatus === "active") {
			if (lastActionAt) {
				const parsed = Date.parse(lastActionAt);
				this.turnStartTime = Number.isNaN(parsed) ? Date.now() : parsed;
			} else if (this.turnStartTime === null) {
				this.turnStartTime = Date.now();
			}
		} else {
			this.turnStartTime = null;
		}

		// Set game start time for max game clock (skip in lobby)
		if (this.roomStatus !== "lobby") {
			if (game.started_at) {
				const parsedStart = Date.parse(game.started_at);
				this.gameStartTime = Number.isNaN(parsedStart) ? null : parsedStart;
			} else if (firstActionAt) {
				const parsedStart = Date.parse(firstActionAt);
				this.gameStartTime = Number.isNaN(parsedStart) ? null : parsedStart;
			} else {
				this.gameStartTime = null;
			}
		} else {
			this.gameStartTime = null;
		}

		await this.scheduleNextAlarm();

		this.actionLog = actions.map((entry) => entry.action_u32 >>> 0);
		
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

	private async isGuestOnlyMatch(): Promise<boolean> {
		if (this.isGuestOnlyMatchCache !== null) {
			return this.isGuestOnlyMatchCache;
		}
		if (!this.gameId) {
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		const row = await this.env.DB
			.prepare(
				`SELECT
				   black_account.provider AS black_provider,
				   white_account.provider AS white_provider
				 FROM games g
				 LEFT JOIN accounts black_account ON black_account.id = g.black_player_id
				 LEFT JOIN accounts white_account ON white_account.id = g.white_player_id
				 WHERE g.id = ?`,
			)
			.bind(this.gameId)
			.first<{ black_provider: string | null; white_provider: string | null }>();

		this.isGuestOnlyMatchCache = row?.black_provider === "guest" && row?.white_provider === "guest";
		return this.isGuestOnlyMatchCache;
	}

	private async purgeGuestOnlyHistoryIfRequired(trigger: string): Promise<void> {
		if (this.hasPurgedGuestOnlyHistory) return;
		if (!this.gameId) return;
		if (!(await this.isGuestOnlyMatch())) return;

		// M04 guardrail: guest-vs-guest games must not leave durable DB history rows.
		await this.env.DB.batch([
			this.env.DB.prepare("DELETE FROM game_actions WHERE game_id = ?").bind(this.gameId),
			this.env.DB.prepare("DELETE FROM game_participants WHERE game_id = ?").bind(this.gameId),
			this.env.DB.prepare("DELETE FROM games WHERE id = ?").bind(this.gameId),
		]);
		this.hasPurgedGuestOnlyHistory = true;
		this.logGame("guest.cleanup.purged", { trigger });
	}

	private async sendSync(ws: WebSocket, role: ConnectionRole): Promise<void> {
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
			roomStatus: this.roomStatus,
			roomSettings: this.roomSettings,
			setupSelections: this.getEffectiveLobbySelections(),
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

	private getConnectionCounts(): { black: number; white: number; spectator: number } {
		const counts = { black: 0, white: 0, spectator: 0 };
		for (const conn of this.connections.values()) {
			if (conn.role === "black") counts.black += 1;
			else if (conn.role === "white") counts.white += 1;
			else counts.spectator += 1;
		}
		return counts;
	}

	private hasBothPlayersConnected(): boolean {
		const counts = this.getConnectionCounts();
		return counts.black > 0 && counts.white > 0;
	}

	private getEffectiveLobbySelections(): engine.SetupSelectionsBySide {
		const setupConfig = this.roomSettings.setupConfig;
		if (setupConfig.enabled && setupConfig.mode === "shared" && setupConfig.sharedSelection) {
			return {
				black: {
					hash: setupConfig.sharedSelection.hash,
					flip: setupConfig.sharedSelection.flipBlack,
				},
				white: {
					hash: setupConfig.sharedSelection.hash,
					flip: setupConfig.sharedSelection.flipWhite,
				},
			};
		}
		return this.setupSelections;
	}

	private validateLobbySetupState(): {
		ok: boolean;
		issues: engine.SetupValidationIssue[];
		selections: engine.SetupSelectionsBySide;
	} {
		const setupConfig = this.roomSettings.setupConfig;
		const effectiveSelections = this.getEffectiveLobbySelections();
		if (!setupConfig.enabled) {
			return { ok: true, issues: [], selections: effectiveSelections };
		}
		const built = engine.buildBoardFromSetups({
			config: setupConfig,
			freeSelections: effectiveSelections,
		});
		if ("issues" in built) {
			return {
				ok: false,
				issues: built.issues,
				selections: effectiveSelections,
			};
		}
		return { ok: true, issues: [], selections: built.selections };
	}

	private broadcastRoomUpdate(): void {
		const counts = this.getConnectionCounts();
		const setupValidation = this.validateLobbySetupState();
		const canStart = this.roomStatus === "lobby" && this.hasBothPlayersConnected() && setupValidation.ok;
		const rematchReady = this.rematchOffers.black && this.rematchOffers.white;
		const roster = this.getRoomRoster();
		const baseMessage = {
			t: "room" as const,
			roomStatus: this.roomStatus,
			players: { black: counts.black, white: counts.white },
			spectators: counts.spectator,
			roster,
			canStart,
			rematch: { ...this.rematchOffers },
			rematchReady,
			setup: {
				config: this.roomSettings.setupConfig,
				selections: setupValidation.selections,
				issues: setupValidation.issues,
			},
		};
		for (const [connectionId, conn] of this.connections.entries()) {
			const message = JSON.stringify({
				...baseMessage,
				selfRole: conn.role,
				selfConnectionId: connectionId,
				selfIsHost: this.isHostConnection(conn),
			});
			const { ws } = conn;
			if (ws.readyState === 1) {
				ws.send(message);
			}
		}
	}

	private resolveStartColor(pref: RoomSettings["startColor"]): engine.Color {
		if (pref === "black") return 0;
		if (pref === "white") return 1;
		return Math.random() < 0.5 ? 0 : 1;
	}

	private resolveNextStartColor(): engine.Color {
		const previous = this.currentStartColor ?? 0;
		if (this.roomSettings.nextStartColor === "same") {
			return previous;
		}
		if (this.roomSettings.nextStartColor === "other") {
			return (previous ^ 1) as engine.Color;
		}
		return Math.random() < 0.5 ? 0 : 1;
	}

	private async startNewGame(mode: "start" | "next"): Promise<void> {
		await this.loadGameState();
		if (!this.timeControl) {
			throw new Error("Time control not loaded");
		}
		if (!this.initialBoard && !this.roomSettings.setupConfig.enabled) {
			throw new Error("Initial board not loaded");
		}
		if (!this.gameId) {
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}

		const startColor =
			mode === "start"
				? this.resolveStartColor(this.roomSettings.startColor)
				: this.resolveNextStartColor();
		this.currentStartColor = startColor;
		const nowIso = new Date().toISOString();
		const nowMs = Date.parse(nowIso);
		const setupConfig = this.roomSettings.setupConfig;
		let effectiveSetupSelections = this.getEffectiveLobbySelections();
		let nextInitialBoard: Uint8Array;
		if (setupConfig.enabled) {
			const built = engine.buildBoardFromSetups({
				config: setupConfig,
				freeSelections: effectiveSetupSelections,
			});
			if ("issues" in built) {
				const firstIssue = built.issues[0];
				throw new Error(firstIssue?.message ?? "Invalid setup configuration");
			}
			effectiveSetupSelections = built.selections;
			nextInitialBoard = built.board;
		} else {
			nextInitialBoard = new Uint8Array(this.initialBoard!);
		}
		this.initialBoard = new Uint8Array(nextInitialBoard);
		this.setupSelections = effectiveSetupSelections;

		this.gameState = {
			board: new Uint8Array(nextInitialBoard),
			turn: startColor,
			ply: 0,
			drawOfferBy: null,
			drawOfferBlocked: null,
		};
		this.drawOfferLastOfferAtMsByColor = [null, null];
		this.roomStatus = "active";
		this.guestHostCleanupDeadlineMs = null;
		this.rematchOffers = { black: false, white: false };
		this.clockBlackMs = this.timeControl.initialMs.black;
		this.clockWhiteMs = this.timeControl.initialMs.white;
		this.bufferBlackMs = this.timeControl.bufferMs.black;
		this.bufferWhiteMs = this.timeControl.bufferMs.white;
		this.turnStartTime = nowMs;
		this.gameStartTime = nowMs;
		this.actionLog = [];

		const legalActions = engine.generateLegalActions(this.gameState);
		this.legalSet = new Set(Array.from(legalActions));

		await this.env.DB.prepare("DELETE FROM game_actions WHERE game_id = ?")
			.bind(this.gameId)
			.run();

		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, initial_turn = ?, draw_offer_by = ?, draw_offer_blocked = ?,
				   clock_black_ms = ?, clock_white_ms = ?, status = ?, winner_color = ?, end_opcode = ?, end_reason = ?,
				   initial_board = ?, setup_state_json = ?, started_at = ?, ended_at = NULL, starting_player_color = ? WHERE id = ?`
			).bind(
				this.gameState.ply,
				this.gameState.turn,
				startColor,
				this.gameState.drawOfferBy,
				this.gameState.drawOfferBlocked,
				this.clockBlackMs,
				this.clockWhiteMs,
				"active",
				null,
				null,
				null,
				nextInitialBoard,
				JSON.stringify(this.setupSelections),
				nowIso,
				startColor,
				this.gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, initial_turn = ?, draw_offer_by = ?,
				   clock_black_ms = ?, clock_white_ms = ?, status = ?, winner_color = ?, end_opcode = ?, end_reason = ?,
				   initial_board = ?, setup_state_json = ?, started_at = ?, ended_at = NULL, starting_player_color = ? WHERE id = ?`
			).bind(
				this.gameState.ply,
				this.gameState.turn,
				startColor,
				this.gameState.drawOfferBy,
				this.clockBlackMs,
				this.clockWhiteMs,
				"active",
				null,
				null,
				null,
				nextInitialBoard,
				JSON.stringify(this.setupSelections),
				nowIso,
				startColor,
				this.gameId
			).run();
		}

		for (const { ws, role } of this.connections.values()) {
			await this.sendSync(ws, role);
		}
		this.broadcastRoomUpdate();
		await this.scheduleNextAlarm();
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
		} else if (message.t === "lobby_identify") {
			const conn = this.connections.get(connectionId);
			if (!conn) return;
			if (conn.role === "black" || conn.role === "white") {
				await this.hydrateConnectionIdentity(connectionId);
				this.broadcastRoomUpdate();
				return;
			}
			const incomingMode: LobbyAccountMode =
				message?.mode === "guest" ? "guest" : message?.mode === "token" ? "token" : null;
			const normalizedName = this.normalizeLobbyName(
				typeof message?.name === "string" ? message.name : null,
				"Spectator",
			);
			const accountId =
				typeof message?.accountId === "string" && message.accountId.length <= 96 ? message.accountId : null;
			conn.displayName = normalizedName;
			conn.accountId = accountId;
			conn.accountMode = incomingMode;
			conn.isGuest = incomingMode === "guest";

			if (accountId) {
				const snapshot = await this.resolveAccountSnapshot(accountId);
				if (snapshot) {
					conn.displayName = this.normalizeLobbyName(snapshot.name, normalizedName);
					conn.isGuest = snapshot.isGuest;
					conn.accountMode = snapshot.isGuest ? "guest" : "token";
				}
			}
			this.broadcastRoomUpdate();
			await this.updateGuestHostAbandonmentPolicy("lobby_identify");
		} else if (message.t === "lobby_set_seat") {
			const conn = this.connections.get(connectionId);
			if (!conn || !this.isHostConnection(conn)) {
				this.sendError(ws, "Only the host can reassign seats");
				return;
			}
			if (this.roomStatus !== "lobby") {
				this.sendError(ws, "Seats can only be changed in the lobby");
				return;
			}
			const targetConnectionId =
				typeof message.targetConnectionId === "string" ? message.targetConnectionId : null;
			const seat: ConnectionRole | null =
				message.seat === "black" || message.seat === "white" || message.seat === "spectator"
					? message.seat
					: null;
			if (!targetConnectionId || !seat) {
				this.sendError(ws, "Invalid seat reassignment request");
				return;
			}
			try {
				await this.assignLobbySeat(targetConnectionId, seat);
				for (const current of this.connections.values()) {
					if (current.ws.readyState === 1) {
						await this.sendSync(current.ws, current.role);
					}
				}
				this.broadcastRoomUpdate();
			} catch (error) {
				this.sendError(ws, error instanceof Error ? error.message : "Failed to reassign seat");
			}
		} else if (message.t === "start_game") {
			const conn = this.connections.get(connectionId);
			if (!conn || !this.isHostConnection(conn)) {
				this.sendError(ws, "Only the host can start the game");
				return;
			}
			if (this.roomStatus !== "lobby") {
				this.sendError(ws, "Game already started");
				return;
			}
			if (!this.hasBothPlayersConnected()) {
				this.sendError(ws, "Both seats must be filled and connected");
				return;
			}
			const setupValidation = this.validateLobbySetupState();
			if (!setupValidation.ok) {
				this.sendError(ws, setupValidation.issues[0]?.message ?? "Setup configuration is incomplete");
				return;
			}
			await this.startNewGame("start");
		} else if (message.t === "set_setup_selection") {
			const conn = this.connections.get(connectionId);
			if (!conn || conn.role === "spectator") {
				this.sendError(ws, "Only players can set setup selections");
				return;
			}
			if (this.roomStatus !== "lobby") {
				this.sendError(ws, "Setups can only be changed in the lobby");
				return;
			}
			const setupConfig = this.roomSettings.setupConfig;
			if (!setupConfig.enabled) {
				this.sendError(ws, "Custom setups are disabled");
				return;
			}
			if (setupConfig.mode !== "free") {
				this.sendError(ws, "Setup selections are host-controlled in shared mode");
				return;
			}
			if (typeof message.hash !== "string") {
				this.sendError(ws, "Missing setup hash");
				return;
			}
			const side: "black" | "white" = conn.role === "black" ? "black" : "white";
			const validation = engine.validateSetupSelection(
				{ hash: message.hash, flip: Boolean(message.flip) },
				setupConfig,
				side,
			);
			if ("issues" in validation) {
				this.sendError(ws, validation.issues[0]?.message ?? "Invalid setup selection");
				return;
			}
			this.setupSelections = {
				...this.setupSelections,
				[side]: validation.selection,
			};
			if (!this.gameId) {
				this.gameId = (this.state.id as any).name || this.state.id.toString();
			}
			await this.env.DB
				.prepare("UPDATE games SET setup_state_json = ? WHERE id = ?")
				.bind(JSON.stringify(this.setupSelections), this.gameId)
				.run();
			this.broadcastRoomUpdate();
		} else if (message.t === "set_shared_setup") {
			const conn = this.connections.get(connectionId);
			if (!conn || !this.isHostConnection(conn)) {
				this.sendError(ws, "Only the host can set shared setup");
				return;
			}
			if (this.roomStatus !== "lobby") {
				this.sendError(ws, "Setups can only be changed in the lobby");
				return;
			}
			const setupConfig = this.roomSettings.setupConfig;
			if (!setupConfig.enabled || setupConfig.mode !== "shared") {
				this.sendError(ws, "Shared setup mode is not enabled");
				return;
			}
			if (typeof message.hash !== "string") {
				this.sendError(ws, "Missing shared setup hash");
				return;
			}
			const normalizedHash = engine.normalizeSetupHash(message.hash);
			const nextConfig = engine.normalizeSetupConfig({
				...setupConfig,
				sharedSelection: {
					hash: normalizedHash,
					flipBlack: Boolean(message.flipHost),
					flipWhite: Boolean(message.flipOpponent),
				},
			});
			const built = engine.buildBoardFromSetups({ config: nextConfig });
			if ("issues" in built) {
				this.sendError(ws, built.issues[0]?.message ?? "Invalid shared setup");
				return;
			}
			this.roomSettings = {
				...this.roomSettings,
				setupConfig: nextConfig,
			};
			this.setupSelections = built.selections;
			if (!this.gameId) {
				this.gameId = (this.state.id as any).name || this.state.id.toString();
			}
			await this.env.DB.batch([
				this.env.DB
					.prepare("UPDATE games SET room_settings_json = ?, setup_state_json = ? WHERE id = ?")
					.bind(JSON.stringify(this.roomSettings), JSON.stringify(this.setupSelections), this.gameId),
			]);
			this.broadcastRoomUpdate();
		} else if (message.t === "rematch_offer") {
			const conn = this.connections.get(connectionId);
			if (!conn || conn.role === "spectator") {
				this.sendError(ws, "Only players can offer a rematch");
				return;
			}
			if (this.roomStatus !== "ended") {
				this.sendError(ws, "Game has not ended");
				return;
			}
			if (conn.role === "black") {
				this.rematchOffers.black = true;
			} else if (conn.role === "white") {
				this.rematchOffers.white = true;
			}
			this.broadcastRoomUpdate();
		} else if (message.t === "rematch_start") {
			const conn = this.connections.get(connectionId);
			if (!conn || conn.role === "spectator") {
				this.sendError(ws, "Only players can start a rematch");
				return;
			}
			if (this.roomStatus !== "ended") {
				this.sendError(ws, "Game has not ended");
				return;
			}
			if (!this.hasBothPlayersConnected()) {
				this.sendError(ws, "Both players must be connected");
				return;
			}
			if (!this.rematchOffers.black || !this.rematchOffers.white) {
				this.sendError(ws, "Both players must offer a rematch first");
				return;
			}
			await this.startNewGame("next");
		}
	}

	private async handleActionWord(
		connectionId: string,
		actionWord: number,
		ws: WebSocket
	): Promise<void> {
		const role = this.getConnectionRole(connectionId);
		if (!role) {
			this.sendError(ws, "Connection not registered");
			return;
		}
		if (!this.gameState) {
			this.logGame("action.reject", {
				connectionId,
				role,
				reason: "Game state not loaded",
				...this.describeAction(actionWord),
			});
			this.sendError(ws, "Game state not loaded");
			return;
		}
		if (this.roomStatus !== "active") {
			this.logGame("action.reject", {
				connectionId,
				role,
				reason: "Game has not started",
				...this.describeAction(actionWord),
			});
			this.sendError(ws, "Game has not started");
			return;
		}
		if (this.gameState.status === "ended") {
			this.logGame("action.reject", {
				connectionId,
				role,
				reason: "Game has ended",
				...this.describeAction(actionWord),
			});
			this.sendError(ws, "Game has ended");
			return;
		}
		
		const rawActionWord = actionWord >>> 0;
		this.logGame("action.recv", {
			connectionId,
			role,
			ply: this.gameState.ply,
			...this.describeAction(rawActionWord),
		});

		// Validate role
		const { opcode, fields } = engine.decodeAction(rawActionWord);
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
				this.sendError(ws, "Draw action color mismatch (legacy encoding not supported)");
				return;
			}
			if (opcode === 11 && fields.loserColor !== expectedColor) {
				this.sendError(ws, "Resign action color mismatch");
				return;
			}
		}

		// Additional DRAW throttling/turn rules (server-authoritative)
		if (opcode === 10) {
			const expectedColor = role === "black" ? 0 : 1;
			const drawAction = fields.drawAction as 0 | 1 | 2 | 3;
			const nowMs = Date.now();

			if (drawAction === 0) {
				this.drawOfferLastOfferAtMsByColor[expectedColor] = nowMs;
			} else if (drawAction === 1) {
				const lastOfferMs = this.drawOfferLastOfferAtMsByColor[expectedColor];
				if (typeof lastOfferMs === "number") {
					const remainingMs = 5000 - (nowMs - lastOfferMs);
					if (remainingMs > 0) {
						const remainingSeconds = Math.ceil(remainingMs / 1000);
						this.sendError(ws, `Please wait ${remainingSeconds}s before withdrawing your draw offer`);
						return;
					}
				}
			}
		}
		
		// Validate legality
		if (!this.legalSet.has(rawActionWord)) {
			this.logGame("action.reject", {
				connectionId,
				role,
				reason: "Illegal action",
				legalSetSize: this.legalSet.size,
				...this.describeAction(rawActionWord),
			});
			this.sendError(ws, "Illegal action");
			return;
		}
		this.logGame("action.legal", {
			connectionId,
			role,
			legalSetSize: this.legalSet.size,
			...this.describeAction(rawActionWord),
		});
		
		const shouldStartGame = this.gameStartTime === null && opcode !== 10 && opcode !== 11;
		const startedAtIso = shouldStartGame ? new Date().toISOString() : null;
		if (shouldStartGame) {
			this.gameStartTime = Date.parse(startedAtIso!);
		}

		// Apply action
		const previousState = this.gameState;
		const newState = engine.applyAction(this.gameState, rawActionWord);
		
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
		const actorColor = role === "black" ? 0 : 1;
		const actionPly = newState.ply - 1; // ply before this action
		
		// Update game row with clock values
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		const gameEnded = newState.status === "ended";
		const winnerColor = gameEnded ? newState.winner ?? null : null;
		const endOpcode = gameEnded ? opcode : null;
		const endReason = gameEnded && opcode === 11 ? fields.endReason : null;
		const nextStatus = gameEnded ? "ended" : "active";
		const endedAtIso = gameEnded ? new Date().toISOString() : null;
		
		// Use INSERT OR IGNORE to handle race conditions
		// Insert first and check if it succeeded before updating game state
		const insertResult = await this.env.DB.prepare(
			`INSERT OR IGNORE INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(
			gameId,
			actionPly,
			rawActionWord,
			actorColor,
			new Date().toISOString()
		).run();
		
		// Check if the insert succeeded (INSERT OR IGNORE returns changes=0 if row already exists)
		if (insertResult.meta.changes === 0) {
			// Race condition: another request already inserted this ply
			this.sendError(ws, "Action already processed");
			return;
		}
		
		// Only update game state if the insert succeeded
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
				   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, started_at = COALESCE(started_at, ?),
				   ended_at = CASE WHEN ? = 'ended' THEN COALESCE(ended_at, ?) ELSE ended_at END WHERE id = ?`
			).bind(
				newState.ply,
				newState.turn,
				newState.drawOfferBy,
				newState.drawOfferBlocked,
				this.clockBlackMs,
				this.clockWhiteMs,
				nextStatus,
				winnerColor,
				endOpcode,
				endReason,
				startedAtIso,
				nextStatus,
				endedAtIso,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
				   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, started_at = COALESCE(started_at, ?),
				   ended_at = CASE WHEN ? = 'ended' THEN COALESCE(ended_at, ?) ELSE ended_at END WHERE id = ?`
			).bind(
				newState.ply,
				newState.turn,
				newState.drawOfferBy,
				this.clockBlackMs,
				this.clockWhiteMs,
				nextStatus,
				winnerColor,
				endOpcode,
				endReason,
				startedAtIso,
				nextStatus,
				endedAtIso,
				gameId
			).run();
		}
		
		// Update local state
		this.gameState = newState;
		const legalActions = engine.generateLegalActions(this.gameState);
		const legalList = Array.from(legalActions);
		this.legalSet = new Set(legalList);
		this.actionLog.push(rawActionWord);
		this.logGame("action.apply.ok", {
			connectionId,
			role,
			plyBefore: previousState.ply,
			plyAfter: newState.ply,
			legalCount: legalList.length,
			...this.describeAction(rawActionWord),
		});
		
		// Broadcast action and Bloom filter
		this.broadcastAction(rawActionWord);
		if (gameEnded) {
			this.roomStatus = "ended";
			this.turnStartTime = null;
			this.rematchOffers = { black: false, white: false };
			this.broadcastRoomUpdate();
			await this.purgeGuestOnlyHistoryIfRequired("action.gameEnded");
		}
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
		this.logGame("broadcast.action", {
			targets: this.connections.size,
			...this.describeAction(actionWord),
			ply: this.gameState?.ply ?? null,
		});

		for (const { ws } of this.connections.values()) {
			if (ws.readyState === 1) { // WebSocket.OPEN
				const buffer = new ArrayBuffer(4);
				const view = new DataView(buffer);
				view.setUint32(0, actionWord, true); // little-endian
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
		this.logGame("broadcast.legal", {
			targets: this.connections.size,
			ply: this.gameState.ply,
			legalCount: legalActions.length,
			bloomM: bloom.m,
			bloomK: bloom.k,
			bloomBitsLength: bloom.bitsB64.length,
		});
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
		
		// This can be triggered by an alarm. After a server restart, alarms (or concurrent workers)
		// can re-run and attempt to write the same terminal ply twice. Make it idempotent.
		const insertEndResult = await this.env.DB.prepare(
			`INSERT OR IGNORE INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(gameId, endedState.ply - 1, endAction, null, new Date().toISOString()).run();
		if (insertEndResult.meta.changes === 0) {
			// Someone already ended the game at this ply.
			// Still ensure the `games` row is marked as ended so the lobby doesn't treat it as active.
			const nowIso = new Date().toISOString();
			const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
			if (supportsBlocked) {
				await this.env.DB.prepare(
					`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
					   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
					nowIso,
					gameId
				).run();
			} else {
				await this.env.DB.prepare(
					`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
					   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
					nowIso,
					gameId
				).run();
			}

			this.gameState = endedState;
			this.roomStatus = "ended";
			this.turnStartTime = null;
			await this.purgeGuestOnlyHistoryIfRequired("end.no_moves.idempotent");
			await this.scheduleNextAlarm();
			return;
		}
		
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		const nowIso = new Date().toISOString();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
				nowIso,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
				nowIso,
				gameId
			).run();
		}
		
		this.gameState = endedState;
		const legalActions = engine.generateLegalActions(endedState);
		this.legalSet = new Set(Array.from(legalActions));
		this.actionLog.push(endAction);
		
		this.broadcastAction(endAction);
		this.broadcastBloomFilter(Array.from(legalActions));
		this.roomStatus = "ended";
		this.turnStartTime = null;
		this.rematchOffers = { black: false, white: false };
		this.broadcastRoomUpdate();
		await this.purgeGuestOnlyHistoryIfRequired("end.no_moves");
	}

	private async applyTimeoutEnd(loserColor: engine.Color, gameId: string): Promise<void> {
		if (!this.gameState || this.gameState.status === "ended") return;
		
		const endAction = engine.encodeEnd(2, loserColor);
		const endedState = engine.applyAction(this.gameState, endAction);
		
		// Idempotent end write: alarm can re-run after restarts.
		const insertEndResult = await this.env.DB.prepare(
			`INSERT OR IGNORE INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(gameId, endedState.ply - 1, endAction, null, new Date().toISOString()).run();
		if (insertEndResult.meta.changes === 0) {
			const nowIso = new Date().toISOString();
			const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
			if (supportsBlocked) {
				await this.env.DB.prepare(
					`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
					   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
					nowIso,
					gameId
				).run();
			} else {
				await this.env.DB.prepare(
					`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
					   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
					nowIso,
					gameId
				).run();
			}

			this.gameState = endedState;
			this.roomStatus = "ended";
			this.turnStartTime = null;
			await this.purgeGuestOnlyHistoryIfRequired("end.timeout.idempotent");
			await this.scheduleNextAlarm();
			return;
		}
		
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		const nowIso = new Date().toISOString();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
				nowIso,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
				nowIso,
				gameId
			).run();
		}
		
		this.gameState = endedState;
		const legalActions = engine.generateLegalActions(endedState);
		this.legalSet = new Set(Array.from(legalActions));
		this.actionLog.push(endAction);
		
		this.broadcastAction(endAction);
		this.broadcastBloomFilter(Array.from(legalActions));
		this.roomStatus = "ended";
		this.turnStartTime = null;
		this.rematchOffers = { black: false, white: false };
		this.broadcastRoomUpdate();
		await this.purgeGuestOnlyHistoryIfRequired("end.timeout");
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
		let nextDeadline: number | null = null;
		if (this.guestHostCleanupDeadlineMs !== null) {
			nextDeadline = this.guestHostCleanupDeadlineMs;
		}

		const hasActiveClock =
			this.gameState &&
			this.timeControl &&
			this.roomStatus === "active" &&
			this.gameState.status !== "ended";
		if (hasActiveClock && this.turnStartTime !== null) {
			const activeColor = this.gameState.turn === 0 ? "black" : "white";
			const bufferMs = this.timeControl.bufferMs[activeColor];
			const clockMs = activeColor === "black" ? this.clockBlackMs : this.clockWhiteMs;
			const deadline = this.turnStartTime + bufferMs + clockMs;
			if (Number.isFinite(deadline)) {
				nextDeadline = nextDeadline === null ? deadline : Math.min(nextDeadline, deadline);
			}
		}

		if (hasActiveClock && this.timeControl.maxGameMs != null && this.gameStartTime !== null) {
			const maxDeadline = this.gameStartTime + this.timeControl.maxGameMs;
			if (Number.isFinite(maxDeadline)) {
				nextDeadline = nextDeadline === null ? maxDeadline : Math.min(nextDeadline, maxDeadline);
			}
		}

		if (nextDeadline === null) {
			await this.state.storage.deleteAlarm();
			return;
		}
		await this.state.storage.setAlarm(new Date(nextDeadline));
	}

	private async applyMaxGameEnd(gameId: string): Promise<void> {
		if (!this.gameState || this.gameState.status === "ended") return;
		
		const endAction = engine.encodeEnd(3);
		const endedState = engine.applyAction(this.gameState, endAction);
		
		// Idempotent end write: alarm can re-run after restarts.
		const insertEndResult = await this.env.DB.prepare(
			`INSERT OR IGNORE INTO game_actions (game_id, ply, action_u32, actor_color, created_at)
			 VALUES (?, ?, ?, ?, ?)`
		).bind(gameId, endedState.ply - 1, endAction, null, new Date().toISOString()).run();
		if (insertEndResult.meta.changes === 0) {
			const nowIso = new Date().toISOString();
			const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
			if (supportsBlocked) {
				await this.env.DB.prepare(
					`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
					   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
					nowIso,
					gameId
				).run();
			} else {
				await this.env.DB.prepare(
					`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
					   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
					nowIso,
					gameId
				).run();
			}

			this.gameState = endedState;
			this.roomStatus = "ended";
			this.turnStartTime = null;
			await this.purgeGuestOnlyHistoryIfRequired("end.max_game.idempotent");
			await this.scheduleNextAlarm();
			return;
		}
		
		const supportsBlocked = await this.ensureDrawOfferBlockedSupport();
		const nowIso = new Date().toISOString();
		if (supportsBlocked) {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, draw_offer_blocked = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
				nowIso,
				gameId
			).run();
		} else {
			await this.env.DB.prepare(
				`UPDATE games SET ply = ?, turn = ?, draw_offer_by = ?, clock_black_ms = ?, clock_white_ms = ?,
			   status = ?, winner_color = ?, end_opcode = ?, end_reason = ?, ended_at = COALESCE(ended_at, ?) WHERE id = ?`
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
				nowIso,
				gameId
			).run();
		}
		
		this.gameState = endedState;
		const legalActions = engine.generateLegalActions(endedState);
		this.legalSet = new Set(Array.from(legalActions));
		this.actionLog.push(endAction);
		
		this.broadcastAction(endAction);
		this.broadcastBloomFilter(Array.from(legalActions));
		this.roomStatus = "ended";
		this.turnStartTime = null;
		this.rematchOffers = { black: false, white: false };
		this.broadcastRoomUpdate();
		await this.purgeGuestOnlyHistoryIfRequired("end.max_game");
	}

	async alarm(): Promise<void> {
		await this.loadGameState();
		const now = Date.now();
		if (
			this.guestHostCleanupDeadlineMs !== null &&
			now >= this.guestHostCleanupDeadlineMs &&
			(await this.purgeGuestHostAbandonedLobby("alarm.guest_host_timeout"))
		) {
			await this.state.storage.deleteAlarm();
			return;
		}
		if (!this.gameState || this.roomStatus !== "active" || this.gameState.status === "ended") {
			await this.scheduleNextAlarm();
			return;
		}
		if (!this.gameId) {
			this.gameId = (this.state.id as any).name || this.state.id.toString();
		}
		const gameId = this.gameId;

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
