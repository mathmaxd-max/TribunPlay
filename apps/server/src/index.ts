import { fromHono } from "chanfana";
import { Hono } from "hono";
import { TaskCreate } from "./endpoints/taskCreate";
import { TaskDelete } from "./endpoints/taskDelete";
import { TaskFetch } from "./endpoints/taskFetch";
import { TaskList } from "./endpoints/taskList";
import { GameRoom } from "./durable-objects/GameRoom";

// Start a Hono app
const app = new Hono<{ Bindings: Env }>();

// Setup OpenAPI registry
const openapi = fromHono(app, {
	docs_url: "/",
});

// Register OpenAPI endpoints
openapi.get("/api/tasks", TaskList);
openapi.post("/api/tasks", TaskCreate);
openapi.get("/api/tasks/:taskSlug", TaskFetch);
openapi.delete("/api/tasks/:taskSlug", TaskDelete);

// WebSocket endpoint for game rooms
app.get("/ws/game/:gameId", async (c) => {
	const gameId = c.env.GAME_ROOM.idFromName(c.req.param("gameId"));
	const stub = c.env.GAME_ROOM.get(gameId);
	return stub.fetch(c.req.raw);
});

// Export the Hono app
export default app;

// Export Durable Object class
export { GameRoom };
