import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { identitySchema, resolveIdentity, toHttpError } from "../lib/identity";

const cancelBodySchema = z.object({
  code: Str(),
  identity: identitySchema,
});

export class GameCancel extends OpenAPIRoute {
  schema = {
    tags: ["Game"],
    summary: "Cancel a lobby game (host only)",
    request: {
      body: {
        content: {
          "application/json": {
            schema: cancelBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Lobby cancelled",
        content: {
          "application/json": {
            schema: z.object({ ok: z.literal(true) }),
          },
        },
      },
      "403": { description: "Not allowed" },
      "404": { description: "Game not found" },
      "400": { description: "Game not cancellable" },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();
    const code = data.body.code.trim().toUpperCase();

    let resolvedIdentity;
    try {
      resolvedIdentity = await resolveIdentity(env.DB, env.AUTH_TOKEN_SECRET, data.body.identity);
    } catch (error) {
      const normalized = toHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }

    const game = await env.DB
      .prepare("SELECT id, status, black_player_id FROM games WHERE code = ?")
      .bind(code)
      .first<{ id: string; status: string; black_player_id: string | null }>();

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }
    if (game.status !== "lobby") {
      return c.json({ error: "Game is not cancellable" }, 400);
    }
    if (!game.black_player_id || game.black_player_id !== resolvedIdentity.accountId) {
      return c.json({ error: "Only the host can cancel this lobby" }, 403);
    }

    const nowIso = new Date().toISOString();
    await env.DB
      .prepare(
        `UPDATE games
         SET status = 'ended',
             ended_at = ?,
             winner_color = NULL,
             end_opcode = NULL,
             end_reason = NULL
         WHERE code = ? AND status = 'lobby'`,
      )
      .bind(nowIso, code)
      .run();

    return { ok: true as const };
  }
}

