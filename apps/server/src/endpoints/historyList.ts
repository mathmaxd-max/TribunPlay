import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";

type HistoryRow = {
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
};

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class HistoryList extends OpenAPIRoute {
  schema = {
    tags: ["History"],
    summary: "List ended games for the authenticated account",
    responses: {
      "200": {
        description: "History list",
        content: {
          "application/json": {
            schema: z.object({
              games: z.array(
                z.object({
                  gameId: z.string(),
                  code: z.string(),
                  seat: z.enum(["black", "white"]),
                  opponent: z.object({
                    name: z.string().nullable(),
                  }),
                  status: z.string(),
                  result: z.enum(["win", "loss", "draw", "unknown"]),
                  winnerColor: z.number().nullable(),
                  endOpcode: z.number().nullable(),
                  endReason: z.number().nullable(),
                  createdAt: z.string(),
                  startedAt: z.string().nullable(),
                  endedAt: z.string().nullable(),
                }),
              ),
            }),
          },
        },
      },
      "401": { description: "Unauthorized" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
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

    const rows = await env.DB
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
           self_participant.seat AS self_seat,
           opponent_participant.name AS opponent_name
         FROM games g
         INNER JOIN game_participants self_participant
           ON self_participant.game_id = g.id
          AND self_participant.account_id = ?
         LEFT JOIN game_participants opponent_participant
           ON opponent_participant.game_id = g.id
          AND opponent_participant.seat <> self_participant.seat
         WHERE g.status = 'ended'
         ORDER BY COALESCE(g.ended_at, g.started_at, g.created_at) DESC`,
      )
      .bind(identity.accountId)
      .all<HistoryRow>();

    const games = (rows.results ?? []).map((row) => {
      const seat = row.self_seat;
      const opponentName = row.opponent_name;
      const seatColor = seat === "black" ? 0 : 1;
      const result =
        row.winner_color === null
          ? "draw"
          : row.winner_color === seatColor
          ? "win"
          : row.winner_color === (seatColor ^ 1)
          ? "loss"
          : "unknown";

      return {
        gameId: row.id,
        code: row.code,
        seat,
        opponent: { name: opponentName },
        status: row.status,
        result,
        winnerColor: row.winner_color,
        endOpcode: row.end_opcode,
        endReason: row.end_reason,
        createdAt: row.created_at,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      };
    });

    return { games };
  }
}
