import { Link, useNavigate } from "react-router-dom";
import { clearStoredIdentity, getStoredIdentity } from "../auth/identityStore";

export default function Hub() {
  const navigate = useNavigate();
  const identity = getStoredIdentity();

  const handleSignOut = () => {
    clearStoredIdentity();
    navigate("/", { replace: true });
  };

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
          gap: "14px",
          flexWrap: "wrap",
          padding: "12px 20px",
          background: "rgba(26, 21, 15, 0.92)",
          color: "#f8f1e7",
          borderBottom: "2px solid #3a2f22",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "10px",
              letterSpacing: "2px",
              textTransform: "uppercase",
              color: "#ccb896",
              fontWeight: 700,
            }}
          >
            Tribun Play
          </div>
          <div style={{ fontSize: "20px", fontWeight: 400 }}>Hub</div>
        </div>
      </header>

      <main style={{ width: "100%", maxWidth: "940px", margin: "0 auto", padding: "20px 14px 24px", display: "grid", gap: "16px" }}>
        <section
          style={{
            borderRadius: "18px",
            border: "2px solid #3c3226",
            background: "rgba(255, 250, 242, 0.84)",
            boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
            padding: "18px",
            display: "grid",
            gap: "10px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
            Active Identity
          </div>
          <div style={{ fontSize: "30px", fontWeight: 700, color: "#2c2318" }}>{identity?.name ?? "Unknown user"}</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            {identity?.mode === "token" ? `Logged in as ${identity.email}` : "Playing as guest"}
          </div>
        </section>

        <section
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
            Play
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Play with a friend</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Create a room or join one with a code.
          </div>
          <Link
            to="/play"
            style={{
              width: "fit-content",
              padding: "12px 18px",
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
            Open Play with a Friend
          </Link>
        </section>

        <section
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
            Review
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Game History</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Browse finished games and replay moves with step controls.
          </div>
          <Link
            to="/history"
            style={{
              width: "fit-content",
              padding: "12px 18px",
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
            Open History
          </Link>
        </section>

        <section
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
            Tools
          </div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Setup Explorer</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Explore and validate unit setups with hash import, brush editing, and rule checks.
          </div>
          <Link
            to="/setup-explorer"
            style={{
              width: "fit-content",
              padding: "12px 18px",
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
            Open Setup Explorer
          </Link>
        </section>

        <section
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
            Account
          </div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Configure input behavior and board sound levels.
          </div>
          <Link
            to="/settings"
            style={{
              width: "fit-content",
              padding: "12px 18px",
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
            Open Settings
          </Link>
        </section>

        <section style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button
            onClick={handleSignOut}
            style={{
              padding: "10px 18px",
              borderRadius: "999px",
              border: "2px solid #6f5a38",
              background: "#f2d9b2",
              color: "#2a2218",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "1px",
              cursor: "pointer",
            }}
          >
            Sign out
          </button>
        </section>
      </main>
    </div>
  );
}
