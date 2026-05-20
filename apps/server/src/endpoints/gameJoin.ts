import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import { identitySchema, resolveIdentity, toHttpError } from "../lib/identity";
import { resolveTurnstileServerConfig, verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt, resetAuthAttempt } from "../lib/authRateLimit";

const joinGameBodySchema = z.object({
  code: Str(),
  identity: identitySchema,
  turnstileToken: Str({ required: false }),
});

export class GameJoin extends OpenAPIRoute {
  schema = {
    tags: ["Game"],
    summary: "Join a game by code",
    request: {
      body: {
        content: {
          "application/json": {
            schema: joinGameBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns game join info",
        content: {
          "application/json": {
            schema: z.object({
              gameId: Str(),
              seat: z.enum(["black", "white", "spectator"]),
              token: Str(),
              wsUrl: Str(),
              participant: z.object({
                accountId: Str(),
                name: Str(),
                email: z.string().nullable(),
                mode: z.enum(["guest", "token"]),
                seat: z.enum(["black", "white", "spectator"]),
              }),
            }),
          },
        },
      },
      "404": {
        description: "Game not found",
      },
      "400": {
        description: "Game is full or invalid",
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();
    const code = data.body.code.trim().toUpperCase();
    const body = data.body;

    const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";
    const guestRateBucket = `game_join_ip:${clientIp}`;
    const turnstileConfig = resolveTurnstileServerConfig({
      enabledFlag: env.TURNSTILE_ENABLED,
      configuredSecretKey: env.TURNSTILE_SECRET_KEY,
      requestUrl: c.req.url,
      hostHeader: c.req.header("Host") ?? undefined,
    });

    if (body.identity.mode === "guest") {
      try {
        // M01 additional non-invasive bot protection (guest): per-IP limiting on joining games.
        await consumeAuthAttempt(env.DB, guestRateBucket);
      } catch {
        return c.json({ error: "Too many join attempts. Please try again later." }, 429);
      }
    }

    let resolvedIdentity;
    try {
      resolvedIdentity = await resolveIdentity(env.DB, env.AUTH_TOKEN_SECRET, body.identity);
    } catch (error) {
      const normalized = toHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }

    const game = await env.DB
      .prepare("SELECT id, black_player_id, white_player_id, status FROM games WHERE code = ?")
      .bind(code)
      .first<{
        id: string;
        black_player_id: string | null;
        white_player_id: string | null;
        status: string;
      }>();

    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }

    if (game.status !== "lobby" && game.status !== "active") {
      return c.json({ error: "Game is not joinable" }, 400);
    }

    const isReturningPlayer =
      game.black_player_id === resolvedIdentity.accountId ||
      game.white_player_id === resolvedIdentity.accountId;

    if (turnstileConfig.enabled && body.identity.mode === "guest" && !isReturningPlayer) {
      const captcha = await verifyTurnstile({
        enabled: true,
        secretKey: turnstileConfig.secretKey,
        token: body.turnstileToken,
        remoteIp: clientIp,
      });
      if (captcha.success === false) {
        return c.json({ error: captcha.error }, 400);
      }
    }

    const gameId = game.id;
    const token = crypto.randomUUID();
    let seat: "black" | "white" | "spectator" = "spectator";

    const claimOrRefreshSeat = async (
      targetSeat: "black" | "white",
      targetColumn: "black_player_id" | "white_player_id",
      tokenColumn: "black_token" | "white_token",
      mode: "refresh" | "claim",
    ): Promise<boolean> => {
      const result =
        mode === "refresh"
          ? await env.DB
              .prepare(
                `UPDATE games
                 SET ${tokenColumn} = ?
                 WHERE id = ? AND ${targetColumn} = ? AND status IN ('lobby', 'active')`
              )
              .bind(token, gameId, resolvedIdentity.accountId)
              .run()
          : await env.DB
              .prepare(
                `UPDATE games
                 SET ${targetColumn} = ?, ${tokenColumn} = ?
                 WHERE id = ? AND ${targetColumn} IS NULL AND status IN ('lobby', 'active')`
              )
              .bind(resolvedIdentity.accountId, token, gameId)
              .run();

      if (result.meta.changes > 0) {
        seat = targetSeat;
        return true;
      }
      return false;
    };

    if (game.black_player_id === resolvedIdentity.accountId) {
      await claimOrRefreshSeat("black", "black_player_id", "black_token", "refresh");
    } else if (game.white_player_id === resolvedIdentity.accountId) {
      await claimOrRefreshSeat("white", "white_player_id", "white_token", "refresh");
    } else if (!game.black_player_id) {
      const claimed = await claimOrRefreshSeat("black", "black_player_id", "black_token", "claim");
      if (!claimed) {
        await claimOrRefreshSeat("white", "white_player_id", "white_token", "claim");
      }
    } else if (!game.white_player_id) {
      await claimOrRefreshSeat("white", "white_player_id", "white_token", "claim");
    }

    if (seat !== "spectator") {
      const nowIso = new Date().toISOString();
      await env.DB
        .prepare(
          `INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(game_id, seat) DO UPDATE SET
             account_id = excluded.account_id,
             name = excluded.name,
             email = excluded.email,
             updated_at = excluded.updated_at`
        )
        .bind(
          gameId,
          seat,
          resolvedIdentity.accountId,
          resolvedIdentity.name,
          resolvedIdentity.email,
          nowIso,
          nowIso,
        )
        .run();
    }

    const url = new URL(c.req.url);
    const wsUrl = `ws://${url.host}/ws/game/${gameId}?token=${token}`;

    if (body.identity.mode === "guest") {
      await resetAuthAttempt(env.DB, guestRateBucket);
    }

    return {
      gameId,
      seat,
      token,
      wsUrl,
      participant: {
        accountId: resolvedIdentity.accountId,
        name: resolvedIdentity.name,
        email: resolvedIdentity.email,
        mode: resolvedIdentity.mode,
        seat,
      },
    };
  }
}
