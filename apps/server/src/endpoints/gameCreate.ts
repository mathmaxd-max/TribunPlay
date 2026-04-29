import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import * as engine from "@tribunplay/engine";
import { identitySchema, resolveIdentity, toHttpError } from "../lib/identity";

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
              token: Str(),
              wsUrl: Str(),
              participant: z.object({
                accountId: Str(),
                seat: z.literal("black"),
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

    let resolvedIdentity;
    try {
      resolvedIdentity = await resolveIdentity(env.DB, env.AUTH_TOKEN_SECRET, body.identity);
    } catch (error) {
      const normalized = toHttpError(error);
      return c.json({ error: normalized.message }, normalized.status as 400 | 401 | 403 | 500 | 503);
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

    const roomSettings = {
      hostColor,
      startColor,
      nextStartColor,
    };

    const nowIso = new Date().toISOString();

    await env.DB.batch([
      env.DB
        .prepare(
          `INSERT INTO games (
            id, code, status, created_at, initial_turn, turn, initial_board, ply,
            time_control_json, room_settings_json, starting_player_color, black_player_id, black_token
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
          0,
          resolvedIdentity.accountId,
          token,
        ),
      env.DB
        .prepare(
          `INSERT INTO game_participants (game_id, seat, account_id, name, email, created_at, updated_at)
           VALUES (?, 'black', ?, ?, ?, ?, ?)
           ON CONFLICT(game_id, seat) DO UPDATE SET
             account_id = excluded.account_id,
             name = excluded.name,
             email = excluded.email,
             updated_at = excluded.updated_at`
        )
        .bind(
          gameId,
          resolvedIdentity.accountId,
          resolvedIdentity.name,
          resolvedIdentity.email,
          nowIso,
          nowIso,
        ),
    ]);

    const url = new URL(c.req.url);
    const wsUrl = `ws://${url.host}/ws/game/${gameId}?token=${token}`;

    return {
      gameId,
      code,
      token,
      wsUrl,
      participant: {
        accountId: resolvedIdentity.accountId,
        seat: "black" as const,
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
