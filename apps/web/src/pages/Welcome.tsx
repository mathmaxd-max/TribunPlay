import { Link, useLocation } from "react-router-dom";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";

export default function Welcome() {
  const location = useLocation();
  const next = new URLSearchParams(location.search).get("next");
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

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
        <PageHeaderBrand title="TribunPlay" />
      </header>

      <main style={{ width: "100%", maxWidth: "920px", margin: "0 auto", padding: "26px 14px", display: "grid", gap: "18px" }}>
        <div style={{ fontSize: "36px", fontWeight: 700, color: "#2c2318" }}>Welcome</div>
        <div style={{ color: "#5a4630", lineHeight: 1.55, fontSize: "16px" }}>
          Choose how you want to play. You can sign up for free, log in, or continue as a guest.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "14px" }}>
          <Link
            to={`/auth${nextQuery}`}
            style={{
              textDecoration: "none",
              borderRadius: "18px",
              border: "2px solid #3c3226",
              background: "rgba(255, 250, 242, 0.84)",
              boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
              padding: "18px",
              color: "inherit",
              display: "grid",
              gap: "10px",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
              Account
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Log in / Sign up</div>
            <div style={{ fontSize: "13px", color: "#6f5a38", lineHeight: 1.45 }}>
              Create an account (free) or log in. Protected with CAPTCHA.
            </div>
          </Link>

          <Link
            to={`/guest${nextQuery}`}
            style={{
              textDecoration: "none",
              borderRadius: "18px",
              border: "2px solid #3c3226",
              background: "rgba(255, 250, 242, 0.84)",
              boxShadow: "0 18px 30px rgba(39, 30, 20, 0.15)",
              padding: "18px",
              color: "inherit",
              display: "grid",
              gap: "10px",
            }}
          >
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "1.3px", textTransform: "uppercase", color: "#7a6543" }}>
              Guest
            </div>
            <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Continue as guest</div>
            <div style={{ fontSize: "13px", color: "#6f5a38", lineHeight: 1.45 }}>
              Instant access for online play. Some features are restricted.
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}

