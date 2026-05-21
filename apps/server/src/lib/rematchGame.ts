import type { D1Database } from "@cloudflare/workers-types";
import type * as engine from "@tribunplay/engine";

export type RematchParticipant = {
	seat: "black" | "white";
	accountId: string;
	name: string;
	email: string | null;
};

export type CreateRematchGameInput = {
	sourceGameId: string | null;
	hostAccountId: string | null;
	blackPlayerId: string | null;
	whitePlayerId: string | null;
	timeControlJson: string;
	roomSettingsJson: string;
	setupStateJson: string;
	initialBoard: Uint8Array;
	startColor: engine.Color;
	clockBlackMs: number;
	clockWhiteMs: number;
	participants: RematchParticipant[];
	swapParticipantSeats?: boolean;
	supportsDrawOfferBlocked: boolean;
};

export type CreateRematchGameResult = {
	gameId: string;
	code: string;
	blackToken: string;
	whiteToken: string;
};

const FRIEND_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateFriendCode(): string {
	let code = "";
	for (let i = 0; i < 6; i++) {
		code += FRIEND_CODE_CHARS[Math.floor(Math.random() * FRIEND_CODE_CHARS.length)];
	}
	return code;
}

const pickUnusedFriendCode = async (db: D1Database): Promise<string> => {
	for (let attempt = 0; attempt < 8; attempt += 1) {
		const code = generateFriendCode();
		const existing = await db.prepare("SELECT id FROM games WHERE code = ?").bind(code).first<{ id: string }>();
		if (!existing) return code;
	}
	throw new Error("Failed to allocate a unique friend code");
};

export async function createRematchGame(
	db: D1Database,
	input: CreateRematchGameInput,
): Promise<CreateRematchGameResult> {
	const gameId = crypto.randomUUID();
	const code = await pickUnusedFriendCode(db);
	const blackToken = crypto.randomUUID();
	const whiteToken = crypto.randomUUID();
	const nowIso = new Date().toISOString();

	const statements = [];

	if (input.supportsDrawOfferBlocked) {
		statements.push(
			db
				.prepare(
					`INSERT INTO games (
            id, code, status, created_at, started_at, initial_turn, turn, initial_board, ply,
            black_player_id, white_player_id, black_token, white_token,
            time_control_json, room_settings_json, setup_state_json, starting_player_color, host_account_id,
            clock_black_ms, clock_white_ms, draw_offer_by, draw_offer_blocked
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					gameId,
					code,
					"active",
					nowIso,
					nowIso,
					input.startColor,
					input.startColor,
					input.initialBoard,
					0,
					input.blackPlayerId,
					input.whitePlayerId,
					blackToken,
					whiteToken,
					input.timeControlJson,
					input.roomSettingsJson,
					input.setupStateJson,
					input.startColor,
					input.hostAccountId,
					input.clockBlackMs,
					input.clockWhiteMs,
					null,
					null,
				),
		);
	} else {
		statements.push(
			db
				.prepare(
					`INSERT INTO games (
            id, code, status, created_at, started_at, initial_turn, turn, initial_board, ply,
            black_player_id, white_player_id, black_token, white_token,
            time_control_json, room_settings_json, setup_state_json, starting_player_color, host_account_id,
            clock_black_ms, clock_white_ms, draw_offer_by
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(
					gameId,
					code,
					"active",
					nowIso,
					nowIso,
					input.startColor,
					input.startColor,
					input.initialBoard,
					0,
					input.blackPlayerId,
					input.whitePlayerId,
					blackToken,
					whiteToken,
					input.timeControlJson,
					input.roomSettingsJson,
					input.setupStateJson,
					input.startColor,
					input.hostAccountId,
					input.clockBlackMs,
					input.clockWhiteMs,
					null,
				),
		);
	}

	if (input.sourceGameId) {
		const seatSelect = input.swapParticipantSeats
			? `CASE seat WHEN 'black' THEN 'white' WHEN 'white' THEN 'black' ELSE seat END`
			: "seat";
		statements.push(
			db
				.prepare(
					`INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
           SELECT ?, ${seatSelect}, account_id, name, email, ?, ?
           FROM game_participants
           WHERE game_id = ? AND seat IN ('black', 'white')`,
				)
				.bind(gameId, nowIso, nowIso, input.sourceGameId),
		);
	}

	await db.batch(statements);

	if (!input.sourceGameId && input.participants.length > 0) {
		const participantStatements = input.participants.map((participant) =>
			db
				.prepare(
					`INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
				)
				.bind(gameId, participant.seat, participant.accountId, participant.name, participant.email, nowIso, nowIso),
		);
		await db.batch(participantStatements);
	} else if (input.sourceGameId) {
		const copied = await db
			.prepare("SELECT seat FROM game_participants WHERE game_id = ? AND seat IN ('black', 'white')")
			.bind(gameId)
			.all<{ seat: string }>();
		const copiedSeats = new Set((copied.results ?? []).map((row) => row.seat));
		const missing = input.participants.filter((participant) => !copiedSeats.has(participant.seat));
		if (missing.length > 0) {
			await db.batch(
				missing.map((participant) =>
					db
						.prepare(
							`INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
						)
						.bind(
							gameId,
							participant.seat,
							participant.accountId,
							participant.name,
							participant.email,
							nowIso,
							nowIso,
						),
				),
			);
		}
	}

	return { gameId, code, blackToken, whiteToken };
}
