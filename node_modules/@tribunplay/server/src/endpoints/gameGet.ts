import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import type { AppContext } from "../types";

export class GameGet extends OpenAPIRoute {
  schema = {
    tags: ["Game"],
    summary: "Get game info by code",
    request: {
      params: z.object({
        code: Str(),
      }),
    },
    responses: {
      "200": {
        description: "Returns game info",
        content: {
          "application/json": {
            schema: z.object({
              gameId: Str(),
              status: Str(),
            }),
          },
        },
      },
      "404": {
        description: "Game not found",
      },
    },
  };

  async handle(c: AppContext) {
    const env = c.env;
    const data = await this.getValidatedData<typeof this.schema>();
    const code = data.params.code;
    
    const game = await env.DB.prepare(
      "SELECT id, status FROM games WHERE code = ?"
    ).bind(code).first<{
      id: string;
      status: string;
    }>();
    
    if (!game) {
      return c.json({ error: "Game not found" }, 404);
    }
    
    return {
      gameId: game.id,
      status: game.status,
    };
  }
}
