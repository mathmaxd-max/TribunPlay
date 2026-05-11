import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import * as engine from "@tribunplay/engine";
import { identitySchema, resolveIdentity, toHttpError } from "../lib/identity";
import { resolveTurnstileServerConfig, verifyTurnstile } from "../lib/turnstile";
import { consumeAuthAttempt, resetAuthAttempt } from "../lib/authRateLimit";

const createGameBodySchema = z.object({
  timeControl: z
    .object({
      initialMs: z.union([z.number(), z.object({ black: z.number(), white: z.number() })]).optional(),
      bufferMs: z.union([z.number(), z.object({ black: z.number(), white: z.number() })]).optional(),
      incrementMs: z.union([z.number(), z.object({ black: z.number(), white: z.number() })]).optional(),
      maxGameMs: z.number().nullable().optional(),
    })
    .optional(),
  roomSettings: z
    .object({
      hostColor: z.enum(["black", "white", "random"]).optional(),
      startColor: z.enum(["black", "white", "random"]).optional(),
      nextStartColor: z.enum(["same", "other", "random"]).optional(),
      setupConfig: z
        .object({
          enabled: z.boolean().optional(),
          mode: z.enum(["shared", "free"]).optional(),
          sharedSelection: z
            .object({
              hash: z.string(),
              flipBlack: z.boolean().optional(),
              flipWhite: z.boolean().optional(),
            })
            .nullable()
            .optional(),
          allowedTribunHeights: z.array(z.union([z.literal(1), z.literal(2), z.literal(3)])).optional(),
          armySize: z
            .object({
              min: z.number().nullable().optional(),
              max: z.number().nullable().optional(),
            })
            .optional(),
        })
        .optional(),
      setupSelections: z
        .object({
          black: z
            .object({
              hash: z.string(),
              flip: z.boolean().optional(),
            })
            .nullable()
            .optional(),
          white: z
            .object({
              hash: z.string(),
              flip: z.boolean().optional(),
            })
            .nullable()
            .optional(),
        })
        .optional(),
    })
    .optional(),
  customPosition: z
    .object({
      black: z.record(z.string(), z.array(z.array(z.number()))),
      white: z.record(z.string(), z.array(z.array(z.number()))),
    })
    .optional(),
  boardBytesB64: z.string().optional(),
  unitsByCid: z.record(z.string(), z.array(z.number())).optional(),
  identity: identitySchema,
  turnstileToken: Str({ required: false }),
});

export class GameCreate extends OpenAPIRoute {
  schema = {
    tags: ["Game"],
    summary: "Create a new game",
    request: {
      body: {
        content: {
          "application/json": {
            schema: createGameBodySchema,
          },
        },
      },
    },
    responses: {
      "200": {
        description: "Returns game creation info",
        content: {
          "application/json": {
            schema: z.object({
              gameId: Str(),
              code: Str(),
              seat: z.enum(["black", "white", "spectator"]),
              token: Str(),
              wsUrl: Str(),
              participant: z.object({
                accountId: Str(),
                seat: z.enum(["black", "white", "spectator"]),
                name: Str(),
                email: z.string().nullable(),
                mode: z.enum(["guest", "token"]),
              }),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();
    const body = data.body;

    const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";
    const guestRateBucket = `game_create_ip:${clientIp}`;
    const turnstileConfig = resolveTurnstileServerConfig({
      enabledFlag: env.TURNSTILE_ENABLED,
      configuredSecretKey: env.TURNSTILE_SECRET_KEY,
      requestUrl: c.req.url,
      hostHeader: c.req.header("Host") ?? undefined,
    });

    if (turnstileConfig.enabled && body.identity.mode === "guest") {
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

    if (body.identity.mode === "guest") {
      try {
        // M01 additional non-invasive bot protection (guest): per-IP limiting on game creation.
        await consumeAuthAttempt(env.DB, guestRateBucket);
      } catch {
        return c.json({ error: "Too many create attempts. Please try again later." }, 429);
      }
    }

    let resolvedIdentity;
    try {
      resolvedIdentity = await resolveIdentity(env.DB, env.AUTH_TOKEN_SECRET, body.identity);
    } catch (error) {
      const normalized = toHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
    }

    // Prevent a player from creating multiple lobby/active games at once.
    // The web will proactively redirect, but this keeps the invariant server-side.
    const existing = await env.DB
      .prepare(
        `SELECT code FROM games
         WHERE status IN ('lobby', 'active')
           AND (
             black_player_id = ?
             OR white_player_id = ?
             OR COALESCE(host_account_id, black_player_id) = ?
           )
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .bind(resolvedIdentity.accountId, resolvedIdentity.accountId, resolvedIdentity.accountId)
      .first<{ code: string }>();
    if (existing?.code) {
      return c.json({ error: "You are already in an ongoing game.", code: existing.code }, 409);
    }

    const gameId = crypto.randomUUID();
    const code = this.generateFriendCode();
    const token = crypto.randomUUID();

    let initialBoard: Uint8Array;
    if (body.boardBytesB64) {
      initialBoard = engine.createInitialBoard(body.boardBytesB64);
    } else if (body.unitsByCid) {
      initialBoard = engine.createInitialBoardFromCids(body.unitsByCid);
    } else if (body.customPosition) {
      initialBoard = engine.createInitialBoard(body.customPosition as engine.DefaultPosition);
    } else {
      initialBoard = engine.createInitialBoard();
    }

    const initialTurn = 0;
    const rawSettings = body.roomSettings ?? null;
    const hostColor =
      rawSettings && ["black", "white", "random"].includes(rawSettings.hostColor)
        ? rawSettings.hostColor
        : "random";
    const startColor =
      rawSettings && ["black", "white", "random"].includes(rawSettings.startColor)
        ? rawSettings.startColor
        : "random";
    const nextStartColor =
      rawSettings && ["same", "other", "random"].includes(rawSettings.nextStartColor)
        ? rawSettings.nextStartColor
        : "other";
    const rawSetupConfig = rawSettings?.setupConfig;
    const setupConfigInput: Partial<engine.SetupConfig> = {
      enabled: Boolean(rawSetupConfig?.enabled),
      mode: rawSetupConfig?.mode === "shared" ? "shared" : "free",
      sharedSelection:
        rawSetupConfig?.sharedSelection && typeof rawSetupConfig.sharedSelection.hash === "string"
          ? {
              hash: engine.normalizeSetupHash(rawSetupConfig.sharedSelection.hash),
              flipBlack: Boolean(rawSetupConfig.sharedSelection.flipBlack),
              flipWhite: Boolean(rawSetupConfig.sharedSelection.flipWhite),
            }
          : null,
      allowedTribunHeights: rawSetupConfig?.allowedTribunHeights?.filter(
        (height): height is 1 | 2 | 3 => height === 1 || height === 2 || height === 3,
      ),
      armySize: {
        min: Number.isFinite(rawSetupConfig?.armySize?.min) ? Math.max(0, rawSetupConfig!.armySize!.min!) : null,
        max: Number.isFinite(rawSetupConfig?.armySize?.max) ? Math.max(0, rawSetupConfig!.armySize!.max!) : null,
      },
    };

    const roomSettings = {
      hostColor,
      startColor,
      nextStartColor,
      setupConfig: engine.normalizeSetupConfig(setupConfigInput),
    };
    const setupSelections: engine.SetupSelectionsBySide = {
      black: rawSettings?.setupSelections?.black
        ? {
            hash: engine.normalizeSetupHash(rawSettings.setupSelections.black.hash),
            flip: Boolean(rawSettings.setupSelections.black.flip),
          }
        : null,
      white: rawSettings?.setupSelections?.white
        ? {
            hash: engine.normalizeSetupHash(rawSettings.setupSelections.white.hash),
            flip: Boolean(rawSettings.setupSelections.white.flip),
          }
        : null,
    };
    if (roomSettings.setupConfig.enabled) {
      if (roomSettings.setupConfig.mode === "shared") {
        if (roomSettings.setupConfig.sharedSelection?.hash) {
          const builtShared = engine.buildBoardFromSetups({
            config: roomSettings.setupConfig,
          });
          if ("issues" in builtShared) {
            return c.json({ error: builtShared.issues[0]?.message ?? "Invalid shared setup configuration" }, 400);
          }
        }
      } else {
        if (setupSelections.black) {
          const blackValidation = engine.validateSetupSelection(
            setupSelections.black,
            roomSettings.setupConfig,
            "black",
          );
          if ("issues" in blackValidation) {
            return c.json({ error: blackValidation.issues[0]?.message ?? "Invalid black setup selection" }, 400);
          }
        }
        if (setupSelections.white) {
          const whiteValidation = engine.validateSetupSelection(
            setupSelections.white,
            roomSettings.setupConfig,
            "white",
          );
          if ("issues" in whiteValidation) {
            return c.json({ error: whiteValidation.issues[0]?.message ?? "Invalid white setup selection" }, 400);
          }
        }
      }
    }

    const nowIso = new Date().toISOString();

    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO games (
            id, code, status, created_at, initial_turn, turn, initial_board, ply,
            time_control_json, room_settings_json, setup_state_json, starting_player_color, host_account_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          gameId,
          code,
          "lobby",
          nowIso,
          initialTurn,
          initialTurn,
          initialBoard,
          0,
          JSON.stringify(body.timeControl || {}),
          JSON.stringify(roomSettings),
          JSON.stringify(setupSelections),
          0,
          resolvedIdentity.accountId,
        ),
    ]);

    if (body.identity.mode === "guest") {
      await resetAuthAttempt(env.DB, guestRateBucket);
    }

    const url = new URL(c.req.url);
    const wsUrl = `ws://${url.host}/ws/game/${gameId}?token=${token}`;

    return {
      gameId,
      code,
      seat: "spectator" as const,
      token,
      wsUrl,
      participant: {
        accountId: resolvedIdentity.accountId,
        seat: "spectator" as const,
        name: resolvedIdentity.name,
        email: resolvedIdentity.email,
        mode: resolvedIdentity.mode,
      },
    };
  }

  private generateFriendCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }
}
