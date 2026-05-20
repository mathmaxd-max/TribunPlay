import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import * as engine from "@tribunplay/engine";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";
import { isReviewRelevantAction } from "../lib/reviewActions";

type GameRow = {
  id: string;
  code: string;
  status: string;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
  winner_color: number | null;
  end_opcode: number | null;
  end_reason: number | null;
  self_seat: "black" | "white";
  opponent_name: string | null;
  initial_board: Uint8Array | ArrayBuffer;
  initial_turn: number;
  time_control_json: string | null;
};

type ActionRow = {
  ply: number;
  action_u32: number;
  actor_color: number | null;
  created_at: string;
};

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

const asUint8Array = (value: Uint8Array | ArrayBuffer): Uint8Array => {
  if (value instanceof Uint8Array) {
    return value;
  }
  return new Uint8Array(value);
};

const encodeActionsB64 = (actions: number[]): string => {
  const bytes = new Uint8Array(actions.length * 4);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < actions.length; i += 1) {
    view.setUint32(i * 4, actions[i] >>> 0, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

export class HistoryGame extends OpenAPIRoute {
  schema = {
    tags: ["History"],
    summary: "Load one game with replay actions",
    request: {
      params: z.object({
        gameId: Str(),
      }),
    },
    responses: {
      "200": {
        description: "Replay payload",
      },
      "401": { description: "Unauthorized" },
      "404": { description: "Game not found" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();
    const gameId = data.params.gameId;
    const accessToken = parseBearerToken(c.req.header("Authorization"));
    if (!accessToken) {
      return c.json({ error: "Missing bearer token" }, 401);
    }

    let identity;
    try {
      identity = await getAuthIdentityFromAccessToken({
        db: env.DB,
        tokenSecret: env.AUTH_TOKEN_SECRET,
        accessToken,
      });
    } catch (error) {
      const normalized = toAuthSessionHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 401 | 500);
    }

    const game = await env.DB
      .prepare(
        `SELECT
           g.id,
           g.code,
           g.status,
           g.created_at,
           g.started_at,
           g.ended_at,
           g.winner_color,
           g.end_opcode,
           g.end_reason,
           g.initial_board,
           g.initial_turn,
           g.time_control_json,
           self_participant.seat AS self_seat,
           opponent_participant.name AS opponent_name
         FROM games g
         INNER JOIN game_participants self_participant
           ON self_participant.game_id = g.id
          AND self_participant.account_id = ?
          AND self_participant.deleted_at IS NULL
         LEFT JOIN game_participants opponent_participant
           ON opponent_participant.game_id = g.id
          AND opponent_participant.seat <> self_participant.seat
         WHERE g.id = ?
           AND g.status = 'ended'
         LIMIT 1`,
      )
      .bind(identity.accountId, gameId)
      .first<GameRow>();

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    const actionsResult = await env.DB
      .prepare(
        `SELECT ply, action_u32, actor_color, created_at
         FROM game_actions
         WHERE game_id = ?
         ORDER BY ply ASC`,
      )
      .bind(gameId)
      .all<ActionRow>();

    const actionRows = (actionsResult.results ?? []).filter((row) =>
      isReviewRelevantAction(row.action_u32),
    );
    const actionWords = actionRows.map((row) => row.action_u32 >>> 0);

    let parsedTimeControl: unknown = null;
    if (game.time_control_json) {
      try {
        parsedTimeControl = JSON.parse(game.time_control_json);
      } catch {
        parsedTimeControl = null;
      }
    }

    const boardBytes = asUint8Array(game.initial_board);
    const seat = game.self_seat;
    const opponent = game.opponent_name;

    return {
      game: {
        gameId: game.id,
        code: game.code,
        status: game.status,
        seat,
        opponent: { name: opponent },
        winnerColor: game.winner_color,
        endOpcode: game.end_opcode,
        endReason: game.end_reason,
        createdAt: game.created_at,
        startedAt: game.started_at,
        endedAt: game.ended_at,
      },
      snapshot: {
        boardB64: engine.packBoard(boardBytes),
        initialTurn: game.initial_turn as engine.Color,
        timeControl: parsedTimeControl,
      },
      actions: actionRows.map((row) => ({
        ply: row.ply,
        actionU32: row.action_u32 >>> 0,
        actorColor: row.actor_color,
        createdAt: row.created_at,
      })),
      actionsB64: encodeActionsB64(actionWords),
    };
  }
}
