import { Link, useLocation, useNavigate } from "react-router-dom";
import GuestPanel from "../components/auth/GuestPanel";
import { resolveNextPath } from "../auth/redirect";
import { generateRandomGuestName } from "../auth/guestName";
import { setStoredIdentity, type StoredIdentity } from "../auth/identityStore";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";

export default function Guest() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const nextPath = resolveNextPath(params.get("next"), "/hub");
  const reason = params.get("reason");

  const handleGuestContinue = (name: string) => {
    const identity: StoredIdentity = { mode: "guest", name, email: null };
    setStoredIdentity(identity);
    navigate(nextPath, { replace: true });
  };

  const authLink = params.get("next")
    ? `/auth?next=${encodeURIComponent(params.get("next") ?? "")}`
    : "/auth";

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
        <PageHeaderBrand title="Guest mode" />
        <Link
          to="/"
          style={{
            padding: "8px 14px",
            borderRadius: "999px",
            background: "#f2d9b2",
            border: "2px solid #6f5a38",
            color: "#2a2218",
            fontWeight: 700,
            letterSpacing: "1px",
            textTransform: "uppercase",
            textDecoration: "none",
            cursor: "pointer",
          }}
        >
          Welcome
        </Link>
      </header>

      <main style={{ width: "100%", maxWidth: "720px", margin: "0 auto", padding: "20px 14px 24px", display: "grid", gap: "14px" }}>
        {reason === "restricted" && (
          <div
            role="alert"
            style={{
              borderRadius: "12px",
              border: "2px solid #b9833b",
              background: "rgba(255, 243, 214, 0.9)",
              color: "#5c441c",
              padding: "12px 14px",
              fontWeight: 700,
            }}
          >
            This feature is restricted in guest mode. Create a free account to unlock it.
          </div>
        )}

        <div style={{ fontSize: "28px", fontWeight: 700, color: "#2c2318" }}>Continue as guest</div>
        <div style={{ color: "#5a4630", lineHeight: 1.55 }}>
          Guest mode lets you play online instantly. However, it is restricted:
          <ul style={{ marginTop: "8px", marginBottom: 0, paddingLeft: "18px" }}>
            <li>History and reviews are disabled.</li>
            <li>Some account features are unavailable.</li>
          </ul>
          <div style={{ marginTop: "10px" }}>
            Sign up is free.{" "}
            <Link to={authLink} style={{ color: "#1f4d2f", fontWeight: 700 }}>
              Go to Sign up
            </Link>
          </div>
        </div>

        <GuestPanel initialName={generateRandomGuestName()} onContinue={handleGuestContinue} />

      </main>
    </div>
  );
}

