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
                initialMs: z.union([
                  z.number(),
                  z.object({ black: z.number(), white: z.number() }),
                ]).optional(),
                bufferMs: z.union([
                  z.number(),
                  z.object({ black: z.number(), white: z.number() }),
                ]).optional(),
                incrementMs: z.union([
                  z.number(),
                  z.object({ black: z.number(), white: z.number() }),
                ]).optional(),
                maxGameMs: z.number().nullable().optional(),
              }).optional(),
              roomSettings: z.object({
                hostColor: z.enum(["black", "white", "random"]).optional(),
                startColor: z.enum(["black", "white", "random"]).optional(),
                nextStartColor: z.enum(["same", "other", "random"]).optional(),
              }).optional(),
              // Optional custom starting position for debugging/testing
              // Can provide either customPosition (JSON format), boardBytesB64 (121-byte base64 string), or unitsByCid (CID-based format)
              customPosition: z.object({
                black: z.record(z.string(), z.array(z.array(z.number()))),
                white: z.record(z.string(), z.array(z.array(z.number()))),
              }).optional(),
              // Alternative: 121-byte board as base64 string (one byte per tile)
              boardBytesB64: z.string().optional(),
              // Alternative: CID-based unit specification (e.g., {"wt1": [0], "b24": [51]})
              // Format: "{color}{spec}" where spec can be "t1", "t{digit}", single digit, or two digits
              unitsByCid: z.record(z.string(), z.array(z.number())).optional(),
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
    
    // Create initial board from default position, custom position, CID-based units, or 121-byte board string
    // Try to get validated body, but also try raw JSON parse as fallback
    let body: any = c.req.valid("json");
    
    // If validation returns undefined, try parsing raw body
    if (!body) {
      try {
        const rawBody = await c.req.json();
        console.log("Raw body parsed:", JSON.stringify(rawBody));
        body = rawBody;
      } catch (e) {
        console.log("No body or parse error:", e);
        body = null;
      }
    } else {
      console.log("Validated body:", JSON.stringify(body));
    }
    
    let initialBoard: Uint8Array;
    
    if (body?.boardBytesB64) {
      // Use 121-byte base64 string if provided
      console.log("Using boardBytesB64");
      initialBoard = engine.createInitialBoard(body.boardBytesB64);
    } else if (body?.unitsByCid) {
      // Use CID-based unit specification if provided
      console.log("Using custom position from unitsByCid:", JSON.stringify(body.unitsByCid));
      initialBoard = engine.createInitialBoardFromCids(body.unitsByCid);
    } else if (body?.customPosition) {
      // Use custom position object if provided
      console.log("Using customPosition");
      initialBoard = engine.createInitialBoard(body.customPosition as engine.DefaultPosition);
    } else {
      // Use default position
      console.log("Using default position");
      initialBoard = engine.createInitialBoard();
    }
    
    const initialTurn = 0; // Black starts
    const rawSettings = body?.roomSettings ?? null;
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
    
    // Insert game into D1, assigning creator to black
    await env.DB.prepare(
      `INSERT INTO games (
        id, code, status, created_at, initial_turn, turn, initial_board, ply,
        time_control_json, room_settings_json, starting_player_color, black_player_id, black_token
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      gameId,
      code,
      "lobby",
      new Date().toISOString(),
      initialTurn,
      initialTurn,
      initialBoard,
      0,
      JSON.stringify(body?.timeControl || {}),
      JSON.stringify(roomSettings),
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
