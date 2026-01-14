import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { GameCreate } from "./endpoints/gameCreate";
import { GameJoin } from "./endpoints/gameJoin";
import { GameGet } from "./endpoints/gameGet";
import { GameRoom } from "./durable-objects/GameRoom";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*" }));

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register game API endpoints
openapi.post("/api/game/create", GameCreate);
openapi.post("/api/game/join", GameJoin);
openapi.get("/api/game/:code", GameGet);

// WebSocket health endpoint (accepts handshake, then closes)
app.get("/ws/health", (c) => {
	const upgradeHeader = c.req.header("Upgrade");
	if (upgradeHeader !== "websocket") {
		return new Response("Expected WebSocket", { status: 426 });
	}

	const pair = new WebSocketPair();
	const [client, server] = Object.values(pair);
	server.accept();
	server.close(1000, "OK");

	return new Response(null, {
		status: 101,
		webSocket: client,
	});
});

// WebSocket endpoint for game rooms
app.get("/ws/game/:gameId", async (c) => {
	const gameId = c.req.param("gameId");
	const token = new URL(c.req.url).searchParams.get("token");
	
	if (!token) {
		return new Response("Missing token", { status: 401 });
	}
	
	// Create DO instance keyed by gameId
	const doId = c.env.GAME_ROOM.idFromName(gameId);
	const stub = c.env.GAME_ROOM.get(doId);
	
	// Pass gameId in headers so DO can access it
	const request = new Request(c.req.raw);
	request.headers.set("X-Game-Id", gameId);
	
	return stub.fetch(request);
});

// Export the Hono app
export default app;

// Export Durable Object class
export { GameRoom };
