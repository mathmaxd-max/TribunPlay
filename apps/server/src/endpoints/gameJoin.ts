import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

export class GameJoin extends OpenAPIRoute {
  schema = {
    tags: ["Game"],
    summary: "Join a game by code",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              code: Str(),
            }),
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
    const code = data.body.code;
    
    // Look up game by code
    const game = await env.DB.prepare(
      "SELECT id, black_player_id, white_player_id, status FROM games WHERE code = ?"
    ).bind(code).first<{
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
    
    const gameId = game.id;
    const token = crypto.randomUUID();
    let seat: "black" | "white" | "spectator";
    
    // Assign seat
    if (!game.black_player_id) {
      seat = "black";
      const playerId = crypto.randomUUID();
      await env.DB.prepare(
        "UPDATE games SET black_player_id = ?, black_token = ?, status = ? WHERE id = ?"
      ).bind(playerId, token, "active", gameId).run();
    } else if (!game.white_player_id) {
      seat = "white";
      const playerId = crypto.randomUUID();
      await env.DB.prepare(
        "UPDATE games SET white_player_id = ?, white_token = ?, status = ? WHERE id = ?"
      ).bind(playerId, token, "active", gameId).run();
    } else {
      seat = "spectator";
    }
    
    // Get WebSocket URL
    const url = new URL(c.req.url);
    const wsUrl = `ws://${url.host}/ws/game/${gameId}?token=${token}`;
    
    return {
      gameId,
      seat,
      token,
      wsUrl,
    };
  }
}
