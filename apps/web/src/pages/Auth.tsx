import { Link, useLocation, useNavigate } from "react-router-dom";
import AuthPanel from "../components/auth/AuthPanel";
import { resolveNextPath } from "../auth/redirect";
import { setIdentityFromAuthSuccess, type AuthSuccessResponse } from "../auth/identityStore";
import { PageHeaderBrand } from "../ui/PageHeaderBrand";

export default function Auth() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const nextPath = resolveNextPath(params.get("next"), "/hub");
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  const handleAuthSuccess = (payload: AuthSuccessResponse) => {
    setIdentityFromAuthSuccess(payload);
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
        <PageHeaderBrand title="Account" />
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

      <main style={{ width: "100%", maxWidth: "560px", margin: "0 auto", padding: "22px 14px 24px", display: "grid", gap: "16px" }}>
        <div style={{ fontSize: "16px", color: "#5a4630", lineHeight: 1.45 }}>
          Log in or sign up to unlock all features. CAPTCHA protects against bots.
        </div>
        <AuthPanel googleClientId={googleClientId} onAuthSuccess={handleAuthSuccess} />
      </main>
    </div>
  );
}

