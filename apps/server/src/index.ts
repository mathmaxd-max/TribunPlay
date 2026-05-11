import { fromHono } from "chanfana";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { GameCreate } from "./endpoints/gameCreate";
import { GameJoin } from "./endpoints/gameJoin";
import { GameGet } from "./endpoints/gameGet";
import { GameActiveForAccount } from "./endpoints/gameActiveForAccount";
import { GameCancel } from "./endpoints/gameCancel";
import { AuthLogin } from "./endpoints/authLogin";
import { AuthSignup } from "./endpoints/authSignup";
import { AuthGoogle } from "./endpoints/authGoogle";
import { AuthVerifyEmail } from "./endpoints/authVerifyEmail";
import { AuthResendVerification } from "./endpoints/authResendVerification";
import { AuthForgotPassword } from "./endpoints/authForgotPassword";
import { AuthResetPassword } from "./endpoints/authResetPassword";
import { AuthChangePassword } from "./endpoints/authChangePassword";
import { AuthRefresh } from "./endpoints/authRefresh";
import { AuthLogout } from "./endpoints/authLogout";
import { AccountRename } from "./endpoints/accountRename";
import { AccountDelete } from "./endpoints/accountDelete";
import { AccountStatus } from "./endpoints/accountStatus";
import { HistoryList } from "./endpoints/historyList";
import { HistoryGame } from "./endpoints/historyGame";
import { HistoryDeleteGame } from "./endpoints/historyDeleteGame";
import { SetupLibraryList } from "./endpoints/setupLibraryList";
import { SetupLibraryCreate } from "./endpoints/setupLibraryCreate";
import { SetupLibraryUpdate } from "./endpoints/setupLibraryUpdate";
import { SetupLibraryDelete } from "./endpoints/setupLibraryDelete";
import { AdminPurgeLocalAccounts } from "./endpoints/adminPurgeLocalAccounts";
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
openapi.post("/api/game/active", GameActiveForAccount);
openapi.post("/api/game/cancel", GameCancel);

// Register auth API endpoints
openapi.post("/api/auth/login", AuthLogin);
openapi.post("/api/auth/signup", AuthSignup);
openapi.post("/api/auth/google", AuthGoogle);
openapi.post("/api/auth/verify-email", AuthVerifyEmail);
openapi.post("/api/auth/resend-verification", AuthResendVerification);
openapi.post("/api/auth/forgot-password", AuthForgotPassword);
openapi.post("/api/auth/reset-password", AuthResetPassword);
openapi.post("/api/auth/change-password", AuthChangePassword);
openapi.post("/api/auth/refresh", AuthRefresh);
openapi.post("/api/auth/logout", AuthLogout);
openapi.get("/api/account", AccountStatus);
openapi.patch("/api/account/rename", AccountRename);
openapi.delete("/api/account", AccountDelete);
openapi.get("/api/history", HistoryList);
openapi.get("/api/history/:gameId", HistoryGame);
openapi.delete("/api/history/:gameId", HistoryDeleteGame);
openapi.get("/api/setup-library", SetupLibraryList);
openapi.post("/api/setup-library", SetupLibraryCreate);
openapi.patch("/api/setup-library/:itemId", SetupLibraryUpdate);
openapi.delete("/api/setup-library/:itemId", SetupLibraryDelete);

// Admin (manual maintenance)
openapi.post("/api/admin/purge-local-accounts", AdminPurgeLocalAccounts);

// WebSocket health endpoint.
// In local dev, immediately closing after accept can cause Wrangler to surface noisy
// "Network connection lost" errors. We accept and let the client close.
app.get("/ws/health", (c) => {
	const upgradeHeader = c.req.header("Upgrade");
	if (upgradeHeader !== "websocket") {
		return new Response("Expected WebSocket", { status: 426 });
	}

	const pair = new WebSocketPair();
	const [client, server] = Object.values(pair);
	server.accept();

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
