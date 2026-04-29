import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthPanel from "../components/auth/AuthPanel";
import GuestPanel from "../components/auth/GuestPanel";
import { resolveNextPath } from "../auth/redirect";
import { setIdentityFromAuthSuccess, setStoredIdentity, type AuthSuccessResponse, type StoredIdentity } from "../auth/identityStore";
import { generateRandomGuestName } from "../auth/guestName";

export default function Landing() {
  const navigate = useNavigate();
  const location = useLocation();
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const params = new URLSearchParams(location.search);
  const nextPath = resolveNextPath(params.get("next"), "/hub");

  const handleAuthSuccess = (payload: AuthSuccessResponse) => {
    setIdentityFromAuthSuccess(payload);
    navigate(nextPath, { replace: true });
  };

  const handleGuestContinue = (name: string) => {
    const identity: StoredIdentity = {
      mode: "guest",
      name,
      email: null,
    };
    setStoredIdentity(identity);
    navigate(nextPath, { replace: true });
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
          <div style={{ fontSize: "20px", fontWeight: 400 }}>Choose Identity</div>
        </div>
      </header>

      <main style={{ width: "100%", maxWidth: "980px", margin: "0 auto", padding: "20px 14px 24px", display: "grid", gap: "16px" }}>
        <div style={{ fontSize: "33px", fontWeight: 700, color: "#2c2318" }}>Welcome</div>
        <div style={{ color: "#5a4630", lineHeight: 1.45 }}>
          Log in with email/password, optionally use Google, or continue as a guest to start playing.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "14px", alignItems: "start" }}>
          <AuthPanel googleClientId={googleClientId} onAuthSuccess={handleAuthSuccess} />
          <GuestPanel initialName={generateRandomGuestName()} onContinue={handleGuestContinue} />
        </div>

        <footer
          style={{
            borderRadius: "12px",
            border: "1px solid #d8cbb8",
            background: "rgba(255, 250, 242, 0.7)",
            padding: "12px",
            display: "flex",
            justifyContent: "center",
            gap: "12px",
            flexWrap: "wrap",
            fontSize: "13px",
          }}
        >
          <Link to="/datenschutz" style={{ color: "#5a4630", textDecoration: "none" }}>
            Datenschutz
          </Link>
          <span style={{ color: "#b59d7c" }}>|</span>
          <Link to="/disclaimer" style={{ color: "#5a4630", textDecoration: "none" }}>
            Disclaimer
          </Link>
          <span style={{ color: "#b59d7c" }}>|</span>
          <Link to="/impressum" style={{ color: "#5a4630", textDecoration: "none" }}>
            Impressum
          </Link>
        </footer>
      </main>
    </div>
  );
}
