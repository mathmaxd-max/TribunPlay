import { OpenAPIRoute } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { identitySchema, resolveIdentity, toHttpError } from "../lib/identity";

const activeGameBodySchema = z.object({
  identity: identitySchema,
});

export class GameActiveForAccount extends OpenAPIRoute {
  schema = {
    tags: ["Game"],
    summary: "Find lobby/active game for current player",
    request: {
      body: {
        content: {
          "application/json": {
            schema: activeGameBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns current lobby/active game code or null",
        content: {
          "application/json": {
            schema: z.object({
              code: z.string().nullable(),
              gameId: z.string().nullable(),
              status: z.string().nullable(),
              seat: z.enum(["black", "white", "spectator"]).nullable(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();

    let resolvedIdentity;
    try {
      resolvedIdentity = await resolveIdentity(env.DB, env.AUTH_TOKEN_SECRET, data.body.identity);
    } catch (error) {
      const normalized = toHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }

    const accountId = resolvedIdentity.accountId;
    const row = await env.DB
      .prepare(
        `SELECT
           g.id,
           g.code,
           g.status,
           gp.seat,
           COALESCE(g.host_account_id, g.black_player_id) AS host_account_id
         FROM games g
         LEFT JOIN game_participants gp ON gp.game_id = g.id AND gp.account_id = ?
         WHERE g.status IN ('lobby', 'active')
           AND (gp.account_id = ? OR COALESCE(g.host_account_id, g.black_player_id) = ?)
         ORDER BY g.created_at DESC
         LIMIT 1`,
      )
      .bind(accountId, accountId, accountId)
      .first<{
        id: string;
        code: string;
        status: string;
        seat: "black" | "white" | null;
        host_account_id: string | null;
      }>();

    if (!row) {
      return { code: null, gameId: null, status: null, seat: null };
    }

    const seat: "black" | "white" | "spectator" =
      row.seat === "black" || row.seat === "white" ? row.seat : "spectator";
    return { code: row.code, gameId: row.id, status: row.status, seat };
  }
}
