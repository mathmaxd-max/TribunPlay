import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { API_BASE } from "../config";
import {
  getStoredIdentity,
  setIdentityFromAuthSuccess,
  type AuthSuccessResponse,
  type StoredIdentity,
} from "../auth/identityStore";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";

type HistoryItem = {
  gameId: string;
  code: string;
  seat: "black" | "white";
  opponent: { name: string | null };
  status: string;
  result: "win" | "loss" | "draw" | "unknown";
  winnerColor: number | null;
  endOpcode: number | null;
  endReason: number | null;
  createdAt: string;
  startedAt: string | null;
  endedAt: string | null;
};

type HistoryResponse = {
  games: HistoryItem[];
};

const cardStyle: React.CSSProperties = {
  borderRadius: "14px",
  border: "1px solid #d8cbb8",
  background: "#fffaf0",
  padding: "14px",
  display: "grid",
  gap: "8px",
};

const refreshSessionOrThrow = async (
  current: Extract<StoredIdentity, { mode: "token" }>,
): Promise<Extract<StoredIdentity, { mode: "token" }>> => {
  if (current.mode !== "token") {
    throw new Error("Sign in required.");
  }
  const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: current.session.refreshToken }),
  });
  if (!refreshResponse.ok) {
    throw new Error("Session expired. Please log in again.");
  }
  const refreshed = (await refreshResponse.json()) as AuthSuccessResponse;
  return setIdentityFromAuthSuccess(refreshed) as Extract<StoredIdentity, { mode: "token" }>;
};

const formatResult = (result: HistoryItem["result"]): string => {
  if (result === "win") return "Win";
  if (result === "loss") return "Loss";
  if (result === "draw") return "Draw";
  return "Unknown";
};

const formatDateTime = (value: string | null): string => {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value;
  return new Date(parsed).toLocaleString();
};

export default function History() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [games, setGames] = useState<HistoryItem[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const identity = getStoredIdentity();
        if (!identity || identity.mode !== "token") {
          throw new Error("History is only available for authenticated accounts.");
        }
        const tokenIdentity: Extract<StoredIdentity, { mode: "token" }> = identity;

        let accessToken = tokenIdentity.session.accessToken;
        const doFetch = async () =>
          fetch(`${API_BASE}/api/history`, {
            method: "GET",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

        let response = await doFetch();
        if (!response.ok && response.status === 401) {
          const nextIdentity = await refreshSessionOrThrow(tokenIdentity);
          accessToken = nextIdentity.session.accessToken;
          response = await doFetch();
        }

        if (!response.ok) {
          const err = await response.json().catch(() => ({ error: "Failed to load history" }));
          throw new Error(err.error || "Failed to load history");
        }

        const data = (await response.json()) as HistoryResponse;
        if (!cancelled) {
          setGames(data.games ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load history");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background:
          "radial-gradient(circle at top, rgba(255, 250, 240, 0.98), rgba(234, 219, 194, 0.98)), linear-gradient(135deg, #f7f0e5 0%, #e7d7ba 45%, #d9c29c 100%)",
        color: "#1d1a14",
        fontFamily: '"Space Grotesk", "Trebuchet MS", sans-serif',
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap');`}</style>

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 20px",
          gap: "12px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
          flexWrap: "wrap",
        }}
      >
        <PageHeaderBrand title="Game History" />
        <button
          type="button"
          onClick={() => navigate("/hub")}
          style={{
            padding: "8px 14px",
            borderRadius: "999px",
            background: "#f2d9b2",
            border: "2px solid #6f5a38",
            color: "#2a2218",
            fontWeight: 700,
            letterSpacing: "1px",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Hub
        </button>
      </header>

      <main style={{ width: "100%", maxWidth: "980px", margin: "0 auto", padding: "18px 14px 24px", display: "grid", gap: "12px" }}>
        <div
          style={{
            borderRadius: "18px",
            border: "2px solid #3c3226",
            background: "rgba(255, 250, 242, 0.84)",
            boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
            padding: "18px",
            display: "grid",
            gap: "12px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
            Review Mode
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Past Games</div>
          <div style={{ color: "#5a4630" }}>Open any game to replay plies with forward and reverse step animations.</div>
        </div>

        {loading && <div style={cardStyle}>Loading history...</div>}

        {error && (
          <div style={{ ...cardStyle, border: "2px solid #8b3b3b", background: "#f7d7d5", color: "#5c1c16", fontWeight: 600 }}>
            {error}
          </div>
        )}

        {!loading && !error && games.length === 0 && (
          <div style={cardStyle}>No finished games yet.</div>
        )}

        {!loading && !error && games.map((game) => (
          <div key={game.gameId} style={{ ...cardStyle, gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#2c2318" }}>
                Against {game.opponent.name ?? "Unknown"}
              </div>
              <div style={{ fontWeight: 700, color: "#5a4630" }}>{formatResult(game.result)}</div>
            </div>
            <div style={{ color: "#5a4630", fontSize: "13px", display: "grid", gap: "2px" }}>
              <div>Seat: {game.seat}</div>
              <div>Started: {formatDateTime(game.startedAt)}</div>
              <div>Ended: {formatDateTime(game.endedAt)}</div>
            </div>
            <div>
              <Link
                to={`/review/${game.gameId}`}
                style={{
                  display: "inline-block",
                  padding: "9px 14px",
                  borderRadius: "999px",
                  border: "2px solid #6f5a38",
                  background: "#f2d9b2",
                  color: "#2a2218",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "1px",
                  textDecoration: "none",
                }}
              >
                Open Replay
              </Link>
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
