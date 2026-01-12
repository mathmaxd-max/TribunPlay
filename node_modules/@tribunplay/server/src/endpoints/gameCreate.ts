import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";
import * as engine from "@tribunplay/engine";

export class GameCreate extends OpenAPIRoute {
  schema = {
    tags: ["Game"],
    summary: "Create a new game",
    request: {
      body: {
        content: {
          "application/json": {
            schema: z.object({
              timeControl: z.object({
                initialMs: z.number().optional(),
                bufferMs: z.number().optional(),
                incrementMs: z.number().optional(),
                maxGameMs: z.number().optional(),
              }).optional(),
            }).optional(),
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
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    
    // Generate game ID and friend code
    const gameId = crypto.randomUUID();
    const code = this.generateFriendCode();
    const token = crypto.randomUUID();
    const playerId = crypto.randomUUID();
    
    // Create initial board from default position
    const initialBoard = engine.createInitialBoard();
    
    const initialTurn = 0; // Black starts
    
    // Insert game into D1, assigning creator to black
    await env.DB.prepare(
      `INSERT INTO games (
        id, code, status, created_at, initial_turn, turn, initial_board, ply,
        time_control_json, starting_player_color, black_player_id, black_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      gameId,
      code,
      "lobby",
      new Date().toISOString(),
      initialTurn,
      initialTurn,
      initialBoard,
      0,
      JSON.stringify(c.req.valid("json")?.timeControl || {}),
      0,
      playerId,
      token
    ).run();
    
    // Get WebSocket URL (for MVP, use relative path)
    const url = new URL(c.req.url);
    const wsUrl = `ws://${url.host}/ws/game/${gameId}?token=${token}`;
    
    return {
      gameId,
      code,
      token,
      wsUrl,
    };
  }
  
  private generateFriendCode(): string {
    // Generate a 6-character alphanumeric code
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing chars
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }
}
