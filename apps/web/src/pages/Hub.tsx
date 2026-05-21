import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { clearStoredIdentity, getStoredIdentity } from "../auth/identityStore";
import { ensureAccountPreferencesLoaded, shouldHideSensitiveIdentity } from "../settings/accountSettings";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";

const cardSectionStyle = {
  borderRadius: "18px",
  border: "2px solid #3c3226",
  background: "rgba(255, 250, 242, 0.84)",
  boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
  padding: "18px",
  display: "grid",
  gap: "12px",
} as const;

const pillLinkStyle = {
  width: "fit-content",
  padding: "12px 18px",
  borderRadius: "999px",
  border: "2px solid #6f5a38",
  background: "#f2d9b2",
  color: "#2a2218",
  fontWeight: 700,
  textTransform: "uppercase" as const,
  letterSpacing: "1px",
  textDecoration: "none",
};

const labelStyle = {
  fontSize: "11px",
  fontWeight: 700,
  letterSpacing: "1.3px",
  textTransform: "uppercase" as const,
  color: "#7a6543",
};

export default function Hub() {
  const navigate = useNavigate();
  const identity = getStoredIdentity();
  const [hideSensitiveIdentity, setHideSensitiveIdentity] = useState(() => shouldHideSensitiveIdentity());

  useEffect(() => {
    if (identity?.mode !== "token") {
      setHideSensitiveIdentity(false);
      return;
    }
    let cancelled = false;
    void ensureAccountPreferencesLoaded().then((prefs) => {
      if (!cancelled) setHideSensitiveIdentity(prefs.streamerMode);
    });
    return () => {
      cancelled = true;
    };
  }, [identity?.mode, identity?.mode === "token" ? identity.accountId : null]);

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
        <PageHeaderBrand title="Hub" />
      </header>

      <main style={{ width: "100%", maxWidth: "940px", margin: "0 auto", padding: "20px 14px 24px", display: "grid", gap: "16px" }}>
        <section style={{ ...cardSectionStyle, gap: "10px" }}>
          <div style={labelStyle}>Active Identity</div>
          <div style={{ fontSize: "30px", fontWeight: 700, color: "#2c2318" }}>{identity?.name ?? "Unknown user"}</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            {identity?.mode === "token"
              ? hideSensitiveIdentity
                ? "Logged in"
                : `Logged in as ${identity.email}`
              : "Playing as guest"}
          </div>
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Play</div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Play with a friend</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>Create a room or join one with a code.</div>
          <Link to="/play" style={pillLinkStyle}>
            Open Play with a Friend
          </Link>
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Local</div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Local Game</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Pass-and-play on one device with the same setup and clock rules as friend play.
          </div>
          <Link to="/local" style={pillLinkStyle}>
            Open Local Game
          </Link>
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Review</div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Game History</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Browse finished games and replay moves with step controls.
            {identity?.mode === "guest" && (
              <span style={{ display: "block", marginTop: "8px" }}>
                Sign up to save and review games.
              </span>
            )}
          </div>
          {identity?.mode === "token" ? (
            <Link to="/history" style={pillLinkStyle}>
              Open History
            </Link>
          ) : (
            <button
              type="button"
              disabled
              title="Game history requires a free account. Sign up from Settings or the welcome page."
              style={{
                ...pillLinkStyle,
                opacity: 0.55,
                cursor: "not-allowed",
                background: "#e6dccf",
                border: "2px solid #9a8a72",
              }}
            >
              Open History
            </button>
          )}
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Learn</div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Tutorial</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Learn rules chapter by chapter with guided boards.
          </div>
          <Link to="/tutorial" style={pillLinkStyle}>
            Open Tutorial
          </Link>
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Tools</div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Setup Explorer</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Explore and validate unit setups with hash import, brush editing, and rule checks.
          </div>
          <Link to="/setup-explorer" style={pillLinkStyle}>
            Open Setup Explorer
          </Link>
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Tools</div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Board Canvas</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Paint any position on the full board with unit height, overwrite, enslave, and Tribun controls.
          </div>
          <Link to="/board-canvas" style={pillLinkStyle}>
            Open Board Canvas
          </Link>
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Clock</div>
          <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Table Clock</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
            Over-the-board chess clock with buffer and increment, matching online play rules.
          </div>
          <Link to="/clock" style={pillLinkStyle}>
            Open Table Clock
          </Link>
        </section>

        <section style={cardSectionStyle}>
          <div style={labelStyle}>Account</div>
          <div style={{ color: "#5a4630", lineHeight: 1.45 }}>Configure input behavior and board sound levels.</div>
          <Link to="/settings" style={pillLinkStyle}>
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
