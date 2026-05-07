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
              seat: z.enum(["black", "white"]).nullable(),
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
        `SELECT id, code, status, black_player_id, white_player_id
         FROM games
         WHERE status IN ('lobby', 'active')
           AND (black_player_id = ? OR white_player_id = ?)
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(accountId, accountId)
      .first<{
        id: string;
        code: string;
        status: string;
        black_player_id: string | null;
        white_player_id: string | null;
      }>();

    if (!row) {
      return { code: null, gameId: null, status: null, seat: null };
    }

    const seat = row.black_player_id === accountId ? "black" : row.white_player_id === accountId ? "white" : null;
    if (!seat) {
      return { code: null, gameId: null, status: null, seat: null };
    }

    return { code: row.code, gameId: row.id, status: row.status, seat };
  }
}

