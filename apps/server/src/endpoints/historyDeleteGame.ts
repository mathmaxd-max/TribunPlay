import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { getAuthIdentityFromAccessToken, toAuthSessionHttpError } from "../lib/authSession";

const parseBearerToken = (headerValue: string | undefined): string | null => {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed.toLowerCase().startsWith("bearer ")) return null;
  const token = trimmed.slice(7).trim();
  return token.length > 0 ? token : null;
};

export class HistoryDeleteGame extends OpenAPIRoute {
  schema = {
    tags: ["History"],
    summary: "Delete one ended game from your history",
    request: {
      params: z.object({
        gameId: Str(),
      }),
    },
    responses: {
      "200": {
        description: "Delete result",
        content: {
          "application/json": {
            schema: z.object({
              success: z.boolean(),
              deletedMode: z.enum(["soft", "hard"]),
            }),
          },
        },
      },
      "401": { description: "Unauthorized" },
      "404": { description: "Game not found" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();
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
           self_participant.seat AS self_seat,
           opponent_participant.account_id AS opponent_account_id,
           opponent_participant.deleted_at AS opponent_deleted_at,
           opponent_account.provider AS opponent_provider
         FROM games g
         INNER JOIN game_participants self_participant
           ON self_participant.game_id = g.id
          AND self_participant.account_id = ?
          AND self_participant.deleted_at IS NULL
         LEFT JOIN game_participants opponent_participant
           ON opponent_participant.game_id = g.id
          AND opponent_participant.seat <> self_participant.seat
         LEFT JOIN accounts opponent_account
           ON opponent_account.id = opponent_participant.account_id
         WHERE g.id = ?
           AND g.status = 'ended'
         LIMIT 1`
      )
      .bind(identity.accountId, data.params.gameId)
      .first<{
        id: string;
        self_seat: "black" | "white";
        opponent_account_id: string | null;
        opponent_deleted_at: string | null;
        opponent_provider: "guest" | "google" | "email" | null;
      }>();

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    const nowIso = new Date().toISOString();
    await env.DB
      .prepare(
        `UPDATE game_participants
         SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
         WHERE game_id = ? AND account_id = ?`
      )
      .bind(nowIso, nowIso, game.id, identity.accountId)
      .run();

    const shouldHardDelete =
      !game.opponent_account_id || game.opponent_provider === "guest" || Boolean(game.opponent_deleted_at);

    if (!shouldHardDelete) {
      return { success: true, deletedMode: "soft" as const };
    }

    await env.DB.batch([
      env.DB.prepare("DELETE FROM game_actions WHERE game_id = ?").bind(game.id),
      env.DB.prepare("DELETE FROM game_participants WHERE game_id = ?").bind(game.id),
      env.DB.prepare("DELETE FROM games WHERE id = ?").bind(game.id),
    ]);

    return { success: true, deletedMode: "hard" as const };
  }
}
